import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

export function registerDashboard(app: FastifyInstance, db: PrismaClient) {
  app.get("/api/v1/dashboard", async (_request, reply) => {
    const completed = { status: "COMPLETED" };
    const findingsBySeverity = db.finding.groupBy({
      by: ["normalizedSeverity"],
      where: { assessment: completed },
      _count: { _all: true },
    });
    const [totalChecks, completedChecks, groups] = await db.$transaction(
      [
        db.assessment.count(),
        db.assessment.count({ where: completed }),
        findingsBySeverity,
      ],
      { isolationLevel: "RepeatableRead" },
    );
    const severityCounts = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
      OTHER: 0,
    };
    let findingCount = 0;
    for (const group of groups) {
      const severity = group.normalizedSeverity;
      const key = Object.hasOwn(severityCounts, severity)
        ? (severity as keyof typeof severityCounts)
        : "OTHER";
      severityCounts[key] += group._count._all;
      findingCount += group._count._all;
    }
    return reply.header("Cache-Control", "no-store").send({
      totalChecks,
      completedChecks,
      findingCount,
      severityCounts,
    });
  });
}
