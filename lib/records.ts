import { z } from "zod";
const assessmentFields = z.object({
  id: z.uuid(),
  targetId: z.uuid().optional(),
  website: z.string(),
  targetUrlSnapshot: z.string(),
  status: z.string(),
  requestedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  outcomeExplanation: z.string().nullish(),
  findingCount: z.number().int().nonnegative().nullable(),
});
function consistentCount(row: { status: string; findingCount: number | null }) {
  return (row.status === "COMPLETED") === (row.findingCount !== null);
}
export const assessment = assessmentFields.refine(consistentCount);
const when = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const count = z.number().int().nonnegative();
export const runEvidence = z.object({
  contract: z.string(),
  collectedAt: when,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  exclusions: z.array(z.string()).default([]),
  spider: z.object({ scanId: z.string(), startedAt: when, endedAt: when, results: count }),
  active: z.object({
    scanId: z.string(),
    startedAt: when,
    endedAt: when,
    completedRules: count,
    skippedRules: z.array(z.string()),
    stoppedRules: count,
    alerts: count,
    requests: count,
    messages: count,
  }),
  reconciliations: z.array(
    z.object({
      ruleId: z.string(),
      ruleName: z.string(),
      kind: z.enum(["HOST_HEADER", "RAW_SOCKET"]),
      expectedRequests: count,
      observedRequests: count,
      observedMessages: count,
      acceptedDiscrepancy: count,
      targetOrigin: z.string(),
      hostValues: z.array(z.string()),
    }),
  ),
});
export function statusLabel(status: string) {
  return (
    {
      PENDING: "Not started",
      INITIALIZING: "Last recorded: preparing",
      SPIDER_RUNNING: "Last recorded: finding pages",
      ACTIVE_SCAN_RUNNING: "Last recorded: testing pages",
      PROCESSING_RESULTS: "Importing results",
      COMPLETED: "Completed",
      FAILED: "Failed",
      CANCELLED: "Cancelled",
      OUTCOME_UNKNOWN: "Ended, outcome unknown",
    }[status] ?? status
  );
}
export const assessmentDetail = assessmentFields
  .extend({
    evidence: runEvidence.nullish(),
    severities: z
      .array(
        z.object({
          severity: z.string(),
          count: z.number().int().nonnegative(),
        }),
      )
      .nullable(),
  })
  .refine(consistentCount)
  .refine((row) => {
    if (row.findingCount === null) return row.severities === null;
    if (!row.severities || !row.finishedAt) return false;
    const categories = new Set(row.severities.map((group) => group.severity));
    return (
      categories.size === row.severities.length &&
      row.severities.reduce((sum, group) => sum + group.count, 0) ===
        row.findingCount
    );
  });
export function detailFor(id: string) {
  return assessmentDetail.refine((row) => row.id === id);
}
export const finding = z.object({
  id: z.uuid(),
  assessmentId: z.uuid(),
  website: z.string(),
  name: z.string(),
  normalizedSeverity: z.string(),
  url: z.string(),
  confidence: z.string(),
  method: z.string().nullish(),
  parameter: z.string().nullish(),
  firstObservedAt: z.iso.datetime(),
  description: z.string(),
  remediation: z.string().nullable(),
  cweId: z.number().nullable(),
  wascId: z.number().nullable(),
});
export const assessments = z.object({
  items: z.array(assessment),
  hasMore: z.boolean(),
});
export const findings = z.object({
  items: z.array(finding),
  hasMore: z.boolean(),
});
export const scans = z.object({
  provider: z.object({ endpoint: z.string(), version: z.string() }),
  runs: z.array(
    z.object({
      id: z.string().nullable(),
      state: z.string().nullable(),
      progress: z.number().nullable(),
      reportedOrigin: z.string().nullable(),
    }),
  ),
});

export const execution = z.object({
  status: z.string(),
  runs: z.array(
    z.object({
      kind: z.enum(["spider", "active"]),
      scan_id: z.string().regex(/^\d{1,12}$/),
      state: z.string().nullable(),
      progress: z.number().int().min(0).max(100).nullable(),
      observed_at: z.iso.datetime(),
    }),
  ),
});
