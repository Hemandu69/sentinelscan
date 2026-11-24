import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../../lib/errors.ts";
import { inspectPdf, type Render } from "./render.ts";
import type { ReportStorage } from "./storage.ts";

// Raised whenever the report's content or layout changes, so older files show as outdated.
export const templateVersion = "4";
export const filename = (assessmentId: string) => `sentinelscan-report-${assessmentId}.pdf`;
const params = z.strictObject({ id: z.uuid() });
const query = z.strictObject({ view: z.enum(["download", "preview"]).default("download") });

export function registerReports(
  app: FastifyInstance,
  db: PrismaClient,
  storage: ReportStorage,
  render: Render,
) {
  const base = "/api/v1/assessments/:id/reports";
  async function assessment(id: string) {
    const row = await db.assessment.findUnique({
      where: { id },
      select: { status: true, _count: { select: { findings: true } } },
    });
    if (!row) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
    return row;
  }
  const completed = async (id: string) => {
    const row = await assessment(id);
    if (row.status !== "COMPLETED") throw new ApiError(409, "ASSESSMENT_NOT_COMPLETED");
    return row;
  };
  const list = (assessmentId: string) =>
    db.report.findMany({
      where: { assessmentId, format: "application/pdf" },
      orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
      take: 20,
    });
  async function lastAnalysis(assessmentId: string) {
    const [storageRow] = await db.$queryRaw<
      { ready: boolean }[]
    >`SELECT to_regclass('finding_analyses') IS NOT NULL AS ready`;
    if (!storageRow?.ready) return null;
    const [row] = await db.$queryRaw<
      { at: Date | null }[]
    >`SELECT max(a.analysed_at) AS at FROM finding_analyses a JOIN findings f ON f.id=a.finding_id WHERE f.assessment_id=${assessmentId}::uuid`;
    return row?.at ?? null;
  }
  async function describe(id: string) {
    const { status } = await assessment(id);
    if (status !== "COMPLETED")
      return { assessmentId: id, assessmentStatus: status, canGenerate: false, reports: [] };
    const analysed = await lastAnalysis(id);
    const reports = [];
    for (const row of await list(id)) {
      const file = await storage.read(row.storageKey, row.contentDigest).catch(() => null);
      reports.push({
        id: row.id,
        generatedAt: row.generatedAt,
        filename: filename(id),
        contentType: row.format,
        sha256: row.contentDigest,
        available: file !== null,
        size: file?.size ?? null,
        pages: file?.pages ?? null,
        outdated:
          row.templateVersion !== templateVersion ||
          (analysed !== null && analysed > row.generatedAt),
      });
    }
    return { assessmentId: id, assessmentStatus: status, canGenerate: true, reports };
  }
  app.get(base, async (req, reply) =>
    reply.header("Cache-Control", "no-store").send(await describe(params.parse(req.params).id)),
  );

  const running = new Set<string>();
  app.post(base, async (req, reply) => {
    const { id } = params.parse(req.params);
    z.strictObject({}).parse(req.body);
    const row = await completed(id);
    if (running.has(id) || running.size >= 1) throw new ApiError(429, "REPORT_BUSY");
    running.add(id);
    try {
      const pdf = await render({ assessmentId: id, findingCount: row._count.findings });
      if (!inspectPdf(pdf)) throw new ApiError(502, "REPORT_RENDER_FAILED");
      // Earlier reports stay valid until, and after, the new one is recorded.
      const file = await storage.write(pdf);
      try {
        await db.$transaction(async (tx) => {
          const [current] = await tx.$queryRaw<
            { status: string; findings: number }[]
          >`SELECT status,(SELECT count(*)::int FROM findings WHERE assessment_id=${id}::uuid) AS findings FROM assessments WHERE id=${id}::uuid FOR SHARE`;
          if (current?.status !== "COMPLETED" || current.findings !== row._count.findings)
            throw new ApiError(409, "REPORT_CONTENT_MISMATCH");
          await tx.report.create({
            data: {
              id: file.id,
              assessmentId: id,
              format: "application/pdf",
              templateVersion,
              contentDigest: file.digest,
              storageKey: file.key,
            },
          });
        });
      } catch (error) {
        await storage.discard(file.key);
        throw error;
      }
      return reply.code(201).send(await describe(id));
    } finally {
      running.delete(id);
    }
  });

  async function send(
    reply: FastifyReply,
    id: string,
    row: { id: string; storageKey: string; contentDigest: string } | null,
    view: "download" | "preview",
  ) {
    if (!row) throw new ApiError(404, "REPORT_NOT_FOUND");
    const { pdf } = await storage.read(row.storageKey, row.contentDigest);
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Length", pdf.length)
      .header(
        "Content-Disposition",
        `${view === "preview" ? "inline" : "attachment"}; filename="${filename(id)}"`,
      )
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Report-Id", row.id)
      .header("X-Report-Sha256", row.contentDigest)
      .header("Access-Control-Expose-Headers", "Content-Disposition, X-Report-Id, X-Report-Sha256")
      .send(pdf);
  }
  app.get(base + "/latest/pdf", async (req, reply) => {
    const { id } = params.parse(req.params);
    const { view } = query.parse(req.query);
    await completed(id);
    return send(reply, id, (await list(id))[0] ?? null, view);
  });
  app.get(base + "/:reportId/pdf", async (req, reply) => {
    const { id, reportId } = z.strictObject({ id: z.uuid(), reportId: z.uuid() }).parse(req.params);
    const { view } = query.parse(req.query);
    await completed(id);
    // Both identifiers must match, so a report is reachable only through its own assessment.
    const row = await db.report.findFirst({
      where: { id: reportId, assessmentId: id, format: "application/pdf" },
    });
    return send(reply, id, row, view);
  });
}
