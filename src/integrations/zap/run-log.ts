import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ApiError } from "../../lib/errors.ts";

// Evidence contract v1. Scanned sites can influence some log text, so only anchored lines
// from exact loggers and threads are read, and anything unexpected is reported as an anomaly.
// Raw lines are never stored, returned or logged.
export type SpiderLog = {
  startedAt: string;
  endedAt: string;
  target: string;
  complete: boolean;
};
export type ActiveLog = {
  startedAt: string;
  endedAt: string;
  stopped: boolean;
  errored: boolean;
  hosts: string[];
  completedRules: number;
  skippedRules: string[];
  stoppedRules: number;
  alerts: number;
};
export type RunLog = {
  spider: SpiderLog | null;
  active: ActiveLog | null;
  anomalies: string[];
};

const limit = 64 * 1024 * 1024;
const line =
  /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z) \d+ \[([^\]]{1,128})\] (TRACE|DEBUG|INFO|WARN|ERROR|FATAL) +([\w.$]+) - (.*)$/;
const loggers = {
  control: "org.parosproxy.paros.control.Control",
  scanner: "org.parosproxy.paros.core.scanner.Scanner",
  host: "org.parosproxy.paros.core.scanner.HostProcess",
  spider: "org.zaproxy.addon.spider.Spider",
  spiderThread: "org.zaproxy.addon.spider.SpiderThread",
};
const watched = new Set(Object.values(loggers));

export function parseRunLog(
  text: string,
  options: {
    containerStartedAt: string;
    sessionLocation: string;
    spiderId: string;
    activeId: string;
  },
): RunLog {
  const anomalies = new Set<string>();
  const lines = text.split(/\r?\n/);
  // A rotated or partial log no longer begins with the daemon's own startup line.
  const first = /^(\S+) Found Java version \S+$/.exec(lines[0] ?? "");
  const delay = first
    ? Date.parse(first[1]) - Date.parse(options.containerStartedAt)
    : NaN;
  if (!(delay >= -1000 && delay <= 60000)) anomalies.add("LOG_TRUNCATED");
  if (lines.filter((row) => / Found Java version \S+$/.test(row)).length > 1)
    anomalies.add("LOG_RESTARTED");

  let rows: { at: string; thread: string; level: string; logger: string; message: string }[] = [];
  let session: string | null = null;
  let last = "";
  for (const raw of lines) {
    if (/OutOfMemoryError|No space left on device/.test(raw))
      anomalies.add("RESOURCE_FAILURE");
    const match = line.exec(raw);
    if (!match) continue;
    const [, at, thread, level, logger, message] = match;
    if (!watched.has(logger)) continue;
    if (at < last) anomalies.add("LOG_ORDER");
    last = at;
    if (logger === loggers.control) {
      const created = /^New session file created: (.+)$/.exec(message);
      if (created) {
        // Scan IDs restart with each session, so earlier lines no longer apply.
        session = created[1];
        rows = [];
      } else if (session !== null) anomalies.add("SESSION_EVENT");
      continue;
    }
    rows.push({ at, thread, level, logger, message });
  }
  if (session === null || session !== options.sessionLocation)
    anomalies.add("SESSION_NOT_IN_LOG");

  const spiderStarts: { at: string; thread: string; target: string }[] = [];
  const spiderEnds: { at: string; thread: string; target: string; complete: boolean }[] = [];
  const started: { at: string; id: string }[] = [];
  const ended: { at: string; id: string }[] = [];
  const stopped: string[] = [];
  const hosts = new Set<string>();
  const ruleStarts: string[] = [];
  const completed: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  let stoppedRules = 0,
    alerts = 0,
    hostAlerts: number | null = null,
    hostEnds = 0,
    scans = 0,
    errored = false,
    spiderStopped = false,
    spiderFinished = 0;
  for (const { at, thread, level, logger, message } of rows) {
    let match: RegExpExecArray | null;
    if (
      (logger === loggers.scanner || logger === loggers.host) &&
      level === "ERROR" &&
      message.startsWith("An error occurred while active scanning")
    ) {
      errored = true;
      continue;
    }
    if (level !== "INFO") {
      anomalies.add("UNEXPECTED_LEVEL");
      continue;
    }
    if (logger === loggers.spiderThread) {
      if ((match = /^Starting spidering scan on (\S+) at \S+$/.exec(message)))
        spiderStarts.push({ at, thread, target: match[1] });
      else if (
        (match = /^Spider scanning complete: (true|false) on (\S+) at \S+$/.exec(message))
      )
        spiderEnds.push({ at, thread, target: match[2], complete: match[1] === "true" });
      else anomalies.add("UNRECOGNIZED_LINE");
    } else if (logger === loggers.spider) {
      if (message === "Stopping spidering process by request.") spiderStopped = true;
      else if (message === "Spidering process is complete. Shutting down...") spiderFinished++;
      else if (!["Spider initializing...", "Starting spider..."].includes(message))
        anomalies.add("UNRECOGNIZED_LINE");
    } else if (logger === loggers.scanner) {
      if ((match = /^scanner with ID (\d{1,12}) started$/.exec(message)))
        started.push({ at, id: match[1] });
      else if ((match = /^scanner with ID (\d{1,12}) stopped$/.exec(message)))
        stopped.push(match[1]);
      else if ((match = /^scanner with ID (\d{1,12}) completed in [\d.,]+s$/.exec(message)))
        ended.push({ at, id: match[1] });
      else anomalies.add("UNRECOGNIZED_LINE");
    } else {
      if (!/^ZAP-(?:Active)?Scanner-\d+$/.test(thread)) anomalies.add("UNEXPECTED_THREAD");
      if ((match = /^Scanning \d+ node\(s\) from (\S+)$/.exec(message))) {
        scans++;
        hosts.add(match[1]);
      } else if (
        (match = /^start host (\S+) \| (\w+) strength \w+ threshold \w+$/.exec(message))
      ) {
        hosts.add(match[1]);
        ruleStarts.push(match[1] + "|" + match[2]);
      } else if (
        (match =
          /^completed host\/plugin (\S+) \| (\w+) in [\d.,]+s with \d+ message\(s\) sent and (\d+) alert\(s\) raised\.$/.exec(message))
      ) {
        hosts.add(match[1]);
        completed.push(match[1] + "|" + match[2]);
        alerts += Number(match[3]);
      } else if (
        (match =
          /^skipped plugin (?:\[([^\]]{1,200})\] )?(\S+) \| (\w+) in [\d.,]+s with \d+ message\(s\) sent and (\d+) alert\(s\) raised\.$/.exec(message))
      ) {
        hosts.add(match[2]);
        skipped.push({ key: match[2] + "|" + match[3], reason: match[1] ?? "" });
        alerts += Number(match[4]);
      } else if (message.startsWith("stopped host/plugin ")) stoppedRules++;
      else if (
        (match = /^completed host (\S+) in [\d.,]+s with (\d+) alert\(s\) raised\.$/.exec(message))
      ) {
        hosts.add(match[1]);
        hostEnds++;
        hostAlerts = Number(match[2]);
      } else anomalies.add("UNRECOGNIZED_LINE");
    }
  }

  // Host and rule lines carry no scan ID. They are attributable only when the session
  // contains exactly one spider and one active scan, with the expected IDs.
  let spider: SpiderLog | null = null;
  if (spiderStarts.length > 1 || spiderEnds.length > 1) anomalies.add("MULTIPLE_SPIDERS");
  else if (spiderStarts.length === 1 && spiderEnds.length === 1) {
    const [start] = spiderStarts,
      [end] = spiderEnds;
    if (
      start.thread !== "ZAP-SpiderInitThread-" + options.spiderId ||
      start.target !== end.target ||
      end.at < start.at
    )
      anomalies.add("SPIDER_MISMATCH");
    if (
      end.complete !== !spiderStopped ||
      spiderFinished !== (end.complete ? 1 : 0) ||
      (end.complete && end.thread !== "ZAP-SpiderShutdownThread-" + options.spiderId)
    )
      anomalies.add("SPIDER_CONTRADICTION");
    spider = { startedAt: start.at, endedAt: end.at, target: start.target, complete: end.complete };
  }
  let active: ActiveLog | null = null;
  if (started.length > 1 || ended.length > 1) anomalies.add("MULTIPLE_ACTIVE_SCANS");
  else if (started.length === 1 && ended.length === 1) {
    if (started[0].id !== options.activeId || ended[0].id !== options.activeId || ended[0].at < started[0].at)
      anomalies.add("ACTIVE_MISMATCH");
    if (stopped.some((id) => id !== options.activeId) || stopped.length > 1)
      anomalies.add("ACTIVE_MISMATCH");
    const finished = [...completed, ...skipped.map((row) => row.key)];
    const clean = !stopped.length && !errored && !stoppedRules;
    if (
      clean &&
      (scans !== 1 ||
        hostEnds !== 1 ||
        hostAlerts !== alerts ||
        new Set(finished).size !== finished.length ||
        new Set(ruleStarts).size !== ruleStarts.length ||
        finished.length !== ruleStarts.length ||
        finished.some((key) => !ruleStarts.includes(key)))
    )
      anomalies.add("RULE_CONTRADICTION");
    if (!stopped.length && !errored && stoppedRules) anomalies.add("RULE_CONTRADICTION");
    active = {
      startedAt: started[0].at,
      endedAt: ended[0].at,
      stopped: stopped.length > 0,
      errored,
      hosts: [...hosts].sort(),
      completedRules: completed.length,
      skippedRules: skipped.map((row) => row.reason).sort(),
      stoppedRules,
      alerts,
    };
  }
  return { spider, active, anomalies: [...anomalies].sort() };
}

const exec = promisify(execFile);
// Reads the log of the fingerprinted container only, from its current start.
export async function readContainerLog() {
  const docker = async (...args: string[]) =>
    exec("docker", ["--context", "desktop-linux", ...args], {
      timeout: 30000,
      maxBuffer: limit,
      windowsHide: true,
    });
  try {
    const { stdout } = await docker(
      "inspect",
      "--format",
      "{{.Id}}|{{.State.StartedAt}}",
      "sentinelscan-infrastructure-zap-1",
    );
    const match = /^([a-f0-9]{64})\|([\dT:.Z-]+)$/.exec(stdout.trim());
    if (!match) throw Error();
    const log = await docker("logs", "--timestamps", "--since", match[2], match[1]);
    return { containerStartedAt: match[2], text: log.stdout, errors: log.stderr };
  } catch {
    throw new ApiError(503, "ZAP_LOG_UNAVAILABLE");
  }
}
export type ReadLog = typeof readContainerLog;
