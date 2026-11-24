import { configuredZapClient } from "./integrations/zap/client.ts";
import { registerZap } from "./integrations/zap/routes.ts";
import { configuredAi } from "./integrations/ai/provider.ts";
import { registerIssues } from "./modules/issues/routes.ts";
import { browserRenderer } from "./modules/reports/render.ts";
import { registerReports } from "./modules/reports/routes.ts";
import {
  defaultReportDirectory,
  reportStorage,
} from "./modules/reports/storage.ts";
import { providerSession } from "./integrations/zap/session.ts";
import { readContainerLog } from "./integrations/zap/run-log.ts";
import { createRunRecords } from "./modules/assessments/run-records.ts";
import { registerComparison } from "./modules/assessments/comparison.ts";
import { createOrchestrator } from "./modules/scans/orchestrator.ts";
import { dockerResources } from "./modules/scans/resources.ts";
import { registerScans } from "./modules/scans/routes.ts";
import { registerDashboard } from "./modules/dashboard/routes.ts";
import Fastify from "fastify";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { settingsSchema, type Settings } from "./config/local.ts";
import { ApiError } from "./lib/errors.ts";
import { type Resolve } from "./lib/security/destination.ts";
import { confirmations } from "./modules/assessments/consent.ts";
import { registerTargets } from "./modules/targets/routes.ts";
import { registerObservation } from "./modules/assessments/observation.ts";
import { registerAssessments } from "./modules/assessments/routes.ts";
import { registerRunRecords } from "./modules/assessments/run-records.ts";
import { registerRecords } from "./modules/assessments/records.ts";
import { registerHealth } from "./modules/health/routes.ts";
export function buildApp(
  db: PrismaClient,
  settings: Settings = settingsSchema.parse({}),
  resolve?: Resolve,
  zap = configuredZapClient(),
  ai = configuredAi(),
) {
  const app = Fastify({ bodyLimit: 16384, logger: false });
  const consent = confirmations();
  app.addHook("onRequest", async (req, reply) => {
    if (req.headers.host !== settings.API_HOST_HEADER)
      throw new ApiError(403, "INVALID_HOST");
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (origin !== settings.WEB_ORIGIN)
        throw new ApiError(403, "INVALID_ORIGIN");
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Vary", "Origin");
    }
  });
  app.options("/*", async (_req, reply) =>
    reply
      .header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
      .header("Access-Control-Allow-Headers", "Content-Type")
      .code(204)
      .send(),
  );
  app.setErrorHandler((err, req, reply) => {
    let status = 500,
      code = "INTERNAL_ERROR";
    if (err instanceof ApiError) {
      status = err.status;
      code = err.message;
    } else if (err instanceof z.ZodError) {
      status = 400;
      code = "INVALID_REQUEST";
    } else if (
      (err instanceof Prisma.PrismaClientInitializationError &&
        ["P1001", "P1002", "P1017"].includes(err.errorCode ?? "")) ||
      (err instanceof Prisma.PrismaClientKnownRequestError &&
        ["P1001", "P1002", "P1017", "P2024"].includes(err.code))
    ) {
      status = 503;
      code = "DATABASE_UNAVAILABLE";
    } else if (
      err instanceof Error &&
      "statusCode" in err &&
      typeof err.statusCode === "number" &&
      err.statusCode >= 400 &&
      err.statusCode < 500
    ) {
      status = err.statusCode;
      code = "INVALID_REQUEST";
    }
    const reasons = err instanceof ApiError ? err.reasons : [];
    reply.code(status).send({
      error: code,
      requestId: req.id,
      ...(reasons.length ? { reasons } : {}),
    });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: "NOT_FOUND", requestId: req.id }),
  );
  registerHealth(app, db);
  registerDashboard(app, db);
  registerZap(app, zap);
  registerTargets(app, db, consent, resolve);
  registerAssessments(app, db, consent, resolve);
  registerRecords(app, db);
  registerIssues(app, db, ai);
  registerReports(
    app,
    db,
    reportStorage(defaultReportDirectory()),
    browserRenderer(settings.WEB_ORIGIN),
  );
  const getSession = () => providerSession(zap);
  const runs = createRunRecords(db, zap, getSession, readContainerLog);
  const scans = createOrchestrator({
    db,
    zap,
    records: runs,
    getSession,
    readLog: readContainerLog,
    resources: dockerResources,
  });
  registerRunRecords(app, db, zap, getSession, readContainerLog, runs, scans.isActive);
  registerScans(app, db, consent, scans, resolve);
  registerComparison(app, db);
  registerObservation(app, db, zap);
  return app;
}
