import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../../lib/errors.ts";
import type { Facts } from "../../integrations/zap/evidence.ts";

const page = z.strictObject({
  offset: z.coerce.number().int().min(0).max(2147483646).default(0),
});
const limit = 25;
const assessmentSelect = {
  id: true,
  targetId: true,
  targetUrlSnapshot: true,
  status: true,
  requestedAt: true,
  startedAt: true,
  finishedAt: true,
  errorCode: true,
  target: { select: { displayName: true } },
  _count: { select: { findings: true } },
} as const;
type AssessmentRow = import("@prisma/client").Prisma.AssessmentGetPayload<{
  select: typeof assessmentSelect;
}>;
function assessment({ target, _count, errorCode, ...row }: AssessmentRow) {
  const explanations: Record<string, string> = {
    ZAP_RUN_FAILED: "ZAP reported that the linked run failed.",
    ZAP_RUN_CANCELLED:
      "ZAP reported that the linked run was stopped or cancelled.",
    OPERATOR_CANCELLED_TRACKING:
      "The operator cancelled tracking in SentinelScan. This did not stop any ZAP scan.",
  };
  return {
    ...row,
    website: target.displayName,
    outcomeExplanation:
      row.status === "OUTCOME_UNKNOWN"
        ? "The scans ended, but evidence of how they ended has not been verified. No results were imported."
        : Object.hasOwn(explanations, errorCode ?? "")
          ? explanations[errorCode!]
          : null,
    findingCount: row.status === "COMPLETED" ? _count.findings : null,
  };
}
export function summarizeEvidence(
  rows: {
    kind: string;
    facts: unknown;
    factsDigest: string;
    collectedAt: Date;
    run: { scanId: string };
  }[],
) {
  const spider = rows.find((row) => row.kind === "spider"),
    active = rows.find((row) => row.kind === "active");
  if (rows.length !== 2 || !spider || !active) return null;
  const facts = active.facts as Facts;
  return {
    contract: facts.contract,
    collectedAt: active.collectedAt,
    digest: active.factsDigest,
    sessionKey: facts.sessionKey,
    spider: {
      scanId: spider.run.scanId,
      startedAt: facts.log.spider!.startedAt,
      endedAt: facts.log.spider!.endedAt,
      results: facts.scope.spider.count,
    },
    active: {
      scanId: active.run.scanId,
      startedAt: facts.log.active!.startedAt,
      endedAt: facts.log.active!.endedAt,
      completedRules: facts.log.active!.completedRules,
      skippedRules: facts.log.active!.skippedRules,
      stoppedRules: facts.log.active!.stoppedRules,
      alerts: facts.attributedAlerts,
      requests: facts.counts.requests,
      messages: facts.scope.active.count,
    },
    reconciliations: Object.values(facts.reconciliations)
      .filter((item) => item.result === "ACCEPTED")
      .map((item) => ({
        ruleId: item.ruleId,
        ruleName: item.ruleName,
        kind: item.kind,
        expectedRequests: item.expectedRequests,
        observedRequests: item.observedRequests,
        observedMessages: item.observedMessages,
        acceptedDiscrepancy: item.acceptedDiscrepancy,
        targetOrigin: item.targetOrigin,
        hostValues: [...new Set(item.hostHeaders.map((row) => row.host))].sort(),
      })),
  };
}
export function registerRecords(app: FastifyInstance, db: PrismaClient) {
  app.get("/api/v1/assessments", async (req) => {
    const { offset, targetId } = page
      .extend({ targetId: z.uuid().optional() })
      .parse(req.query);
    const rows = await db.assessment.findMany({
      where: { targetId },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: assessmentSelect,
    });
    return {
      items: rows.slice(0, limit).map(assessment),
      hasMore: rows.length > limit,
    };
  });
  app.get("/api/v1/assessments/:id", async (req) => {
    const { id } = z.strictObject({ id: z.uuid() }).parse(req.params);
    const row = await db.assessment.findUnique({
      where: { id },
      select: assessmentSelect,
    });
    if (!row) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
    const severityCounts =
      row.status === "COMPLETED"
        ? await db.finding.groupBy({
            by: ["normalizedSeverity"],
            where: { assessmentId: id },
            _count: { _all: true },
            orderBy: { normalizedSeverity: "asc" },
          })
        : null;
    // Only verified runs of a completed assessment are summarized.
    const evidence =
      row.status === "COMPLETED"
        ? await db.runEvidence.findMany({
            where: { assessmentId: id, outcome: "SUCCEEDED" },
            select: {
              kind: true,
              facts: true,
              factsDigest: true,
              collectedAt: true,
              run: { select: { scanId: true } },
            },
          })
        : [];
    return {
      ...assessment(row),
      evidence: summarizeEvidence(evidence),
      severities:
        severityCounts?.map((group) => ({
          severity: group.normalizedSeverity,
          count: group._count._all,
        })) ?? null,
    };
  });
  app.get("/api/v1/findings", async (req) => {
    const { offset, assessmentId, severity, q, sort } = page
      .extend({
        sort: z.enum(["newest", "oldest", "title"]).default("newest"),
        assessmentId: z.uuid().optional(),
        severity: z
          .enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
          .optional(),
        q: z.string().trim().max(120).optional(),
      })
      .parse(req.query);
    const rows = await db.finding.findMany({
      where: {
        assessmentId,
        assessment: { status: "COMPLETED" },
        normalizedSeverity: severity,
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      },
      orderBy:
        sort === "title"
          ? [{ name: "asc" }, { id: "asc" }]
          : sort === "oldest"
            ? [{ firstObservedAt: "asc" }, { id: "asc" }]
            : [{ firstObservedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        name: true,
        assessmentId: true,
        normalizedSeverity: true,
        confidence: true,
        url: true,
        method: true,
        parameter: true,
        firstObservedAt: true,
        description: true,
        remediation: true,
        cweId: true,
        wascId: true,
        assessment: { select: { target: { select: { displayName: true } } } },
      },
    });
    return {
      items: rows.slice(0, limit).map(({ assessment, ...row }) => {
        const location = new URL(row.url);
        if (!["http:", "https:"].includes(location.protocol))
          throw new ApiError(500, "INVALID_STORED_FINDING_URL");
        return {
          ...row,
          url: location.origin + location.pathname,
          website: assessment.target.displayName,
        };
      }),
      hasMore: rows.length > limit,
    };
  });
}
