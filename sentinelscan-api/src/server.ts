import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { settingsSchema, validateLocalDatabaseUrl } from "./config/local.ts";
import { configuredZapClient } from "./integrations/zap/client.ts";

async function start() {
  let step = "validating DATABASE_URL";
  let db: PrismaClient | undefined;
  let app: FastifyInstance | undefined;
  try {
    validateLocalDatabaseUrl(process.env.DATABASE_URL);
    step = "validating API_HOST_HEADER and WEB_ORIGIN";
    const settings = settingsSchema.parse(process.env);
    step = "loading ZAP configuration (check ZAP_TIMEOUT_MS)";
    const zap = configuredZapClient();
    step = "initializing Prisma Client";
    // The pool connects on first query. /health/database verifies readiness.
    const database = new PrismaClient();
    db = database;
    step = "initializing Fastify";
    const server = buildApp(database, settings, undefined, zap);
    app = server;
    server.addHook("onClose", async () => database.$disconnect());
    step = "binding 127.0.0.1:4000";
    await server.listen({ host: "127.0.0.1", port: 4000 });

    let closing = false;
    async function stop(signal: NodeJS.Signals) {
      if (closing) return;
      closing = true;
      console.info(`SentinelScan API received ${signal}; closing.`);
      try {
        await server.close();
        console.info("SentinelScan API shutdown complete.");
      } catch {
        process.exitCode = 1;
        console.error("SentinelScan API shutdown failed.");
      }
    }
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => void stop(signal));
    console.info(
      `SentinelScan API listening on http://127.0.0.1:4000 (PID ${process.pid})`,
    );
  } catch (error) {
    process.exitCode = 1;
    const inUse =
      error instanceof Error && "code" in error && error.code === "EADDRINUSE";
    console.error(
      inUse
        ? "SentinelScan API startup failed: 127.0.0.1:4000 is already in use (EADDRINUSE). Check the existing listener."
        : `SentinelScan API startup failed while ${step}.`,
    );
    try {
      if (app) await app.close();
      else if (db) await db.$disconnect();
    } catch {
      console.error("SentinelScan API startup cleanup failed.");
    }
  }
}

await start();
