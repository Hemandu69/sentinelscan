import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  canonical,
  collectEvidence,
  digest,
  judge,
  type Facts,
} from "../src/integrations/zap/evidence.ts";
import { reconcile } from "../src/integrations/zap/exceptions.ts";
import { parseRunLog } from "../src/integrations/zap/run-log.ts";
import type { ZapClient } from "../src/integrations/zap/client.ts";

// Sanitized lifecycle lines from the real ZAP 2.17.0 run of 2026-11-23. Fixture evidence only.
const real = readFileSync(new URL("./fixtures/zap-run.log", import.meta.url), "utf8");
const options = {
  containerStartedAt: "2026-11-23T08:10:29.353446119Z",
  sessionLocation: "/home/zap/.ZAP/session/demo.session",
  spiderId: "0",
  activeId: "0",
};
const parse = (text = real, change = {}) => parseRunLog(text, { ...options, ...change });
const at = "2026-11-23T08:19:51.601800000Z 561800 ";
const before = (marker: string, ...added: string[]) => real.replace(new RegExp(`^.*${marker}.*$`, "m"), (row) => [...added, row].join("\n"));
const remove = (marker: string) => real.split("\n").filter((row) => !row.includes(marker)).join("\n");
const scanner = "INFO  org.parosproxy.paros.core.scanner.Scanner - ";
const stoppedLine = at + "[ZAP-IO-Server-1-1] " + scanner + "scanner with ID 0 stopped";
const errorLine = at + "[ZAP-Scanner-0] ERROR org.parosproxy.paros.core.scanner.Scanner - An error occurred while active scanning:";

const receipts = {
  spider: { scanId: "0", associatedAt: new Date("2026-11-23T08:14:36.779Z") },
  active: { scanId: "0", associatedAt: new Date("2026-11-23T08:14:55.232Z") },
};
function facts(change: Partial<Facts> = {}): Facts {
  const base = {
    contract: "1.1",
    sessionKey: "a".repeat(64),
    target: "http://juice-shop:3000/",
    log: parse(),
    listing: {
      spider: { state: "FINISHED", progress: 100 },
      active: { state: "FINISHED", progress: 100 },
    },
    counts: { requests: 1968, alerts: 24 },
    attributedAlerts: 24,
    progress: {
      hosts: [
        {
          origin: "http://juice-shop:3000",
          rules: { complete: 51, skipped: 1, running: 0, pending: 0, unknown: 0 },
          requests: 1968,
          named: [],
        },
      ],
    },
    scope: {
      spider: { evidence: "OBSERVED_TARGET_ORIGIN", count: 95 },
      active: { evidence: "OBSERVED_TARGET_ORIGIN", count: 1968, mismatches: [] },
    },
    credentialInLog: false,
    resourceFailure: false,
    ...change,
  };
  return { ...base, reconciliations: reconcile(base) };
}
test("real completed run parses without anomalies and satisfies the contract with complete API facts", () => {
  const log = parse();
  expect(log.anomalies).toEqual([]);
  expect(log.spider).toMatchObject({ target: "http://juice-shop:3000/", complete: true });
  expect(log.active).toMatchObject({
    completedRules: 51,
    skippedRules: ["no Active Scan OAST service is selected"],
    stoppedRules: 0,
    stopped: false,
    errored: false,
    alerts: 24,
    hosts: ["http://juice-shop:3000"],
  });
  expect(judge(facts(), receipts)).toEqual({
    spider: { outcome: "SUCCEEDED", reasons: [] },
    active: { outcome: "SUCCEEDED", reasons: [] },
  });
});
test("CRLF output is equivalent", () => {
  expect(parse(real.replaceAll("\n", "\r\n"))).toEqual(parse());
});
test("an explicit stop is CANCELLED although ZAP also logs completion", () => {
  const log = parse(before("scanner with ID 0 completed", stoppedLine));
  expect(log.active).toMatchObject({ stopped: true });
  expect(judge(facts({ log }), receipts).active).toEqual({ outcome: "CANCELLED", reasons: [] });
});
test("an explicit scanner error is FAILED although ZAP also logs completion", () => {
  for (const line of [errorLine, errorLine.replace("Scanner - An", "HostProcess - An")]) {
    const log = parse(before("scanner with ID 0 completed", line));
    expect(judge(facts({ log }), receipts).active.outcome).toBe("FAILED");
  }
});
test("a stopped spider is CANCELLED", () => {
  const log = parse(
    real
      .replace(/^.*Spidering process is complete.*$/m, "2026-11-23T08:14:18.274318600Z 228570 [ZAP-IO-Server-1-1] INFO  org.zaproxy.addon.spider.Spider - Stopping spidering process by request.")
      .replace("[ZAP-SpiderShutdownThread-0]", "[ZAP-IO-Server-1-1]")
      .replace("complete: true", "complete: false"),
  );
  expect(log.anomalies).toEqual([]);
  expect(judge(facts({ log }), receipts).spider.outcome).toBe("CANCELLED");
});
test.each([
  ["killed before completion", remove("scanner with ID 0 completed"), "ACTIVE_LOG_MISSING"],
  ["spider end missing", remove("Spider scanning complete"), "SPIDER_LOG_MISSING"],
  ["empty log", "", "LOG_TRUNCATED"],
  ["rotated start", real.split("\n").slice(1).join("\n"), "LOG_TRUNCATED"],
  ["rotated middle", real.split("\n").filter((_row, i) => i !== 40).join("\n"), "RULE_CONTRADICTION"],
  ["host completion missing", remove("completed host http"), "RULE_CONTRADICTION"],
  ["container restarted", real + "2026-11-23T09:00:00.000000000Z Found Java version 17.0.21\n", "LOG_RESTARTED"],
  ["out of memory", real + "2026-11-23T09:00:00.000000000Z java.lang.OutOfMemoryError: Java heap space\n", "RESOURCE_FAILURE"],
  ["session never created", remove("New session file"), "SESSION_NOT_IN_LOG"],
  ["second scan in session", before("scanner with ID 0 completed", at + "[ZAP-IO-Server-1-1] " + scanner + "scanner with ID 1 started"), "MULTIPLE_ACTIVE_SCANS"],
  ["duplicate completion", real + real.split("\n").find((r) => r.includes("scanner with ID 0 completed"))! + "\n", "MULTIPLE_ACTIVE_SCANS"],
  ["duplicate spider end", real + real.split("\n").find((r) => r.includes("Spider scanning complete"))! + "\n", "MULTIPLE_SPIDERS"],
  ["unrecognized scanner line", before("scanner with ID 0 completed", at + "[Thread-13] " + scanner + "something new"), "UNRECOGNIZED_LINE"],
  ["scanner warning", before("scanner with ID 0 completed", at + "[Thread-13] WARN  org.parosproxy.paros.core.scanner.HostProcess - x"), "UNEXPECTED_LEVEL"],
  ["interrupted rule without a stop line", before("scanner with ID 0 completed", at + "[ZAP-Scanner-0] INFO  org.parosproxy.paros.core.scanner.HostProcess - stopped host/plugin http://juice-shop:3000 | X in 1s with 1 message(s) sent and 0 alert(s) raised."), "RULE_CONTRADICTION"],
  ["forged stop of another scan", before("scanner with ID 0 completed", stoppedLine.replace("ID 0", "ID 7")), "ACTIVE_MISMATCH"],
  ["forged rule line from a request thread", before("scanner with ID 0 completed", at + "[ZAP-IO-Server-1-1] INFO  org.parosproxy.paros.core.scanner.HostProcess - start host http://juice-shop:3000 | X strength LOW threshold LOW"), "UNEXPECTED_THREAD"],
  ["out of order lines", real.replace("2026-11-23T08:19:51.601841122Z", "2026-11-23T08:00:00.000000000Z"), "LOG_ORDER"],
])("%s stays UNKNOWN", (_name, text, reason) => {
  const log = parse(text);
  const result = judge(facts({ log }), receipts);
  expect([...result.active.reasons, ...result.spider.reasons]).toContain(reason);
  expect([result.active.outcome, result.spider.outcome]).toContain("UNKNOWN");
  expect(result.active.outcome === "SUCCEEDED" && result.spider.outcome === "SUCCEEDED").toBe(false);
});
test("log text inside a message cannot imitate a lifecycle line", () => {
  const embedded = at + "[ZAP-IO-Server-1-1] WARN  org.zaproxy.zap.extension.api.API - Bad request " + stoppedLine;
  expect(parse(before("scanner with ID 0 completed", embedded))).toEqual(parse());
});
test("a forged full line can only withhold success, never create it", () => {
  // A truncated run plus an injected completion still lacks the rule and host evidence.
  const cut = real.split("\n").slice(0, 60).join("\n") + "\n" + at + "[Thread-13] " + scanner + "scanner with ID 0 completed in 1s\n";
  expect(judge(facts({ log: parse(cut) }), receipts).active.outcome).toBe("UNKNOWN");
});
test("an untrusted log never yields an explicit failure", () => {
  const log = parse(before("scanner with ID 0 completed", stoppedLine).split("\n").slice(1).join("\n"));
  expect(judge(facts({ log }), receipts).active).toMatchObject({ outcome: "UNKNOWN", reasons: expect.arrayContaining(["LOG_TRUNCATED", "RUN_ENDED_EARLY"]) });
});
test("a later session resets the window and other sessions never match", () => {
  const later = real + "2026-11-23T09:00:00.000000000Z 1 [ZAP-IO-Server-1-1] INFO  org.parosproxy.paros.control.Control - New session file created: /home/zap/.ZAP/session/other.session\n";
  expect(parse(later, { sessionLocation: "/home/zap/.ZAP/session/other.session" })).toMatchObject({ spider: null, active: null });
  expect(parse(later).anomalies).toContain("SESSION_NOT_IN_LOG");
});
test("different scan IDs never match", () => {
  expect(parse(real, { activeId: "1" }).anomalies).toContain("ACTIVE_MISMATCH");
  expect(parse(real, { spiderId: "1" }).anomalies).toContain("SPIDER_MISMATCH");
});
const host = facts().progress.hosts[0];
test.each<[string, Partial<Facts>, string]>([
  ["key in log", { credentialInLog: true }, "CREDENTIAL_IN_LOG"],
  ["resource failure", { resourceFailure: true }, "RESOURCE_FAILURE"],
  ["other contract", { contract: "2" }, "CONTRACT_VERSION"],
  ["running listing", { listing: { ...facts().listing, active: { state: "RUNNING", progress: 99 } } }, "LISTING_NOT_FINISHED"],
  ["missing listing", { listing: { ...facts().listing, active: null } }, "LISTING_NOT_FINISHED"],
  ["no hosts", { progress: { hosts: [] } }, "PROGRESS_HOST"],
  ["second host", { progress: { hosts: [host, host] } }, "PROGRESS_HOST"],
  ["other host", { progress: { hosts: [{ ...host, origin: "http://other.invalid" }] } }, "PROGRESS_HOST"],
  ["pending rule", { progress: { hosts: [{ ...host, rules: { ...host.rules, pending: 1 } }] } }, "PROGRESS_RULES"],
  ["unknown rule state", { progress: { hosts: [{ ...host, rules: { ...host.rules, unknown: 1 } }] } }, "PROGRESS_RULES"],
  ["rule count differs", { progress: { hosts: [{ ...host, rules: { ...host.rules, complete: 50 } }] } }, "PROGRESS_RULES"],
  ["no messages", { scope: { ...facts().scope, active: { evidence: "EMPTY", count: 0, mismatches: [] } } }, "ACTIVE_SCOPE"],
  ["message outside", { scope: { ...facts().scope, active: { evidence: "OUT_OF_SCOPE", count: 1968, mismatches: [] } } }, "ACTIVE_SCOPE"],
  ["messages not all retained", { counts: { requests: 1969, alerts: 24 } }, "MESSAGES_INCOMPLETE"],
  ["unknown request count", { counts: { requests: null, alerts: 24 } }, "MESSAGES_INCOMPLETE"],
  ["alerts differ", { attributedAlerts: 23 }, "ALERTS_INCOMPLETE"],
  ["rule time limit", { log: { ...parse(), active: { ...parse().active!, skippedRules: ["max rule duration"] } } }, "RULES_SKIPPED"],
  ["unexplained skip", { log: { ...parse(), active: { ...parse().active!, skippedRules: [""] } } }, "RULES_SKIPPED"],
  ["log of another host", { log: { ...parse(), active: { ...parse().active!, hosts: ["http://other.invalid"] } } }, "ACTIVE_HOST"],
  ["no rules ran", { log: { ...parse(), active: { ...parse().active!, completedRules: 0 } } }, "NO_RULES"],
])("%s stays UNKNOWN", (_name, change, reason) => {
  const result = judge(facts(change), receipts).active;
  expect(result.outcome).toBe("UNKNOWN");
  expect(result.reasons).toContain(reason);
});
test("spider evidence needs the exact target and scope", () => {
  const other = { ...parse(), spider: { ...parse().spider!, target: "http://juice-shop:3000/other" } };
  expect(judge(facts({ log: other }), receipts).spider.reasons).toContain("SPIDER_TARGET");
  const scope = { ...facts().scope, spider: { evidence: "UNKNOWN", count: 3 } };
  expect(judge(facts({ scope }), receipts).spider.reasons).toContain("SPIDER_SCOPE");
});
test("a receipt saved before its run began is refused", () => {
  const early = { ...receipts, active: { scanId: "0", associatedAt: new Date("2026-11-23T08:14:00Z") } };
  expect(judge(facts(), early).active).toMatchObject({ outcome: "UNKNOWN", reasons: ["RECEIPT_TIME"] });
});
test("digest ignores key order and detects any change", () => {
  const reversed = Object.fromEntries(Object.entries(facts()).reverse()) as Facts;
  expect(digest(reversed)).toBe(digest(facts()));
  expect(digest(facts({ attributedAlerts: 25 }))).not.toBe(digest(facts()));
  expect(JSON.parse(canonical(facts()))).toEqual(JSON.parse(JSON.stringify(facts())));
});
test("stored facts contain no log line, header, path or message text", () => {
  expect(canonical(facts())).not.toMatch(/INFO|PathTraversalScanRule|session\/|Host:|HTTP\/1/);
});

function provider(change: Partial<Record<keyof ZapClient, unknown>> = {}) {
  const row = (kind: string) => ({ id: "0", state: "FINISHED", progress: 100, reportedOrigin: null, requests: kind === "active" ? 1968 : null, alerts: kind === "active" ? 24 : null });
  return {
    sessionLocation: async () => options.sessionLocation,
    inspectRuns: async (kind: string) => [row(kind)],
    inspectAlertIds: async () => 24,
    scanProgress: async () => facts().progress,
    inspectScope: async () => facts().scope.spider,
    readActiveMessages: async () => facts().scope.active,
    mentionsCredential: (text: string) => text.includes("fixture-key"),
    ...change,
  } as unknown as ZapClient;
}
const log = (errors = "") => async () => ({ containerStartedAt: options.containerStartedAt, text: real, errors });
const collect = (zap: ZapClient, session = async () => "a".repeat(64), errors = "") =>
  collectEvidence(zap, session, log(errors), receipts, "http://juice-shop:3000/");
test("collector assembles deterministic facts", async () => {
  expect(await collect(provider())).toEqual(facts());
});
test("collector flags a key or resource failure in stderr", async () => {
  expect(await collect(provider(), undefined, "fixture-key")).toMatchObject({ credentialInLog: true });
  expect(await collect(provider(), undefined, "java.lang.OutOfMemoryError")).toMatchObject({ resourceFailure: true });
});
test("collector refuses a changed session, missing, duplicate or foreign run", async () => {
  const keys = ["a", "b"];
  await expect(collect(provider(), async () => keys.shift()!)).rejects.toThrow("ZAP_SESSION_CHANGED");
  await expect(collect(provider({ inspectRuns: async () => [] }))).rejects.toThrow("ZAP_RUN_NOT_FOUND");
  await expect(collect(provider({ inspectRuns: async () => [{ id: "0" }, { id: "0" }] }))).rejects.toThrow("ZAP_RUN_AMBIGUOUS");
  await expect(collect(provider({ inspectRuns: async () => [{ id: "0", reportedOrigin: "http://other.invalid" }] }))).rejects.toThrow("ZAP_RUN_OUTSIDE_TARGET");
});
