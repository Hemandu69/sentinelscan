import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Facts } from "../../integrations/zap/evidence.ts";
import type { AiConfiguration } from "../../integrations/ai/provider.ts";
import { sanitize } from "../../integrations/ai/sanitize.ts";
import { analysisSchema, promptVersion, type AnalysisInput } from "../../integrations/ai/schema.ts";
import { InvalidAnalysis, validateAnalysis } from "../../integrations/ai/validate.ts";
import { ApiError } from "../../lib/errors.ts";
import { groupFindings, severityOrder, type FindingRow } from "./grouping.ts";
import { guideFor } from "./guides.ts";

const maximum = 2000;
const select = {
  id: true,
  assessmentId: true,
  sourceRuleId: true,
  name: true,
  sourceSeverity: true,
  normalizedSeverity: true,
  confidence: true,
  url: true,
  method: true,
  parameter: true,
  redactedEvidence: true,
  description: true,
  remediation: true,
  references: true,
  cweId: true,
  wascId: true,
  firstObservedAt: true,
  assessment: { select: { targetId: true, target: { select: { displayName: true } } } },
} as const;
type Row = FindingRow & {
  assessment: { targetId: string; target: { displayName: string } };
};
type Stored = {
  finding_id: string;
  status: string;
  input_digest: string;
  prompt_version: string;
  provider: string;
  model: string;
  result: unknown;
  error_code: string | null;
  analysed_at: Date;
};
const bare = (value: string) => {
  const url = new URL(value);
  return url.origin + url.pathname;
};
export function inputFor(findings: readonly FindingRow[]): AnalysisInput {
  const [first] = findings;
  return sanitize({
    alertName: first.name,
    description: first.description,
    scannerSeverity: first.sourceSeverity,
    scannerConfidence: first.confidence,
    ruleId: first.sourceRuleId,
    method: first.method,
    parameter: first.parameter,
    affectedUrls: findings.map((row) => row.url),
    evidence: first.redactedEvidence,
    scannerRemediation: first.remediation,
    references: first.references,
    cweId: first.cweId,
    wascId: first.wascId,
  });
}
export const inputDigest = (input: AnalysisInput) =>
  createHash("sha256").update(promptVersion + "\n" + JSON.stringify(input)).digest("hex");

export function registerIssues(app: FastifyInstance, db: PrismaClient, ai: AiConfiguration) {
  const storageReady = async () => {
    const [row] = await db.$queryRaw<
      { ready: boolean }[]
    >`SELECT to_regclass('finding_analyses') IS NOT NULL AS ready`;
    return row?.ready === true;
  };
  const stored = async (ids: string[]) =>
    ids.length && (await storageReady())
      ? db.$queryRaw<
          Stored[]
        >`SELECT finding_id::text,status,input_digest,prompt_version,provider,model,result,error_code,analysed_at FROM finding_analyses WHERE finding_id = ANY(${ids}::uuid[])`
      : [];
  function present(group: { key: string; findings: Row[] }, analyses: Stored[]) {
    const [first] = group.findings;
    const digest = inputDigest(inputFor(group.findings));
    const rows = group.findings.map((row) => analyses.find((a) => a.finding_id === row.id) ?? null);
    // Only results for exactly this input are shown. A validated shape is required again on read.
    const current = rows.map((row) => {
      if (row?.status !== "COMPLETED" || row.input_digest !== digest) return null;
      const parsed = analysisSchema.safeParse(row.result);
      return parsed.success ? { row, result: parsed.data } : null;
    });
    const done = current.filter((item) => item !== null);
    const failed = rows.find((row) => row?.status === "FAILED" && row.input_digest === digest);
    // Finished earlier, for input that has changed since. Its text is not shown.
    const stale = rows.some((row) => row?.status === "COMPLETED" && row.input_digest !== digest);
    return {
      key: group.key,
      assessmentId: first.assessmentId,
      targetId: first.assessment.targetId,
      website: first.assessment.target.displayName,
      scanner: {
        title: first.name,
        ruleId: first.sourceRuleId,
        severity: first.normalizedSeverity,
        sourceSeverity: first.sourceSeverity,
        confidence: first.confidence,
        method: first.method,
        parameter: first.parameter,
        evidence: first.redactedEvidence,
        description: first.description,
        remediation: first.remediation,
        references: first.references,
        cweId: first.cweId,
        wascId: first.wascId,
      },
      guide: guideFor(first.sourceRuleId),
      findings: group.findings.map((row) => ({
        id: row.id,
        url: bare(row.url),
        firstObservedAt: row.firstObservedAt,
      })),
      endpoints: [...new Set(group.findings.map((row) => bare(row.url)))],
      analysis: {
        status: done.length === rows.length ? "COMPLETED" : done.length ? "PARTIAL" : stale ? "STALE" : failed ? "FAILED" : "NONE",
        errorCode: done.length ? null : (failed?.error_code ?? null),
        provider: done[0]?.row.provider ?? null,
        model: done[0]?.row.model ?? null,
        analysedAt: done[0]?.row.analysed_at ?? null,
        result: done[0]?.result ?? null,
      },
    };
  }
  const load = (where: object) =>
    db.finding.findMany({
      where: { ...where, assessment: { status: "COMPLETED" } },
      orderBy: [{ id: "asc" }],
      take: maximum + 1,
      select,
    }) as Promise<Row[]>;

  app.get("/api/v1/analysis/status", async (_req, reply) =>
    reply.header("Cache-Control", "no-store").send({
      enabled: ai.enabled,
      reason: ai.enabled ? null : ai.reason,
      provider: ai.enabled ? ai.provider.name : null,
      model: ai.enabled ? ai.provider.model : null,
      storageReady: await storageReady(),
    }),
  );
  app.get("/api/v1/issues", async (req, reply) => {
    const { assessmentId } = z
      .strictObject({ assessmentId: z.uuid().optional() })
      .parse(req.query);
    const rows = await load({ assessmentId });
    if (rows.length > maximum) throw new ApiError(422, "TOO_MANY_FINDINGS");
    const analyses = await stored(rows.map((row) => row.id));
    const issues = groupFindings(rows).map((group) => present(group, analyses));
    // Alert totals exist only where verified run evidence recorded them.
    const evidence = await db.runEvidence.findMany({
      where: {
        kind: "active",
        outcome: "SUCCEEDED",
        run: { assessment: { status: "COMPLETED", ...(assessmentId ? { id: assessmentId } : {}) } },
      },
      select: { assessmentId: true, facts: true },
    });
    const covered = new Set(evidence.map((row) => row.assessmentId));
    const severities = Object.fromEntries(
      [...severityOrder, "OTHER"].map((severity) => [
        severity,
        issues.filter((issue) =>
          severity === "OTHER"
            ? !severityOrder.includes(issue.scanner.severity)
            : issue.scanner.severity === severity,
        ).length,
      ]),
    );
    return reply.header("Cache-Control", "no-store").send({
      counts: {
        originalAlerts: rows.every((row) => covered.has(row.assessmentId))
          ? evidence.reduce((sum, row) => sum + (row.facts as unknown as Facts).attributedAlerts, 0)
          : null,
        findings: rows.length,
        issues: issues.length,
        endpoints: new Set(issues.flatMap((issue) => issue.endpoints)).size,
      },
      severities,
      coverage: {
        analysed: issues.filter((issue) => issue.analysis.status === "COMPLETED").length,
        unanalysed: issues.filter((issue) => issue.analysis.status !== "COMPLETED").length,
      },
      issues,
    });
  });

  const running = new Set<string>();
  app.post("/api/v1/assessments/:id/issues/:key/analysis", async (req) => {
    const { id, key } = z
      .strictObject({ id: z.uuid(), key: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.params);
    z.strictObject({}).parse(req.body);
    const rows = await load({ assessmentId: id });
    if (rows.length > maximum) throw new ApiError(422, "TOO_MANY_FINDINGS");
    const group = groupFindings(rows).find((item) => item.key === key);
    if (!group) throw new ApiError(404, "ISSUE_NOT_FOUND");
    const ids = group.findings.map((row) => row.id);
    const before = present(group, await stored(ids));
    // A finished analysis of the same input is returned without another provider call.
    if (before.analysis.status === "COMPLETED") return before;
    if (!ai.enabled) throw new ApiError(503, ai.reason);
    if (!(await storageReady())) throw new ApiError(503, "ANALYSIS_STORAGE_UNAVAILABLE");
    if (running.has(key) || running.size >= 2) throw new ApiError(429, "ANALYSIS_BUSY");
    running.add(key);
    try {
      const input = inputFor(group.findings);
      const digest = inputDigest(input);
      const { provider } = ai;
      // Results are separate from findings, which are never updated here.
      const save = (status: string, model: string, result: unknown, error: string | null) =>
        db.$transaction(
          ids.map(
            (findingId) =>
              db.$executeRaw`INSERT INTO finding_analyses(finding_id,status,input_digest,prompt_version,provider,model,result,error_code,analysed_at) VALUES (${findingId}::uuid,${status},${digest},${promptVersion},${provider.name},${model},${result === null ? null : JSON.stringify(result)}::jsonb,${error},CURRENT_TIMESTAMP) ON CONFLICT (finding_id) DO UPDATE SET status=EXCLUDED.status,input_digest=EXCLUDED.input_digest,prompt_version=EXCLUDED.prompt_version,provider=EXCLUDED.provider,model=EXCLUDED.model,result=EXCLUDED.result,error_code=EXCLUDED.error_code,analysed_at=EXCLUDED.analysed_at`,
          ),
        );
      let failure = "AI_INVALID_RESPONSE";
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { text, model } = await provider.complete(input);
          const result = validateAnalysis(text, input, group.findings[0].normalizedSeverity);
          await save("COMPLETED", model.slice(0, 64), result, null);
          return present(group, await stored(ids));
        } catch (error) {
          // Only an unusable answer is worth one more try. The SDK handles transport retries.
          if (error instanceof InvalidAnalysis) {
            failure = "AI_INVALID_RESPONSE";
            continue;
          }
          if (!(error instanceof ApiError)) throw error;
          failure = error.message;
          break;
        }
      }
      await save("FAILED", provider.model, null, failure);
      throw new ApiError(
        failure === "AI_RATE_LIMITED" ? 429 : failure === "AI_TIMEOUT" ? 504 : failure === "AI_UNAVAILABLE" ? 503 : 502,
        failure,
      );
    } finally {
      running.delete(key);
    }
  });
}
