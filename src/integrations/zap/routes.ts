import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZapClient } from "./client.ts";
export function registerZap(app: FastifyInstance, zap: ZapClient) {
  const base = "/api/v1/integrations/zap";
  const status = async () => ({
    available: true,
    version: await zap.version(),
  });
  app.get("/health/zap", status);
  app.get(base + "/status", status);
  app.get(base + "/version", async () => ({ version: await zap.version() }));
  app.get(base + "/scans", async (req) => {
    const { kind } = z
      .strictObject({ kind: z.enum(["spider", "active"]) })
      .parse(req.query);
    const [version, rows] = await Promise.all([
      zap.version(),
      zap.inspectRuns(kind),
    ]);
    return {
      provider: { endpoint: "http://127.0.0.1:8090", version },
      runs: rows.map(({ id, state, progress, reportedOrigin }) => ({
        kind,
        id,
        state,
        progress,
        reportedOrigin,
      })),
    };
  });
  app.get(base + "/alerts", async (req) => {
    const { start, count } = z
      .strictObject({
        start: z.coerce.number().int().nonnegative().default(0),
        count: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    return { start, count, findings: await zap.alerts(start, count) };
  });
  app.get(base + "/progress/:kind/:scanId", async (req) => {
    const { kind, scanId } = z
      .object({
        kind: z.enum(["spider", "active"]),
        scanId: z.string().regex(/^\d{1,12}$/),
      })
      .parse(req.params);
    return { kind, scanId, progress: await zap.progress(kind, scanId) };
  });
}
