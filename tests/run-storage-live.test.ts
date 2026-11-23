import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import { test, expect, vi } from "vitest";
import type { ZapClient } from "../src/integrations/zap/client.ts";
import { registerRunRecords } from "../src/modules/assessments/run-records.ts";
import { version } from "../src/modules/assessments/consent.ts";
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

// Executes the receipt, sync and cancellation SQL against real PostgreSQL inside one
// transaction that always rolls back. Provider responses remain fixtures.
test.runIf(process.env.npm_lifecycle_event === "test:run-storage")(
  "receipt routes run against PostgreSQL with fixture provider data and roll back",
  async () => {
    validateLocalDatabaseUrl(process.env.DATABASE_URL);
    vi.stubEnv("SENTINELSCAN_DEMO_TARGET", "juice-shop");
    const db = new PrismaClient(),
      rollback = new Error("fixture rollback"),
      id = randomUUID(),
      sessionKey = id.replaceAll("-", "").repeat(2),
      url = "http://juice-shop:3000/";
    try {
      await expect(
        db.$transaction(
          async (tx) => {
            const target =
              (await tx.target.findFirst({
                where: { canonicalUrl: url, archivedAt: null },
              })) ??
              (await tx.target.create({
                data: { displayName: "Transient fixture", canonicalUrl: url },
              }));
            await tx.assessment.create({
              data: {
                id,
                targetId: target.id,
                targetUrlSnapshot: url,
                authorizationConfirmedAt: new Date(),
                authorizationTextVersion: version,
                source: "FIXTURE",
                status: "PENDING",
              },
            });
            const row = {
              id: "0",
              state: "RUNNING",
              progress: 20,
              reportedOrigin: null,
              exactDemoUrl: false,
              outcome: "RUNNING",
            };
            const app = Fastify();
            registerRunRecords(
              app,
              {
                $transaction: (work: (inner: typeof tx) => unknown) => work(tx),
              } as unknown as PrismaClient,
              { inspectRuns: async () => [row] } as unknown as ZapClient,
              async () => sessionKey,
            );
            const post = (name: string, payload: object = {}) =>
              app.inject({
                method: "POST",
                url: `/api/v1/assessments/${id}/${name}`,
                payload,
              });
            try {
              for (const kind of ["spider", "active", "spider"])
                expect(
                  (
                    await post("zap-association", {
                      kind,
                      scanId: "0",
                      sessionKey,
                      target: url,
                      confirmedOperatorReceipt: true,
                    })
                  ).statusCode,
                ).toBe(200);
              row.progress = 40;
              expect((await post("zap-sync")).json()).toMatchObject({
                status: "ACTIVE_SCAN_RUNNING",
                runs: [{ progress: 40 }, { progress: 40 }],
              });
              const stored = await tx.assessment.findUniqueOrThrow({
                where: { id },
              });
              expect(stored.startedAt).toBeInstanceOf(Date);
              expect((await post("zap-import")).statusCode).toBe(409);
              expect(
                (await post("cancel-tracking", { confirmed: true })).json(),
              ).toMatchObject({ status: "CANCELLED" });
              const execution = await app.inject(
                `/api/v1/assessments/${id}/execution`,
              );
              expect(execution.json()).toMatchObject({ status: "CANCELLED" });
            } finally {
              await app.close();
            }
            throw rollback;
          },
          { timeout: 30000 },
        ),
      ).rejects.toBe(rollback);
      expect(await db.assessment.findUnique({ where: { id } })).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      await db.$disconnect();
    }
  },
  40000,
);
