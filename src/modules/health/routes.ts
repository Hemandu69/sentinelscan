import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../../lib/errors.ts";
export function registerHealth(app: FastifyInstance, db: PrismaClient) {
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/database", async () => {
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      throw new ApiError(503, "DATABASE_UNAVAILABLE");
    }
    return { status: "ok" };
  });
}
