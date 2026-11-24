import type { PrismaClient } from "@prisma/client";
import type { ZapClient } from "../../integrations/zap/client.ts";
import { parseRunLog, type ReadLog } from "../../integrations/zap/run-log.ts";
import { ApiError } from "../../lib/errors.ts";
import { demoTarget, registeredScope } from "../../lib/security/destination.ts";
import type { RunRecords } from "../assessments/run-records.ts";
import { demoDestination, type Egress } from "./egress.ts";
import type { Resources } from "./resources.ts";

// Fixed on the server. A browser can only choose to use it.
export const configuration = {
  id: "standard",
  name: "Standard check",
  memoryBytes: 3221225472,
  heap: "1536m",
  threadsPerHost: 2,
  hostsPerScan: 1,
  delayMs: 20,
  passiveAlertLimit: 10,
  rules: 52,
  memoryStopPercent: 90,
} as const;
export type Stage =
  | "PREPARING" | "INITIALIZING" | "SPIDER_RUNNING" | "SPIDER_VERIFYING" | "ACTIVE_RUNNING"
  | "COLLECTING_EVIDENCE" | "COMPLETED" | "FAILED" | "CANCELLED" | "OUTCOME_UNKNOWN";
type Kind = "spider" | "active";
export type Job = {
  assessmentId: string;
  stage: Stage;
  stageAt: Date;
  scans: Partial<Record<Kind, { id: string; progress: number | null; requests: number | null; alerts: number | null }>>;
  memoryPercent: number | null;
  peakMemoryPercent: number | null;
  cancelRequested: boolean;
  code: string | null;
  reasons: readonly string[];
  findingCount: number | null;
};
const ended: Stage[] = ["COMPLETED", "FAILED", "CANCELLED", "OUTCOME_UNKNOWN"];
class Stopped extends Error {}
const limits = { spider: 15 * 60_000, active: 90 * 60_000 };

export function createOrchestrator(deps: {
  db: PrismaClient;
  zap: ZapClient;
  records: RunRecords;
  getSession: () => Promise<string>;
  readLog: ReadLog;
  resources: Resources;
  egress: Egress;
  wait?: (ms: number) => Promise<unknown>;
  now?: () => number;
}) {
  const { db, zap, records, getSession, readLog, resources, egress } = deps;
  const wait = deps.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const jobs = new Map<string, Job>();
  const keys = new Map<string, Promise<string>>();
  let launching = false;
  // A finished scan still owns the firewall until it is locked again.
  let locking = 0;
  const running = () => [...jobs.values()].find((job) => !ended.includes(job.stage)) ?? null;
  const isActive = (id: string) => running()?.assessmentId === id;

  // Read-only checks. Every one must hold before consent is used or anything is started.
  async function readiness(ownLaunch = false) {
    const reasons = new Set<string>();
    if (running() || locking || (launching && !ownLaunch)) reasons.add("SCAN_ALREADY_RUNNING");
    try {
      await registeredScope(demoTarget);
    } catch {
      reasons.add("DEMO_SCOPE_DISABLED");
    }
    try {
      demoDestination(await resources.demoAddress());
      if (!(await egress.available())) reasons.add("EGRESS_GUARD_UNAVAILABLE");
    } catch (error) {
      reasons.add(error instanceof ApiError ? error.message : "DOCKER_UNAVAILABLE");
    }
    try {
      const container = await resources.configuration();
      const sample = await resources.sample();
      if (container.memoryBytes !== configuration.memoryBytes || container.heap !== configuration.heap)
        reasons.add("RESOURCE_LIMITS_CHANGED");
      if (!sample.healthy) reasons.add("SERVICE_UNHEALTHY");
      if (sample.memoryPercent === null || sample.memoryPercent > 75) reasons.add("MEMORY_TOO_HIGH");
    } catch {
      reasons.add("DOCKER_UNAVAILABLE");
    }
    try {
      if ((await zap.version()) !== "2.17.0") reasons.add("ZAP_VERSION_CHANGED");
      for (const kind of ["spider", "active"] as const)
        if ((await zap.inspectRuns(kind)).some((run) => run.state !== "FINISHED"))
          reasons.add("SCAN_ALREADY_RUNNING");
      const policy = await zap.policy();
      if (
        policy.delayMs !== configuration.delayMs ||
        policy.threadsPerHost !== configuration.threadsPerHost ||
        policy.hostsPerScan !== configuration.hostsPerScan ||
        policy.passiveAlertLimit !== configuration.passiveAlertLimit ||
        policy.maxScanMinutes !== 0 ||
        policy.maxRuleMinutes !== 0 ||
        policy.rules !== configuration.rules ||
        policy.enabledRules !== configuration.rules ||
        policy.domXss
      )
        reasons.add("SCAN_POLICY_CHANGED");
    } catch {
      reasons.add("ZAP_UNAVAILABLE");
    }
    try {
      const log = await readLog();
      if (zap.mentionsCredential(log.text) || zap.mentionsCredential(log.errors))
        reasons.add("CREDENTIAL_IN_LOG");
      const updates = log.text.split("\n").filter((line) => line.includes("DownloadInstaller"));
      const last = Date.parse(updates.at(-1)?.split(" ")[0] ?? "");
      if (
        (Number.isFinite(last) && now() - last < 60_000) ||
        now() - Date.parse(log.containerStartedAt) < 60_000
      )
        reasons.add("ZAP_STILL_STARTING");
    } catch {
      reasons.add("ZAP_LOG_UNAVAILABLE");
    }
    try {
      const [storage] = await db.$queryRaw<
        { ready: boolean }[]
      >`SELECT to_regclass('run_evidence') IS NOT NULL AS ready`;
      if (!storage?.ready) reasons.add("EVIDENCE_STORAGE_UNAVAILABLE");
      // A new session ends the current one. Unfinished work bound to it is never discarded silently.
      if (!reasons.has("ZAP_UNAVAILABLE")) {
        const session = await getSession().catch((error: unknown) => {
          if (error instanceof ApiError && error.message === "ZAP_SESSION_NOT_SAVED") return null;
          throw error;
        });
        if (session !== null) {
          const open = await db.$queryRaw<
            { id: string }[]
          >`SELECT DISTINCT a.id::text AS id FROM assessments a JOIN assessment_runs r ON r.assessment_id=a.id WHERE r.session_key=${session} AND a.status NOT IN ('COMPLETED','FAILED','CANCELLED')`;
          if (open.length) reasons.add("UNRESOLVED_SCAN_IN_SESSION");
        }
      }
    } catch {
      reasons.add("DATABASE_OR_SESSION_UNAVAILABLE");
    }
    return { ready: !reasons.size, reasons: [...reasons].sort() };
  }

  async function setStatus(id: string, status: string, code: string | null, close: boolean) {
    await db.$executeRaw`UPDATE assessments SET status=${status},error_code=${code},finished_at=CASE WHEN ${close} THEN CURRENT_TIMESTAMP ELSE finished_at END WHERE id=${id}::uuid AND status NOT IN ('COMPLETED','FAILED','CANCELLED')`;
  }
  const stage = (job: Job, value: Stage) => {
    job.stage = value;
    job.stageAt = new Date(now());
  };
  async function finish(job: Job, value: "FAILED" | "CANCELLED" | "OUTCOME_UNKNOWN", code: string, reasons: readonly string[] = []) {
    job.code = code;
    job.reasons = reasons;
    await setStatus(job.assessmentId, value, code, value !== "OUTCOME_UNKNOWN");
    stage(job, value);
  }
  async function currentLog(ids: Partial<Record<Kind, string>>) {
    const raw = await readLog();
    return parseRunLog(raw.text, {
      containerStartedAt: raw.containerStartedAt,
      sessionLocation: await zap.sessionLocation(),
      spiderId: ids.spider ?? "",
      activeId: ids.active ?? "",
    });
  }
  // Requests a stop and accepts it only when the listing and the log both say so.
  async function stopAndConfirm(kind: Kind, ids: Partial<Record<Kind, string>>, session: string) {
    try {
      if ((await getSession()) !== session) return false;
      await zap.stopScan(kind, ids[kind]!);
    } catch {
      return false;
    }
    for (let attempt = 0; attempt < 15; attempt++) {
      await wait(2000);
      try {
        const row = (await zap.inspectRuns(kind)).find((run) => run.id === ids[kind]);
        if (row?.state !== "FINISHED" || (await getSession()) !== session) continue;
        const log = await currentLog(ids);
        if (kind === "active" ? log.active?.stopped : log.spider && !log.spider.complete) return true;
      } catch {
        /* Try again until the attempts run out. */
      }
    }
    return false;
  }
  async function stopBecause(job: Job, kind: Kind, session: string, code: string): Promise<never> {
    const ids = { spider: job.scans.spider?.id, active: job.scans.active?.id };
    const confirmed = await stopAndConfirm(kind, ids, session);
    // Receipts and the provider session keep what was recorded. Nothing partial is imported.
    await records.sync(job.assessmentId).catch(() => {});
    if (confirmed) await finish(job, "CANCELLED", code);
    else await finish(job, "OUTCOME_UNKNOWN", code === "OPERATOR_CANCELLED_SCAN" ? "CANCELLATION_UNCONFIRMED" : code);
    throw new Stopped();
  }
  // ZAP reports usage statistics when a session changes. The firewall refuses that, which is intended.
  const telemetry =
    /^\S+ \d+ \[ZAP-telemetry-stats\] ERROR org\.zaproxy\.addon\.callhome\.ExtensionCallHome - [a-z]+\.zaproxy\.org: Temporary failure in name resolution$/;
  // Only lines written since this scan began. Earlier messages belong to something else.
  function newErrors(text: string, since: number) {
    return text.split("\n").some((line) => {
      const at = Date.parse(line.split(" ", 1)[0]);
      return (
        Number.isFinite(at) &&
        at >= since - 2000 &&
        !telemetry.test(line.trimEnd()) &&
        /^\S+ \d+ \[[^\]]+\] (?:ERROR|FATAL) |OutOfMemoryError/.test(line)
      );
    });
  }
  async function follow(job: Job, kind: Kind, session: string, rules: string) {
    const scan = job.scans[kind]!;
    const started = now();
    let failures = 0;
    let guarded = -Infinity;
    for (;;) {
      if (job.cancelRequested) await stopBecause(job, kind, session, "OPERATOR_CANCELLED_SCAN");
      let reason: string | null = null;
      try {
        const rows = (await zap.inspectRuns(kind)).filter((run) => run.id === scan.id);
        if (rows.length !== 1) throw new ApiError(409, "ZAP_RUN_AMBIGUOUS");
        scan.progress = rows[0].progress;
        scan.requests = rows[0].requests;
        scan.alerts = rows[0].alerts;
        const sample = await resources.sample();
        job.memoryPercent = sample.memoryPercent;
        if (sample.memoryPercent !== null)
          job.peakMemoryPercent = Math.max(job.peakMemoryPercent ?? 0, sample.memoryPercent);
        await db.$queryRaw`SELECT 1`;
        const sites = await zap.sites();
        const log = await readLog();
        if ((await getSession()) !== session) throw new ApiError(409, "ZAP_SESSION_CHANGED");
        if (now() - guarded >= 10_000) {
          if (!(await egress.holds(rules))) reason = "SCAN_STOPPED_EGRESS";
          guarded = now();
        }
        if (reason) {
          /* Already decided. */
        } else if (sample.memoryPercent === null || sample.memoryPercent > configuration.memoryStopPercent)
          reason = "SCAN_STOPPED_MEMORY";
        else if (!sample.healthy) reason = "SCAN_STOPPED_SERVICE";
        else if (sites.some((site) => site !== new URL(demoTarget).origin)) reason = "SCAN_STOPPED_SCOPE";
        else if (newErrors(log.text, started) || /OutOfMemoryError/.test(log.errors))
          reason = "SCAN_STOPPED_ERRORS";
        else if (now() - started > limits[kind]) reason = "SCAN_STOPPED_TIME";
        failures = 0;
        if (!reason && rows[0].state === "FINISHED") return;
      } catch {
        // A short interruption is tolerated. A lasting one leaves the outcome unknown.
        if (++failures >= 5) {
          // Never leave a scan running unobserved. Its outcome stays unknown either way.
          await stopAndConfirm(kind, { spider: job.scans.spider?.id, active: job.scans.active?.id }, session);
          await finish(job, "OUTCOME_UNKNOWN", "PROVIDER_LOST");
          throw new Stopped();
        }
      }
      if (reason) await stopBecause(job, kind, session, reason);
      await wait(2000);
    }
  }
  async function execute(job: Job) {
    const id = job.assessmentId;
    let started = false;
    let guarding = false;
    const cancelledBetween = async () => {
      if (!job.cancelRequested) return;
      await finish(job, "CANCELLED", "OPERATOR_CANCELLED_SCAN");
      throw new Stopped();
    };
    try {
      stage(job, "INITIALIZING");
      await setStatus(id, "INITIALIZING", null, false);
      await registeredScope(demoTarget);
      const destination = demoDestination(await resources.demoAddress());
      await cancelledBetween();
      // From here on only the demo is reachable from ZAP, and that is proven first.
      guarding = true;
      locking++;
      const rules = await egress.apply(destination);
      await cancelledBetween();
      const name = `sentinelscan-${id.slice(0, 8)}-${now()}`;
      await zap.newSession(name);
      if (!(await zap.sessionLocation()).endsWith(`/${name}.session`))
        throw new ApiError(409, "ZAP_SESSION_NOT_SAVED");
      const session = await getSession();
      await zap.resetScanOptions();
      await cancelledBetween();

      stage(job, "SPIDER_RUNNING");
      started = true;
      const spider = await zap.startSpider();
      job.scans.spider = { id: spider, progress: null, requests: null, alerts: null };
      await records.associate(id, { kind: "spider", scanId: spider, sessionKey: session });
      await follow(job, "spider", session, rules);

      stage(job, "SPIDER_VERIFYING");
      const log = await currentLog({ spider });
      const scope = await zap.inspectDemoScope("spider", spider);
      if (
        log.anomalies.length ||
        !log.spider?.complete ||
        log.spider.target !== demoTarget ||
        scope.evidence !== "OBSERVED_TARGET_ORIGIN" ||
        (await getSession()) !== session
      ) {
        await finish(job, "OUTCOME_UNKNOWN", "SPIDER_UNVERIFIED", log.anomalies);
        return;
      }
      await cancelledBetween();

      if (!(await egress.holds(rules))) {
        await finish(job, "FAILED", "SCAN_STOPPED_EGRESS");
        return;
      }

      stage(job, "ACTIVE_RUNNING");
      const active = await zap.startActive();
      job.scans.active = { id: active, progress: null, requests: null, alerts: null };
      await records.associate(id, { kind: "active", scanId: active, sessionKey: session });
      await follow(job, "active", session, rules);

      // Evidence, validation and import are one verified operation.
      stage(job, "COLLECTING_EVIDENCE");
      await wait(5000);
      if (!(await egress.holds(rules))) {
        await finish(job, "OUTCOME_UNKNOWN", "SCAN_STOPPED_EGRESS");
        return;
      }
      try {
        const result = await records.importRun(id);
        job.findingCount = result.findingCount;
        if (result.status === "COMPLETED") stage(job, "COMPLETED");
        else {
          job.code = "ZAP_RUN_" + result.status;
          stage(job, result.status === "FAILED" ? "FAILED" : "CANCELLED");
        }
      } catch (error) {
        const refused = error instanceof ApiError;
        await finish(
          job,
          "OUTCOME_UNKNOWN",
          "EVIDENCE_UNVERIFIED",
          refused ? (error.reasons.length ? error.reasons : [error.message]) : [],
        );
      }
    } catch (error) {
      if (error instanceof Stopped) return;
      const reasons = error instanceof ApiError ? [error.message] : [];
      // Before the first launch request nothing was tested. Afterwards that is not certain.
      try {
        const scan = job.scans.active ? "active" : job.scans.spider ? "spider" : null;
        if (scan) {
          const ids = { spider: job.scans.spider?.id, active: job.scans.active?.id };
          await stopAndConfirm(scan, ids, await getSession());
        }
      } catch {
        /* The outcome below already says what is known. */
      }
      await finish(job, started ? "OUTCOME_UNKNOWN" : "FAILED", started ? "PROVIDER_LOST" : "SCAN_START_FAILED", reasons).catch(() => {
        job.code = "DATABASE_UNAVAILABLE";
        stage(job, "OUTCOME_UNKNOWN");
      });
    } finally {
      // Nothing is reachable from ZAP until the next scan, even if a scan could not be stopped.
      if (guarding) {
        await egress.lock().catch(() => {});
        locking--;
      }
    }
  }
  async function begin(create: () => Promise<{ id: string }>) {
    const check = await readiness(true);
    if (!check.ready) throw new ApiError(409, "SCAN_NOT_READY", check.reasons);
    const { id } = await create();
    const job: Job = {
      assessmentId: id,
      stage: "PREPARING",
      stageAt: new Date(now()),
      scans: {},
      memoryPercent: null,
      peakMemoryPercent: null,
      cancelRequested: false,
      code: null,
      reasons: [],
      findingCount: null,
    };
    jobs.set(id, job);
    void execute(job);
    return id;
  }
  return {
    readiness: () => readiness(),
    isActive,
    job: (id: string) => jobs.get(id) ?? null,
    // The same request key always leads to the same assessment, whatever the browser repeats.
    async launch(requestKey: string, create: () => Promise<{ id: string }>) {
      const known = keys.get(requestKey);
      if (known) return { assessmentId: await known, repeated: true };
      if (launching || locking || running()) throw new ApiError(409, "SCAN_ALREADY_RUNNING");
      launching = true;
      const attempt = begin(create);
      keys.set(requestKey, attempt);
      try {
        const assessmentId = await attempt;
        for (const map of [jobs, keys]) while (map.size > 50) map.delete([...map.keys()][0]);
        return { assessmentId, repeated: false };
      } catch (error) {
        keys.delete(requestKey);
        throw error;
      } finally {
        launching = false;
      }
    },
    cancel(id: string) {
      const job = jobs.get(id);
      if (!job || ended.includes(job.stage)) throw new ApiError(409, "SCAN_NOT_RUNNING");
      if (job.stage === "COLLECTING_EVIDENCE") throw new ApiError(409, "SCAN_NOT_CANCELLABLE");
      job.cancelRequested = true;
      return job;
    },
  };
}
export type Orchestrator = ReturnType<typeof createOrchestrator>;
