import type { z } from "zod";
import { request, RequestFailure } from "./api.ts";
import { issueList } from "./issues.ts";
import { assessmentDetail, finding, findings } from "./records.ts";

export async function loadReport(id: string, signal: AbortSignal) {
  const assessment = assessmentDetail.parse(
    await request("/api/v1/assessments/" + encodeURIComponent(id), signal),
  );
  if (
    assessment.id !== id ||
    assessment.status !== "COMPLETED" ||
    assessment.findingCount === null ||
    !assessment.severities ||
    !assessment.finishedAt
  )
    throw new RequestFailure(
      "A completed assessment with final results is required for a report.",
    );

  const items: z.infer<typeof finding>[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (;;) {
    const query = new URLSearchParams({
      assessmentId: id,
      offset: String(items.length),
      sort: "title",
    });
    const page = findings.parse(
      await request("/api/v1/findings?" + query, signal),
    );
    for (const row of page.items) {
      if (row.assessmentId !== id || seen.has(row.id))
        throw new RequestFailure(
          "The findings contain a duplicate or belong to another assessment.",
        );
      seen.add(row.id);
      items.push(row);
      counts.set(
        row.normalizedSeverity,
        (counts.get(row.normalizedSeverity) ?? 0) + 1,
      );
    }
    if (!page.hasMore) break;
    if (!page.items.length || items.length >= assessment.findingCount)
      throw new RequestFailure(
        "The finding list changed while loading the report. Reload to try again.",
      );
  }
  if (items.length !== assessment.findingCount)
    throw new RequestFailure(
      "The finding count differs from the assessment total. Reload to try again.",
    );
  const reported = new Set<string>();
  for (const group of assessment.severities) {
    if (reported.has(group.severity))
      throw new RequestFailure("The assessment repeats a severity category.");
    reported.add(group.severity);
    if (group.count !== (counts.get(group.severity) ?? 0))
      throw new RequestFailure(
        "The severity totals differ from the assessment. Reload to try again.",
      );
    counts.delete(group.severity);
  }
  if (counts.size)
    throw new RequestFailure("The assessment severity summary is incomplete.");
  // Issues only regroup the verified records. Every finding must appear exactly once.
  const issues = issueList.parse(
    await request("/api/v1/issues?assessmentId=" + encodeURIComponent(id), signal),
  );
  const grouped = issues.issues.flatMap((row) => row.findings.map((f) => f.id));
  const byId = new Map(items.map((row) => [row.id, row]));
  if (
    grouped.length !== items.length ||
    new Set(grouped).size !== grouped.length ||
    issues.issues.some(
      (issue) =>
        issue.assessmentId !== id ||
        issue.findings.some((f) => {
          const row = byId.get(f.id);
          return (
            !row ||
            row.url !== f.url ||
            row.name !== issue.scanner.title ||
            row.normalizedSeverity !== issue.scanner.severity ||
            row.confidence !== issue.scanner.confidence
          );
        }),
    )
  )
    throw new RequestFailure(
      "The grouped issues differ from the recorded findings. Reload to try again.",
    );
  return { assessment, items, issues };
}
