import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { judge, type Facts } from "../src/integrations/zap/evidence.ts";
import { hostHeaderRule, rawSocketRule, reconcile } from "../src/integrations/zap/exceptions.ts";
import { parseRunLog } from "../src/integrations/zap/run-log.ts";

// Contract v1.1 decisions, checked with fixtures built on a real sanitized log.
const text = readFileSync(new URL("./fixtures/zap-run.log", import.meta.url), "utf8");
const parse = (value = text) =>
  parseRunLog(value, {
    containerStartedAt: "2026-11-23T08:10:29.353446119Z",
    sessionLocation: "/home/zap/.ZAP/session/demo.session",
    spiderId: "0",
    activeId: "0",
  });
const log = parse();
const window = log.active!.rules.CloudMetadataScanRule!;
const inWindow = Date.parse(window.startedAt) + 10;
const values = [...hostHeaderRule.hosts];
const mismatch = (i: number) => ({
  messageId: String(1350 + i),
  host: values[i % values.length],
  sentAt: inWindow + i,
});
const mismatches = (n: number) => Array.from({ length: n }, (_, i) => mismatch(i));
const named = () => [
  { id: "20015", name: rawSocketRule.name, status: "Complete", requests: 3 as number | null },
  { id: "90034", name: hostHeaderRule.name, status: "Complete", requests: 13 as number | null },
];
type Base = Omit<Facts, "reconciliations">;
function base(): Base {
  return {
    contract: "1.1",
    sessionKey: "a".repeat(64),
    target: "http://juice-shop:3000/",
    log: structuredClone(log),
    listing: { spider: { state: "FINISHED", progress: 100 }, active: { state: "FINISHED", progress: 100 } },
    counts: { requests: 3005, alerts: 24 },
    attributedAlerts: 24,
    progress: {
      hosts: [
        {
          origin: "http://juice-shop:3000",
          rules: { complete: 51, skipped: 1, running: 0, pending: 0, unknown: 0 },
          requests: log.active!.messagesSent,
          named: named(),
        },
      ],
    },
    scope: {
      spider: { evidence: "OBSERVED_TARGET_ORIGIN", count: 72 },
      active: { evidence: "OBSERVED_TARGET_ORIGIN", count: 3002, mismatches: mismatches(13) },
    },
    credentialInLog: false,
    resourceFailure: false,
  };
}
const receipts = {
  spider: { scanId: "0", associatedAt: new Date("2026-11-23T08:14:36.779Z") },
  active: { scanId: "0", associatedAt: new Date("2026-11-23T08:14:55.232Z") },
};
function run(change: (facts: Base) => void = () => {}) {
  const facts = base();
  change(facts);
  const reconciliations = reconcile(facts);
  return { reconciliations, ...judge({ ...facts, reconciliations }, receipts).active };
}
test("the log independently counts both rules", () => {
  expect(window).toMatchObject({ messages: 13, completed: true });
  expect(log.active!.rules.HeartBleedActiveScanRule).toMatchObject({ messages: 3, completed: true });
  expect(log.active!.messagesSent).toBe(1968);
});
test("exactly 13 attributed mismatches and 3 raw probes are accepted and recorded", () => {
  const result = run();
  expect(result).toMatchObject({ outcome: "SUCCEEDED", reasons: [] });
  expect(result.reconciliations.hostHeaders).toMatchObject({
    ruleId: "90034", expectedRequests: 13, observedRequests: 13, loggedRequests: 13, observedMessages: 13,
    acceptedDiscrepancy: 13, targetOrigin: "http://juice-shop:3000", result: "ACCEPTED", failures: [],
  });
  expect(result.reconciliations.hostHeaders.hostHeaders).toHaveLength(13);
  expect(result.reconciliations.hostHeaders.hostHeaders.every((row) => row.reason.includes("90034"))).toBe(true);
  expect(result.reconciliations.rawSocket).toMatchObject({
    ruleId: "20015", expectedRequests: 3, observedRequests: 3, loggedRequests: 3, observedMessages: 0,
    acceptedDiscrepancy: 3, result: "ACCEPTED", failures: [],
  });
});
const rule = (facts: Base, id: string) => facts.progress.hosts[0].named.find((row) => row.id === id)!;
test.each<[string, (facts: Base) => void, string]>([
  ["12 mismatches", (f) => (f.scope.active.mismatches = mismatches(12)), "MISMATCH_COUNT"],
  ["14 mismatches", (f) => (f.scope.active.mismatches = mismatches(14)), "MISMATCH_COUNT"],
  ["12 mismatches and 12 reported requests", (f) => { f.scope.active.mismatches = mismatches(12); rule(f, "90034").requests = 12; }, "RULE_REQUESTS"],
  ["14 mismatches and 14 reported requests", (f) => { f.scope.active.mismatches = mismatches(14); rule(f, "90034").requests = 14; }, "RULE_REQUESTS"],
  ["another rule's identity", (f) => (rule(f, "90034").name = "Other rule"), "RULE_MISSING"],
  ["attribution to another rule only", (f) => (f.progress.hosts[0].named = named().filter((r) => r.id !== "90034")), "RULE_MISSING"],
  ["rule listed twice", (f) => f.progress.hosts[0].named.push(named()[1]), "RULE_MISSING"],
  ["requests outside the rule's window", (f) => (f.scope.active.mismatches[3].sentAt = Date.parse(window.endedAt) + 1000), "OUTSIDE_RULE_WINDOW"],
  ["a request without a time", (f) => (f.scope.active.mismatches[3].sentAt = 0), "OUTSIDE_RULE_WINDOW"],
  ["an unknown host value", (f) => (f.scope.active.mismatches[0].host = "evil.example"), "HOST_VALUE"],
  ["an arbitrary private address", (f) => (f.scope.active.mismatches[0].host = "10.0.0.1"), "HOST_VALUE"],
  ["a loopback address", (f) => (f.scope.active.mismatches[0].host = "127.0.0.1"), "HOST_VALUE"],
  ["a listed value with a port", (f) => (f.scope.active.mismatches[0].host = "169.254.169.254:80"), "HOST_VALUE"],
  ["a subdomain of a listed value", (f) => (f.scope.active.mismatches[0].host = "x.aws.zaproxy.org"), "HOST_VALUE"],
  ["a duplicated message", (f) => (f.scope.active.mismatches[1].messageId = f.scope.active.mismatches[0].messageId), "DUPLICATE_MESSAGE"],
  ["a URL outside the origin", (f) => (f.scope.active.evidence = "OUT_OF_SCOPE"), "MESSAGE_ORIGIN"],
  ["an unparsed URL", (f) => (f.scope.active.evidence = "UNKNOWN"), "MESSAGE_ORIGIN"],
  ["another destination host", (f) => (f.progress.hosts[0].origin = "http://other:3000"), "PROGRESS_HOST"],
  ["another destination port", (f) => (f.progress.hosts[0].origin = "http://juice-shop:3001"), "PROGRESS_HOST"],
  ["a second host", (f) => f.progress.hosts.push(f.progress.hosts[0]), "PROGRESS_HOST"],
  ["no scan progress", (f) => (f.progress.hosts = []), "PROGRESS_HOST"],
  ["another host in the log", (f) => (f.log.active!.hosts = ["http://other:3000"]), "LOG_HOST"],
  ["an incomplete rule", (f) => (rule(f, "90034").status = "40%"), "RULE_INCOMPLETE"],
  ["a skipped rule", (f) => (rule(f, "90034").status = "Skipped"), "RULE_INCOMPLETE"],
  ["a rule missing from the log", (f) => (f.log.active!.rules.CloudMetadataScanRule = null), "RULE_LOG_MISSING"],
  ["a different logged count", (f) => (f.log.active!.rules.CloudMetadataScanRule!.messages = 12), "RULE_LOG_REQUESTS"],
  ["disagreeing rule totals", (f) => (f.progress.hosts[0].requests = 1969), "RULE_TOTALS"],
])("rule 90034: %s is rejected", (_name, change, failure) => {
  const result = run(change);
  expect(result.reconciliations.hostHeaders).toMatchObject({ result: "REJECTED", acceptedDiscrepancy: 0 });
  expect(result.reconciliations.hostHeaders.failures).toContain(failure);
  expect(result.outcome).toBe("UNKNOWN");
  expect(result.reasons).toContain("ACTIVE_SCOPE");
});
test.each<[string, (facts: Base) => void, string]>([
  ["two missing", (f) => (f.counts.requests = 3004), "MISSING_COUNT"],
  ["four missing", (f) => (f.counts.requests = 3006), "MISSING_COUNT"],
  ["two missing and two reported", (f) => { f.counts.requests = 3004; rule(f, "20015").requests = 2; }, "RULE_REQUESTS"],
  ["four missing and four reported", (f) => { f.counts.requests = 3006; rule(f, "20015").requests = 4; }, "RULE_REQUESTS"],
  ["more messages than requests", (f) => (f.counts.requests = 2999), "MISSING_COUNT"],
  ["another rule's identity", (f) => (rule(f, "20015").name = "Other rule"), "RULE_MISSING"],
  ["attribution to another rule only", (f) => (f.progress.hosts[0].named = named().filter((r) => r.id !== "20015")), "RULE_MISSING"],
  ["an incomplete rule", (f) => (rule(f, "20015").status = "Pending"), "RULE_INCOMPLETE"],
  ["a skipped rule", (f) => (f.log.active!.rules.HeartBleedActiveScanRule!.completed = false), "RULE_LOG_MISSING"],
  ["another scan host", (f) => (f.progress.hosts[0].origin = "http://other:3000"), "PROGRESS_HOST"],
  ["another scan port", (f) => (f.progress.hosts[0].origin = "http://juice-shop:8443"), "PROGRESS_HOST"],
  ["an unknown reported count", (f) => (rule(f, "20015").requests = null), "RULE_REQUESTS"],
  ["an error event", (f) => (f.log.active!.errored = true), "LIFECYCLE"],
  ["a stop event", (f) => (f.log.active!.stopped = true), "LIFECYCLE"],
  ["a log anomaly", (f) => f.log.anomalies.push("LOG_TRUNCATED"), "LIFECYCLE"],
])("rule 20015: %s is rejected", (_name, change, failure) => {
  const result = run(change);
  expect(result.reconciliations.rawSocket).toMatchObject({ result: "REJECTED", acceptedDiscrepancy: 0 });
  expect(result.reconciliations.rawSocket.failures).toContain(failure);
  expect(result.outcome).not.toBe("SUCCEEDED");
});
test("an unknown request total is rejected", () => {
  const result = run((f) => (f.counts.requests = null));
  expect(result.reasons).toContain("MESSAGES_INCOMPLETE");
});
test("one exception never excuses the other", () => {
  expect(run((f) => (f.scope.active.mismatches = mismatches(12))).reasons).toEqual(["ACTIVE_SCOPE"]);
  expect(run((f) => (f.counts.requests = 3006)).reasons).toEqual(["MESSAGES_INCOMPLETE"]);
});
test.each<[string, (facts: Base) => void, string]>([
  ["pending rule", (f) => (f.progress.hosts[0].rules.pending = 1), "PROGRESS_RULES"],
  ["incomplete alerts", (f) => (f.attributedAlerts = 23), "ALERTS_INCOMPLETE"],
  ["running listing", (f) => (f.listing.active!.state = "RUNNING"), "LISTING_NOT_FINISHED"],
  ["key in log", (f) => (f.credentialInLog = true), "CREDENTIAL_IN_LOG"],
  ["other contract", (f) => (f.contract = "1"), "CONTRACT_VERSION"],
])("accepted exceptions never excuse a %s", (_name, change, reason) => {
  expect(run(change)).toMatchObject({ outcome: "UNKNOWN", reasons: expect.arrayContaining([reason]) });
});
test("a supplied reconciliation cannot justify itself", () => {
  const facts = base();
  const accepted = reconcile(facts);
  facts.scope.active.mismatches = mismatches(14);
  const result = judge({ ...facts, reconciliations: accepted }, receipts).active;
  expect(result.outcome).toBe("UNKNOWN");
  expect(result.reasons).toEqual(expect.arrayContaining(["ACTIVE_SCOPE", "RECONCILIATION_CHANGED"]));
});
test("without any discrepancy no exception is used", () => {
  const result = run((f) => { f.scope.active.mismatches = []; f.counts.requests = 3002; });
  expect(result.outcome).toBe("SUCCEEDED");
  expect(result.reconciliations.hostHeaders.result).toBe("NOT_NEEDED");
  expect(result.reconciliations.rawSocket).toMatchObject({ result: "NOT_NEEDED", acceptedDiscrepancy: 0 });
});
test("the exceptions are fixed and not configurable", () => {
  expect([hostHeaderRule.id, hostHeaderRule.requests, rawSocketRule.id, rawSocketRule.requests]).toEqual(["90034", 13, "20015", 3]);
  expect([...hostHeaderRule.hosts].sort()).toEqual(["100.100.100.200", "169.254.169.254", "alibaba.zaproxy.org", "aws.zaproxy.org", "metadata.google.internal", "metadata.oraclecloud.com"]);
  const source = readFileSync(new URL("../src/integrations/zap/exceptions.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/process\.env|readFile|\*\./);
});
