import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { expect, test, vi } from "vitest";
import { registerDashboard } from "../src/modules/dashboard/routes.ts";

test("dashboard counts completed findings and retains unfamiliar severity values", async () => {
  const count = vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(2);
  const groupBy = vi.fn().mockResolvedValue([
    { normalizedSeverity: "LOW", _count: { _all: 2 } },
    { normalizedSeverity: "unclassified", _count: { _all: 1 } },
  ]);
  const db = {
    assessment: { count },
    finding: { groupBy },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  };
  const app = Fastify();
  registerDashboard(app, db as unknown as PrismaClient);
  try {
    const response = await app.inject("/api/v1/dashboard");
    expect(response.statusCode).toBe(200);
    expect(count).toHaveBeenCalledWith({ where: { status: "COMPLETED" } });
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assessment: { status: "COMPLETED" } },
      }),
    );
    expect(response.json()).toEqual({
      totalChecks: 4,
      completedChecks: 2,
      findingCount: 3,
      severityCounts: {
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 2,
        INFO: 0,
        OTHER: 1,
      },
    });
    groupBy.mockRejectedValueOnce(new Error("fixture outage"));
    const outage = await app.inject("/api/v1/dashboard");
    expect(outage.statusCode).toBe(500);
    expect(outage.json()).not.toHaveProperty("findingCount");
  } finally {
    await app.close();
  }
});
