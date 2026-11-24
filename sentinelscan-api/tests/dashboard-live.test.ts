import { expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { validateLocalDatabaseUrl } from "../src/config/local.ts";
import { buildApp } from "../src/app.ts";

// Report only recognized error identifiers. Prisma messages can contain connection details.
function diagnostic(error: unknown) {
  if (!(error instanceof Error)) return "unclassified error";
  const type = /^PrismaClient[A-Za-z]+Error$/.test(error.name)
    ? error.name
    : "application error";
  const code =
    "code" in error
      ? error.code
      : "errorCode" in error
        ? error.errorCode
        : null;
  return typeof code === "string" && /^P\d{4}$/.test(code)
    ? `${type} ${code}`
    : type;
}

test.runIf(process.env.npm_lifecycle_event === "test:dashboard:live")(
  "dashboard agrees with independent PostgreSQL counts in a quiet workspace",
  async () => {
    validateLocalDatabaseUrl(process.env.DATABASE_URL);
    const db = new PrismaClient();
    const app = buildApp(db);
    let routeError = "no exception captured";
    app.addHook("onError", async (_req, _reply, error) => {
      routeError = diagnostic(error);
    });
    try {
      try {
        await db.$connect();
      } catch (error) {
        throw new Error(
          `PostgreSQL connection failed before the dashboard query: ${diagnostic(error)}`,
        );
      }
      const [tables] = await db.$queryRaw<
        { assessments: boolean; findings: boolean }[]
      >`SELECT to_regclass('assessments') IS NOT NULL AS assessments,
                to_regclass('findings') IS NOT NULL AS findings`;
      expect(
        tables,
        "Dashboard tables visible to the configured database connection",
      ).toEqual({
        assessments: true,
        findings: true,
      });
      const response = await app.inject({
        url: "/api/v1/dashboard",
        headers: { host: "127.0.0.1:4000" },
      });
      expect(
        response.statusCode,
        `Dashboard request after database preflight: ${routeError}`,
      ).toBe(200);
      const [checks] = await db.$queryRaw<
        { totalChecks: number; completedChecks: number }[]
      >`SELECT count(*)::int AS "totalChecks", count(*) FILTER (WHERE status='COMPLETED')::int AS "completedChecks" FROM assessments`;
      const rows = await db.$queryRaw<
        { severity: string; count: number }[]
      >`SELECT f.normalized_severity AS severity, count(*)::int AS count FROM findings f JOIN assessments a ON a.id=f.assessment_id WHERE a.status='COMPLETED' GROUP BY f.normalized_severity`;
      const severityCounts: Record<string, number> = {
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        INFO: 0,
        OTHER: 0,
      };
      for (const row of rows)
        severityCounts[
          Object.hasOwn(severityCounts, row.severity) ? row.severity : "OTHER"
        ] += row.count;
      expect(response.json()).toEqual({
        ...checks,
        severityCounts,
        findingCount: rows.reduce((sum, row) => sum + row.count, 0),
      });
    } finally {
      await app.close();
      await db.$disconnect();
    }
  },
);
