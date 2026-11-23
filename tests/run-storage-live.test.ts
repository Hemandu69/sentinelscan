import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test, expect } from "vitest";
import { validateLocalDatabaseUrl } from "../src/config/local.ts";

test.runIf(process.env.npm_lifecycle_event === "test:run-storage")(
  "PostgreSQL stores typed run receipts; duplicate kind/session/id conflicts and fixture changes roll back",
  async () => {
    validateLocalDatabaseUrl(process.env.DATABASE_URL);
    const db = new PrismaClient(),
      rollback = new Error("fixture rollback"),
      id = randomUUID(),
      sessionKey = id.replaceAll("-", "").repeat(2);
    try {
      await expect(
        db.$transaction(async (tx) => {
          const url = "https://receipt-fixture.invalid/" + id;
          const target = await tx.target.create({
            data: {
              displayName: "Transient storage fixture",
              canonicalUrl: url,
            },
          });
          for (const a of [id, randomUUID()]) {
            await tx.assessment.create({
              data: {
                id: a,
                targetId: target.id,
                targetUrlSnapshot: url,
                authorizationConfirmedAt: new Date(),
                authorizationTextVersion: "fixture",
                source: "FIXTURE",
                status: "PENDING",
              },
            });
            for (const kind of ["spider", "active"]) {
              const inserted =
                await tx.$executeRaw`INSERT INTO assessment_runs(assessment_id,kind,scan_id,session_key,observed_at) VALUES (${a}::uuid,${kind},'0',${sessionKey},CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
              expect(inserted).toBe(a === id ? 1 : 0);
            }
          }
          const [row] = await tx.$queryRaw<
            { n: number }[]
          >`SELECT count(*)::int AS n FROM assessment_runs WHERE assessment_id=${id}::uuid`;
          expect(row.n).toBe(2);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(await db.assessment.findUnique({ where: { id } })).toBeNull();
    } finally {
      await db.$disconnect();
    }
  },
);
