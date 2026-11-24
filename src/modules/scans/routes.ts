import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../../lib/errors.ts";
import type { Resolve } from "../../lib/security/destination.ts";
import type { confirmations } from "../assessments/consent.ts";
import { assessmentSchema, createAssessment } from "../assessments/routes.ts";
import { safety } from "./exclusions.ts";
import { configuration, type Job, type Orchestrator } from "./orchestrator.ts";

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
  const registered = async (value: unknown) => {
    const { id } = params.parse(value);
    const row = await db.target.findFirst({
      where: { id, archivedAt: null },
      select: { canonicalUrl: true },
    });
    if (!row) throw new ApiError(404, "TARGET_NOT_FOUND");
    return row.canonicalUrl;
  };
  // Being registered or eligible authorizes nothing. Every scan needs its own consent.
  app.get("/api/v1/targets/:id/eligibility", async (req, reply) => {
    const url = await registered(req.params);
    return reply.header("Cache-Control", "no-store").send({ url, ...(await scans.eligibility(url)), safety: safety(url).description });
  });
  app.get("/api/v1/scans/policy", async () => ({
    configuration: {
      id: configuration.id,
      name: configuration.name,
      details: [
        "Finds pages first, then tests them with " + configuration.rules + " active rules.",
        "One website at a time, two requests in parallel, 20 ms apart.",
        "ZAP is limited to 3 GiB of memory. The scan stops above 90%.",
        "A firewall limits ZAP to the confirmed address. Every other destination is refused.",
        "DOM-based XSS (rule 40026) is not tested.",
      ],
    },
  }));
  app.get("/api/v1/targets/:id/readiness", async (req, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .send(await scans.readiness(await registered(req.params))),
  );
  app.post("/api/v1/scans", async (req, reply) => {
    const { requestKey, targetId, url, authorized, authorizationTextVersion, confirmationToken } =
      launchSchema.parse(req.body);
    const input = { targetId, url, authorized, authorizationTextVersion, confirmationToken };
    // The address must be exactly the registered one. Consent is bound to it and used once.
    if ((await registered({ id: targetId })) !== url) throw new ApiError(409, "TARGET_CHANGED");
    const result = await scans.launch(requestKey, url, () => createAssessment(db, consent, input, resolve));
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
