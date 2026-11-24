import { z } from "zod";

const count = z.number().int().nonnegative();
export const analysisResult = z.object({
  plainTitle: z.string(),
  summary: z.string(),
  whatHappened: z.string(),
  whyItMatters: z.string(),
  technicalExplanation: z.string(),
  potentialImpact: z.string(),
  practicalPriority: z.enum(["NO_ACTION", "LOW", "MEDIUM", "HIGH", "URGENT"]),
  priorityReason: z.string(),
  recommendedAction: z.string(),
  remediation: z.array(z.string()),
  verificationSteps: z.array(z.string()),
  falsePositiveNotes: z.string(),
  limitations: z.string(),
  evidenceSufficient: z.boolean(),
  exampleCode: z.string().nullable(),
});
export const issue = z
  .object({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    assessmentId: z.uuid(),
    website: z.string(),
    scanner: z.object({
      title: z.string(),
      ruleId: z.string().nullable(),
      severity: z.string(),
      sourceSeverity: z.string(),
      confidence: z.string(),
      method: z.string().nullable(),
      parameter: z.string().nullable(),
      evidence: z.string().nullable(),
      description: z.string(),
      remediation: z.string().nullable(),
      references: z.array(z.string()),
      cweId: z.number().nullable(),
      wascId: z.number().nullable(),
    }),
    guide: z
      .object({
        plainTitle: z.string(),
        summary: z.string(),
        whatHappened: z.string(),
        whyItMatters: z.string(),
        nextAction: z.string(),
        verify: z.array(z.string()),
      })
      .nullable(),
    findings: z
      .array(z.object({ id: z.uuid(), url: z.string(), firstObservedAt: z.iso.datetime() }))
      .min(1),
    endpoints: z.array(z.string()).min(1),
    analysis: z.object({
      status: z.enum(["COMPLETED", "PARTIAL", "FAILED", "NONE"]),
      errorCode: z.string().nullable(),
      provider: z.string().nullable(),
      model: z.string().nullable(),
      analysedAt: z.iso.datetime().nullable(),
      result: analysisResult.nullable(),
    }),
  })
  .refine((row) => row.analysis.status !== "COMPLETED" || row.analysis.result !== null);
export type Issue = z.infer<typeof issue>;
export const issueList = z
  .object({
    counts: z.object({
      originalAlerts: count.nullable(),
      findings: count,
      issues: count,
      endpoints: count,
    }),
    severities: z.record(z.string(), count),
    coverage: z.object({ analysed: count, unanalysed: count }),
    issues: z.array(issue),
  })
  .refine(
    (data) =>
      data.counts.issues === data.issues.length &&
      data.counts.findings ===
        data.issues.reduce((sum, row) => sum + row.findings.length, 0) &&
      data.coverage.analysed + data.coverage.unanalysed === data.counts.issues &&
      Object.values(data.severities).reduce((sum, n) => sum + n, 0) === data.counts.issues,
  );
export type IssueList = z.infer<typeof issueList>;
export const analysisStatus = z.object({
  enabled: z.boolean(),
  reason: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  storageReady: z.boolean(),
});
export const severityName = (value: string) =>
  ({ CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low", INFO: "Informational" })[value] ?? "Other";
export const priorityName = (value: string) =>
  ({ NO_ACTION: "No action expected", LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" })[value] ?? value;

// Scanner facts are never replaced. Explanations come from AI when analysed, otherwise from
// SentinelScan's own guide, otherwise from the scanner, and the origin is always shown.
export function explain(row: Issue) {
  const ai = row.analysis.result;
  if (ai)
    return {
      origin: "ai" as const,
      title: ai.plainTitle,
      summary: ai.summary,
      what: ai.whatHappened,
      why: ai.whyItMatters,
      action: ai.recommendedAction,
      verify: ai.verificationSteps,
    };
  if (row.guide)
    return {
      origin: "guide" as const,
      title: row.guide.plainTitle,
      summary: row.guide.summary,
      what: row.guide.whatHappened,
      why: row.guide.whyItMatters,
      action: row.guide.nextAction,
      verify: row.guide.verify,
    };
  return {
    origin: "scanner" as const,
    title: row.scanner.title,
    summary: firstSentence(row.scanner.description) || "The scanner supplied no explanation.",
    what: row.scanner.description || "The scanner supplied no explanation.",
    why: null,
    action: row.scanner.remediation
      ? "Review the scanner's recommended fix."
      : "Review the affected location and the scanner references.",
    verify: [],
  };
}
export const originLabel = {
  ai: "AI interpretation",
  guide: "SentinelScan guide",
  scanner: "Scanner record",
} as const;
function firstSentence(value: string) {
  const text = value.trim();
  const end = text.search(/[.!?](\s|$)/);
  return (end < 0 ? text : text.slice(0, end + 1)).slice(0, 240);
}
export function analysisLabel(status: Issue["analysis"]["status"]) {
  return {
    COMPLETED: "AI analysed",
    PARTIAL: "Partly AI analysed",
    FAILED: "AI analysis failed",
    NONE: "Not AI analysed",
  }[status];
}
export function disabledReason(reason: string | null, storageReady: boolean) {
  if (reason === "AI_DISABLED") return "AI analysis is not configured. Everything else works without it.";
  if (reason === "AI_MISSING_KEY") return "AI analysis is selected, but no API key is configured.";
  if (reason) return "The AI configuration is not valid.";
  return storageReady ? null : "AI analysis is configured, but its database table is not available.";
}
// An attention list, not a score. It uses only the scanner's severity.
export function summarize(data: IssueList) {
  const attention = data.issues.filter((row) => row.scanner.severity !== "INFO");
  const informational = data.issues.filter((row) => row.scanner.severity === "INFO");
  return {
    attention,
    informational,
    headline: !data.issues.length
      ? "The scan recorded no findings."
      : attention.length
        ? `${attention.length} ${attention.length === 1 ? "issue needs" : "issues need"} attention.`
        : "Only informational observations were recorded. None needs urgent attention on this evidence.",
  };
}
