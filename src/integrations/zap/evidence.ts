import { createHash } from "node:crypto";
import { ApiError } from "../../lib/errors.ts";
import type { ZapClient } from "./client.ts";
import type { RunOutcome } from "./outcome.ts";
import { reconcile, type HostMismatch, type Reconciliation } from "./exceptions.ts";
import { parseRunLog, type ReadLog, type RunLog } from "./run-log.ts";

// Evidence contract v1.1, stored as contract_version 2. See docs/run-evidence-design.md in the documentation repository.
export const contractVersion = 2;
export const contractName = "1.1";
const acceptedSkips = new Set(["no Active Scan OAST service is selected"]);

export type Receipt = { scanId: string; associatedAt: Date };
export type Receipts = { spider: Receipt; active: Receipt };
export type Facts = {
  contract: string;
  sessionKey: string;
  target: string;
  log: RunLog;
  listing: Record<"spider" | "active", { state: string | null; progress: number | null } | null>;
  counts: { requests: number | null; alerts: number | null };
  attributedAlerts: number;
  progress: Awaited<ReturnType<ZapClient["scanProgress"]>>;
  scope: {
    spider: { evidence: string; count: number };
    active: { evidence: string; count: number; mismatches: HostMismatch[] };
  };
  credentialInLog: boolean;
  resourceFailure: boolean;
  reconciliations: { hostHeaders: Reconciliation; rawSocket: Reconciliation };
};
export type Judgement = { outcome: RunOutcome; reasons: string[] };

export async function collectEvidence(
  zap: ZapClient,
  getSession: () => Promise<string>,
  readLog: ReadLog,
  receipts: Receipts,
  target: string,
): Promise<Facts> {
  const sessionKey = await getSession();
  const sessionLocation = await zap.sessionLocation();
  const raw = await readLog();
  const log = parseRunLog(raw.text, {
    containerStartedAt: raw.containerStartedAt,
    sessionLocation,
    spiderId: receipts.spider.scanId,
    activeId: receipts.active.scanId,
  });
  async function listing(kind: "spider" | "active") {
    const rows = (await zap.inspectRuns(kind)).filter(
      (row) => row.id === receipts[kind].scanId,
    );
    if (rows.length > 1) throw new ApiError(409, "ZAP_RUN_AMBIGUOUS");
    return rows[0] ?? null;
  }
  const spider = await listing("spider"),
    active = await listing("active");
  const origin = new URL(target).origin;
  if (
    [spider, active].some(
      (row) => row?.reportedOrigin && row.reportedOrigin !== origin,
    )
  )
    throw new ApiError(409, "ZAP_RUN_OUTSIDE_TARGET");
  if (!spider || !active) throw new ApiError(404, "ZAP_RUN_NOT_FOUND");
  const base = {
    contract: contractName,
    sessionKey,
    target,
    log,
    listing: {
      spider: { state: spider.state, progress: spider.progress },
      active: { state: active.state, progress: active.progress },
    },
    counts: { requests: active.requests, alerts: active.alerts },
    attributedAlerts: await zap.inspectAlertIds(receipts.active.scanId),
    progress: await zap.scanProgress(receipts.active.scanId),
    scope: {
      spider: await zap.inspectScope("spider", receipts.spider.scanId, target),
      active: await zap.readActiveMessages(receipts.active.scanId, target),
    },
    credentialInLog:
      zap.mentionsCredential(raw.text) || zap.mentionsCredential(raw.errors),
    resourceFailure: /OutOfMemoryError|No space left on device/.test(raw.errors),
  };
  if ((await getSession()) !== sessionKey)
    throw new ApiError(409, "ZAP_SESSION_CHANGED");
  return { ...base, reconciliations: reconcile(base) };
}

// Any missing or contradictory item keeps the outcome UNKNOWN. Explicit stops and errors are
// reported as such only when the log itself is trustworthy.
export function judge(
  facts: Facts,
  receipts: Receipts,
): Record<"spider" | "active", Judgement> {
  const shared = new Set<string>(facts.log.anomalies);
  if (facts.contract !== contractName) shared.add("CONTRACT_VERSION");
  if (facts.credentialInLog) shared.add("CREDENTIAL_IN_LOG");
  if (facts.resourceFailure) shared.add("RESOURCE_FAILURE");
  const origin = new URL(facts.target).origin;
  const { spider, active } = facts.log;

  const spiderReasons = new Set(shared),
    activeReasons = new Set(shared);
  function common(
    reasons: Set<string>,
    kind: "spider" | "active",
    startedAt: string | undefined,
  ) {
    const listed = facts.listing[kind];
    if (listed?.state !== "FINISHED" || listed.progress !== 100)
      reasons.add("LISTING_NOT_FINISHED");
    if (
      !startedAt ||
      !(receipts[kind].associatedAt.getTime() >= Date.parse(startedAt))
    )
      reasons.add("RECEIPT_TIME");
  }
  common(spiderReasons, "spider", spider?.startedAt);
  if (!spider) spiderReasons.add("SPIDER_LOG_MISSING");
  else if (spider.target !== facts.target) spiderReasons.add("SPIDER_TARGET");
  if (facts.scope.spider.evidence !== "OBSERVED_TARGET_ORIGIN")
    spiderReasons.add("SPIDER_SCOPE");

  common(activeReasons, "active", active?.startedAt);
  if (!active) activeReasons.add("ACTIVE_LOG_MISSING");
  else {
    if (active.hosts.length !== 1 || active.hosts[0] !== origin)
      activeReasons.add("ACTIVE_HOST");
    if (!active.completedRules) activeReasons.add("NO_RULES");
    if (active.skippedRules.some((reason) => !acceptedSkips.has(reason)))
      activeReasons.add("RULES_SKIPPED");
    const [host] = facts.progress.hosts;
    if (facts.progress.hosts.length !== 1 || host.origin !== origin)
      activeReasons.add("PROGRESS_HOST");
    else if (
      host.rules.pending ||
      host.rules.running ||
      host.rules.unknown ||
      host.rules.complete !== active.completedRules ||
      host.rules.skipped !== active.skippedRules.length
    )
      activeReasons.add("PROGRESS_RULES");
  }
  // Recomputed here, so a stored reconciliation can never justify itself.
  const { reconciliations: stored, ...base } = facts;
  const computed = reconcile(base);
  if (canonical(stored) !== canonical(computed))
    activeReasons.add("RECONCILIATION_CHANGED");
  if (
    facts.scope.active.evidence !== "OBSERVED_TARGET_ORIGIN" ||
    computed.hostHeaders.result === "REJECTED"
  )
    activeReasons.add("ACTIVE_SCOPE");
  if (
    facts.counts.requests === null ||
    computed.rawSocket.result === "REJECTED"
  )
    activeReasons.add("MESSAGES_INCOMPLETE");
  if (
    facts.counts.alerts === null ||
    facts.counts.alerts !== facts.attributedAlerts
  )
    activeReasons.add("ALERTS_INCOMPLETE");

  const trusted = !shared.size;
  function decide(
    reasons: Set<string>,
    failure: "FAILED" | "CANCELLED" | null,
  ): Judgement {
    if (trusted && failure) return { outcome: failure, reasons: [] };
    if (failure) reasons.add("RUN_ENDED_EARLY");
    return {
      outcome: reasons.size ? "UNKNOWN" : "SUCCEEDED",
      reasons: [...reasons].sort(),
    };
  }
  return {
    spider: decide(
      spiderReasons,
      spider && spider.target === facts.target && !spider.complete
        ? "CANCELLED"
        : null,
    ),
    active: decide(
      activeReasons,
      active?.errored ? "FAILED" : active?.stopped ? "CANCELLED" : null,
    ),
  };
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const digest = (facts: Facts) =>
  createHash("sha256").update(canonical(facts)).digest("hex");
