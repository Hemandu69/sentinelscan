import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../../lib/errors.ts";

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
      "The operator cancelled tracking in SentinelScan.",
  };
  return {
    ...row,
    website: target.displayName,
    outcomeExplanation: Object.hasOwn(explanations, errorCode ?? "")
      ? explanations[errorCode!]
      : null,
    findingCount: row.status === "COMPLETED" ? _count.findings : null,
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
    return {
      ...assessment(row),
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
