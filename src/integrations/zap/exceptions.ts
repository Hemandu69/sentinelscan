import type { Facts } from "./evidence.ts";

// Evidence contract v1.1. Exactly two owner-approved exceptions, fixed in code and not configurable.
// Values are those verified in the assessment of 2026-11-24 with ZAP 2.17.0 and ascanrules 84.
export const hostHeaderRule = {
  id: "90034",
  name: "Cloud Metadata Potentially Exposed",
  codeName: "CloudMetadataScanRule",
  requests: 13,
  hosts: new Set([
    "169.254.169.254",
    "aws.zaproxy.org",
    "metadata.google.internal",
    "metadata.oraclecloud.com",
    "100.100.100.200",
    "alibaba.zaproxy.org",
  ]),
};
export const rawSocketRule = {
  id: "20015",
  name: "Heartbleed OpenSSL Vulnerability",
  codeName: "HeartBleedActiveScanRule",
  requests: 3,
};
export type HostMismatch = { messageId: string; host: string; sentAt: number };
export type Reconciliation = {
  ruleId: string;
  ruleName: string;
  kind: "HOST_HEADER" | "RAW_SOCKET";
  expectedRequests: number;
  observedRequests: number | null;
  loggedRequests: number | null;
  observedMessages: number;
  acceptedDiscrepancy: number;
  targetOrigin: string;
  hostHeaders: (HostMismatch & { reason: string })[];
  source: string[];
  result: "ACCEPTED" | "NOT_NEEDED" | "REJECTED";
  failures: string[];
};
type Input = Omit<Facts, "reconciliations">;

function sharedFailures(facts: Input, rule: typeof hostHeaderRule | typeof rawSocketRule) {
  const failures: string[] = [];
  const origin = new URL(facts.target).origin;
  const active = facts.log.active;
  const [host] = facts.progress.hosts;
  if (facts.progress.hosts.length !== 1 || host.origin !== origin)
    failures.push("PROGRESS_HOST");
  if (!active || active.hosts.length !== 1 || active.hosts[0] !== origin)
    failures.push("LOG_HOST");
  if (facts.log.anomalies.length || active?.errored || active?.stopped || active?.stoppedRules)
    failures.push("LIFECYCLE");
  const rows = (host?.named ?? []).filter((row) => row.id === rule.id);
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.name !== rule.name) failures.push("RULE_MISSING");
  else if (row.status !== "Complete") failures.push("RULE_INCOMPLETE");
  else if (row.requests !== rule.requests) failures.push("RULE_REQUESTS");
  const logged = active?.rules[rule.codeName as keyof typeof active.rules] ?? null;
  if (!logged || !logged.completed) failures.push("RULE_LOG_MISSING");
  else if (logged.messages !== rule.requests) failures.push("RULE_LOG_REQUESTS");
  // Both sources must also agree on the total that all rules sent.
  if (!active || host?.requests !== active.messagesSent)
    failures.push("RULE_TOTALS");
  return { failures, row, logged, origin };
}

export function reconcileHostHeaders(facts: Input): Reconciliation {
  const rule = hostHeaderRule;
  const { failures, row, logged, origin } = sharedFailures(facts, rule);
  const { mismatches } = facts.scope.active;
  const needed = mismatches.length > 0;
  if (mismatches.length !== rule.requests) failures.push("MISMATCH_COUNT");
  if (new Set(mismatches.map((m) => m.messageId)).size !== mismatches.length)
    failures.push("DUPLICATE_MESSAGE");
  if (mismatches.some((m) => !rule.hosts.has(m.host))) failures.push("HOST_VALUE");
  // Requests carry no rule ID. The log's own start and end of this rule attribute them.
  if (
    !logged ||
    mismatches.some(
      (m) =>
        !(m.sentAt >= Date.parse(logged.startedAt) && m.sentAt <= Date.parse(logged.endedAt)),
    )
  )
    failures.push("OUTSIDE_RULE_WINDOW");
  if (facts.scope.active.evidence !== "OBSERVED_TARGET_ORIGIN")
    failures.push("MESSAGE_ORIGIN");
  const accepted = needed && !failures.length;
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    kind: "HOST_HEADER",
    expectedRequests: rule.requests,
    observedRequests: row?.requests ?? null,
    loggedRequests: logged?.messages ?? null,
    observedMessages: mismatches.length,
    acceptedDiscrepancy: accepted ? mismatches.length : 0,
    targetOrigin: origin,
    hostHeaders: mismatches.map((m) => ({
      ...m,
      reason: accepted
        ? "Forged by rule 90034. Request URL and scan host are the authorized origin; value, count and time window match the rule."
        : "Not accepted.",
    })),
    source: ["core/view/message", "ascan/view/scanProgress", "container log"],
    result: accepted ? "ACCEPTED" : needed ? "REJECTED" : "NOT_NEEDED",
    failures: needed ? [...new Set(failures)].sort() : [],
  };
}

export function reconcileRawSocket(facts: Input): Reconciliation {
  const rule = rawSocketRule;
  const { failures, row, logged, origin } = sharedFailures(facts, rule);
  const requests = facts.counts.requests;
  const missing = requests === null ? null : requests - facts.scope.active.count;
  const needed = missing !== 0;
  if (missing !== rule.requests) failures.push("MISSING_COUNT");
  const accepted = needed && !failures.length;
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    kind: "RAW_SOCKET",
    expectedRequests: rule.requests,
    observedRequests: row?.requests ?? null,
    loggedRequests: logged?.messages ?? null,
    observedMessages: 0,
    acceptedDiscrepancy: accepted ? rule.requests : 0,
    targetOrigin: origin,
    hostHeaders: [],
    source: ["ascan/view/scans", "ascan/view/messagesIds", "ascan/view/scanProgress", "container log"],
    result: accepted ? "ACCEPTED" : needed ? "REJECTED" : "NOT_NEEDED",
    failures: needed ? [...new Set(failures)].sort() : [],
  };
}
export const reconcile = (facts: Input) => ({
  hostHeaders: reconcileHostHeaders(facts),
  rawSocket: reconcileRawSocket(facts),
});
