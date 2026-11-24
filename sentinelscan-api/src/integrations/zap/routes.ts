import type { FastifyInstance } from "fastify";
import type { ZapClient } from "./client.ts";
export function registerZap(app: FastifyInstance, zap: ZapClient) {
  app.get("/health/zap", async () => ({
    available: true,
    version: await zap.version(),
  }));
}
