import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Facts } from "../../integrations/zap/evidence.ts";
import { ApiError } from "../../lib/errors.ts";

type Row = {
  id: string;
  fingerprint: string;
  name: string;
  url: string;
  normalizedSeverity: string;
  sourceSeverity: string;
  confidence: string;
  description: string;
  remediation: string | null;
};
// Coverage must match before any difference means anything.
export function comparable(earlier: Facts | null, later: Facts | null) {
  const reasons: string[] = [];
  if (!earlier || !later) return ["EVIDENCE_MISSING"];
  const a = earlier.log.active,
    b = later.log.active;
  if (!a || !b) return ["EVIDENCE_MISSING"];
  if (earlier.target !== later.target) reasons.push("DIFFERENT_TARGET");
  if (earlier.contract !== later.contract) reasons.push("DIFFERENT_CONTRACT");
  if (a.completedRules !== b.completedRules || a.skippedRules.join("\n") !== b.skippedRules.join("\n"))
    reasons.push("DIFFERENT_RULES");
  return reasons;
}
const changedFields = (a: Row, b: Row) =>
  (["normalizedSeverity", "sourceSeverity", "confidence", "description", "remediation"] as const).filter(
    (field) => a[field] !== b[field],
  );
export function compare(earlier: readonly Row[], later: readonly Row[]) {
  const before = new Map(earlier.map((row) => [row.fingerprint, row]));
  const after = new Map(later.map((row) => [row.fingerprint, row]));
  const brief = (row: Row) => ({ id: row.id, name: row.name, url: row.url, severity: row.normalizedSeverity });
  const both = later.filter((row) => before.has(row.fingerprint));
  const changed = both
    .map((row) => ({ row, fields: changedFields(before.get(row.fingerprint)!, row) }))
    .filter((item) => item.fields.length);
  const changedIds = new Set(changed.map((item) => item.row.id));
  return {
    new: later.filter((row) => !before.has(row.fingerprint)).map(brief),
    persistent: both.filter((row) => !changedIds.has(row.id)).map(brief),
    changed: changed.map(({ row, fields }) => ({
      ...brief(row),
      previousSeverity: before.get(row.fingerprint)!.normalizedSeverity,
      fields,
    })),
    notSeenAgain: earlier.filter((row) => !after.has(row.fingerprint)).map(brief),
    // Stored evidence has totals, not the pages and rules tried per location, so it cannot show
    // that a missing finding was looked for again in the same place.
    resolved: [] as ReturnType<typeof brief>[],
    resolvedSupported: false,
  };
}
export function registerComparison(app: FastifyInstance, db: PrismaClient) {
  app.get("/api/v1/assessments/:id/comparison", async (req, reply) => {
    const { id } = z.strictObject({ id: z.uuid() }).parse(req.params);
    const { earlier } = z.strictObject({ earlier: z.uuid() }).parse(req.query);
    if (id === earlier) throw new ApiError(400, "COMPARISON_NEEDS_TWO");
    const load = (which: string) =>
      db.assessment.findUnique({
        where: { id: which },
        select: {
          id: true,
          targetId: true,
          status: true,
          finishedAt: true,
          findings: {
            select: {
              id: true, fingerprint: true, name: true, url: true, normalizedSeverity: true,
              sourceSeverity: true, confidence: true, description: true, remediation: true,
            },
            take: 2001,
          },
          runs: { where: { kind: "active" }, select: { evidence: { select: { outcome: true, facts: true } } } },
        },
      });
    const [a, b] = [await load(earlier), await load(id)];
    if (!a || !b) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
    if (a.targetId !== b.targetId) throw new ApiError(409, "COMPARISON_DIFFERENT_WEBSITE");
    if (a.status !== "COMPLETED" || b.status !== "COMPLETED")
      throw new ApiError(409, "ASSESSMENT_NOT_COMPLETED");
    if (!a.finishedAt || !b.finishedAt || a.finishedAt >= b.finishedAt)
      throw new ApiError(409, "COMPARISON_ORDER");
    if (a.findings.length > 2000 || b.findings.length > 2000) throw new ApiError(422, "TOO_MANY_FINDINGS");
    const facts = (row: typeof a) => {
      const evidence = row.runs[0]?.evidence;
      return evidence?.outcome === "SUCCEEDED" ? (evidence.facts as unknown as Facts) : null;
    };
    const reasons = comparable(facts(a), facts(b));
    return reply.header("Cache-Control", "no-store").send({
      earlier: { id: a.id, finishedAt: a.finishedAt, findings: a.findings.length },
      later: { id: b.id, finishedAt: b.finishedAt, findings: b.findings.length },
      comparable: !reasons.length,
      reasons,
      result: reasons.length ? null : compare(a.findings, b.findings),
    });
  });
}
