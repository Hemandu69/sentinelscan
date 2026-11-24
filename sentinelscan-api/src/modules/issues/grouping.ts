import { createHash } from "node:crypto";

export type FindingRow = {
  id: string;
  assessmentId: string;
  sourceRuleId: string | null;
  name: string;
  sourceSeverity: string;
  normalizedSeverity: string;
  confidence: string;
  url: string;
  method: string | null;
  parameter: string | null;
  redactedEvidence: string | null;
  description: string;
  remediation: string | null;
  references: string[];
  cweId: number | null;
  wascId: number | null;
  firstObservedAt: Date;
};
// Findings form one issue only when the scanner reported the same thing about different
// locations. Anything that differs, including severity or wording, stays separate.
export function issueKey(row: FindingRow) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.assessmentId,
        row.sourceRuleId,
        row.name,
        row.sourceSeverity,
        row.normalizedSeverity,
        row.confidence,
        row.method,
        row.parameter,
        row.description,
        row.remediation,
        row.cweId,
        row.wascId,
      ]),
    )
    .digest("hex");
}
export const severityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
export function groupFindings<T extends FindingRow>(rows: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = issueKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const rank = (value: string) =>
    severityOrder.includes(value) ? severityOrder.indexOf(value) : severityOrder.length;
  return [...groups]
    .map(([key, members]) => ({
      key,
      findings: [...members].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : a.id < b.id ? -1 : 1)),
    }))
    .sort((a, b) => {
      const x = a.findings[0],
        y = b.findings[0];
      return (
        rank(x.normalizedSeverity) - rank(y.normalizedSeverity) ||
        (x.name < y.name ? -1 : x.name > y.name ? 1 : a.key < b.key ? -1 : 1)
      );
    });
}
