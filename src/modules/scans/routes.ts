import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../../lib/errors.ts";
import type { Resolve } from "../../lib/security/destination.ts";
import type { confirmations } from "../assessments/consent.ts";
import { assessmentSchema, createAssessment } from "../assessments/routes.ts";
import { approvedTarget, configuration, type Job, type Orchestrator } from "./orchestrator.ts";

const launchSchema = assessmentSchema.extend({
  configuration: z.literal(configuration.id),
  requestKey: z.uuid(),
});
const params = z.strictObject({ id: z.uuid() });

function present(job: Job) {
  const scan = (kind: "spider" | "active") => {
    const value = job.scans[kind];
    return value ? { progress: value.progress, requests: value.requests, alerts: value.alerts } : null;
  };
  return {
    tracked: true,
    stage: job.stage,
    stageAt: job.stageAt,
    spider: scan("spider"),
    active: scan("active"),
    memoryPercent: job.memoryPercent,
    peakMemoryPercent: job.peakMemoryPercent,
    cancelRequested: job.cancelRequested,
    code: job.code,
    reasons: job.reasons,
  };
}
export function registerScans(
  app: FastifyInstance,
  db: PrismaClient,
  consent: ReturnType<typeof confirmations>,
  scans: Orchestrator,
  resolve?: Resolve,
) {
  app.get("/api/v1/scans/policy", async () => ({
    approvedTargets: [approvedTarget],
    configuration: {
      id: configuration.id,
      name: configuration.name,
      details: [
        "Finds pages first, then tests them with " + configuration.rules + " active rules.",
        "One website at a time, two requests in parallel, 20 ms apart.",
        "ZAP is limited to 3 GiB of memory. The scan stops above 90%.",
        "DOM-based XSS (rule 40026) is not tested.",
      ],
    },
  }));
  app.get("/api/v1/scans/readiness", async (_req, reply) =>
    reply.header("Cache-Control", "no-store").send(await scans.readiness()),
  );
  app.post("/api/v1/scans", async (req, reply) => {
    const { requestKey, targetId, url, authorized, authorizationTextVersion, confirmationToken } =
      launchSchema.parse(req.body);
    const input = { targetId, url, authorized, authorizationTextVersion, confirmationToken };
    // Exactly the approved address. Other registered websites have no approved scan.
    if (input.url !== approvedTarget) throw new ApiError(403, "SCAN_TARGET_NOT_APPROVED");
    const result = await scans.launch(requestKey, () => createAssessment(db, consent, input, resolve));
    return reply.code(result.repeated ? 200 : 202).send({ assessmentId: result.assessmentId });
  });
  app.get("/api/v1/assessments/:id/scan", async (req, reply) => {
    const { id } = params.parse(req.params);
    const row = await db.assessment.findUnique({ where: { id }, select: { status: true } });
    if (!row) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
    const job = scans.job(id);
    return reply.header("Cache-Control", "no-store").send({
      assessmentId: id,
      status: row.status,
      ...(job
        ? present(job)
        : {
            // The API has no live view of this assessment, for example after a restart.
            tracked: false,
            stage: null,
            stageAt: null,
            spider: null,
            active: null,
            memoryPercent: null,
            peakMemoryPercent: null,
            cancelRequested: false,
            code: null,
            reasons: [],
          }),
    });
  });
  app.post("/api/v1/assessments/:id/scan/cancel", async (req, reply) => {
    const { id } = params.parse(req.params);
    z.strictObject({ confirmed: z.literal(true) }).parse(req.body);
    const row = await db.assessment.findUnique({ where: { id }, select: { status: true } });
    if (!row) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
    return reply.code(202).send({ assessmentId: id, status: row.status, ...present(scans.cancel(id)) });
  });
}
