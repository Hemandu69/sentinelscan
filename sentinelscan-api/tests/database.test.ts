import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "vitest";
import { buildApp } from "../src/app.ts";
import { validateLocalDatabaseUrl } from "../src/config/local.ts";
import { normalize } from "../src/integrations/zap/findings.ts";
import { persistFinalFindingsTx } from "../src/modules/assessments/persist-findings.ts";
const persistFinalFindings = (
  db: PrismaClient,
  id: string,
  findings: Parameters<typeof persistFinalFindingsTx>[2],
) => db.$transaction((tx) => persistFinalFindingsTx(tx, id, findings));

test.runIf(
  process.env.TEST_DATABASE === "1" ||
    process.env.npm_lifecycle_event === "test:database",
)("PostgreSQL lifecycle and persisted consent", async () => {
  validateLocalDatabaseUrl(process.env.DATABASE_URL);
  const db = new PrismaClient(),
    app = buildApp(db),
    headers = { host: "127.0.0.1:4000" };
  const url = "https://1.1.1.1/" + randomUUID(),
    payload = { url, displayName: "Stage 2 acceptance" };
  const base = "/api/v1/targets";
  try {
    expect(
      (await app.inject({ method: "GET", url: "/health/database", headers }))
        .statusCode,
    ).toBe(200);
    const create = () =>
      app.inject({ method: "POST", url: base, headers, payload });
    const [one, two] = await Promise.all([create(), create()]);
    expect([one.statusCode, two.statusCode].sort()).toEqual([201, 409]);
    const id = (one.statusCode === 201 ? one : two).json().id;
    expect(
      (await app.inject({ method: "GET", url: base, headers })).json(),
    ).toContainEqual(expect.objectContaining({ id }));
    expect(await db.assessment.count({ where: { targetId: id } })).toBe(0);
    const detail = (
      await app.inject({ method: "GET", url: base + "/" + id, headers })
    ).json();
    const request = {
      targetId: id,
      url,
      authorized: true,
      authorizationTextVersion: detail.confirmation.version,
      confirmationToken: detail.confirmation.token,
    };
    const submit = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/assessments",
        headers,
        payload: request,
      });
    const created = await submit();
    expect(created.statusCode).toBe(201);
    const persisted = await db.assessment.findUniqueOrThrow({
      where: { id: created.json().id },
    });
    expect(persisted.targetUrlSnapshot).toBe(url);
    expect(persisted.authorizationConfirmedAt).toBeInstanceOf(Date);
    expect((await submit()).statusCode).toBe(409);
    expect(
      (await app.inject({ method: "DELETE", url: base + "/" + id, headers }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: base + "/" + id, headers }))
        .statusCode,
    ).toBe(404);
    expect((await create()).statusCode).toBe(201);
  } finally {
    try {
      await db.$transaction([
        db.assessment.deleteMany({
          where: { target: { canonicalUrl: url } },
        }),
        db.target.deleteMany({ where: { canonicalUrl: url } }),
      ]);
    } finally {
      await app.close();
      await db.$disconnect();
    }
  }
});

test.runIf(
  process.env.TEST_DATABASE === "1" ||
    process.env.npm_lifecycle_event === "test:database",
)("fixture result transaction, rollback and repeat import", async () => {
  validateLocalDatabaseUrl(process.env.DATABASE_URL);
  const db = new PrismaClient();
  const reader = new PrismaClient();
  const id = randomUUID();
  const url = "https://fixture.example.invalid/" + id;
  try {
    await db.target.create({
      data: {
        id,
        canonicalUrl: url,
        displayName: "Persistence fixture",
        assessments: {
          create: {
            id,
            targetUrlSnapshot: url,
            source: "FIXTURE",
            status: "PROCESSING_RESULTS",
            authorizationConfirmedAt: new Date(),
            authorizationTextVersion: "fixture",
          },
        },
      },
    });
    const fixture = normalize({
      name: "Fixture only",
      url,
      risk: "Low",
      confidence: "Low",
      description: "Synthetic database test",
    });
    const snapshot = () =>
      reader.$queryRaw`SELECT a.status, a.finished_at, count(f.id)::int AS count, min(f.id::text) AS finding_id FROM assessments a LEFT JOIN findings f ON f.assessment_id=a.id WHERE a.id=${id}::uuid GROUP BY a.id`;
    // Force an insertion failure with a value outside PostgreSQL INTEGER range.
    await expect(
      persistFinalFindings(db, id, [
        fixture,
        { ...fixture, name: "Invalid fixture", cweId: 3_000_000_000 },
      ]),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual([
      {
        status: "PROCESSING_RESULTS",
        finished_at: null,
        count: 0,
        finding_id: null,
      },
    ]);
    const counts = await Promise.all([
      persistFinalFindings(db, id, [fixture, fixture]),
      persistFinalFindings(reader, id, [fixture, fixture]),
    ]);
    expect(counts).toEqual([1, 1]);
    const completed = await snapshot();
    expect(completed).toEqual([
      {
        status: "COMPLETED",
        finished_at: expect.any(Date),
        count: 1,
        finding_id: expect.any(String),
      },
    ]);
    expect(await persistFinalFindings(db, id, [fixture])).toBe(1);
    expect(await snapshot()).toEqual(completed);
    const app = buildApp(reader);
    try {
      const headers = { host: "127.0.0.1:4000" };
      const detail = await app.inject({
        url: "/api/v1/assessments/" + id,
        headers,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        id,
        status: "COMPLETED",
        findingCount: 1,
        targetUrlSnapshot: url,
      });
      const records = await app.inject({
        url: "/api/v1/findings?assessmentId=" + id,
        headers,
      });
      expect(records.statusCode).toBe(200);
      expect(records.json().items).toHaveLength(1);
      expect(records.json().items[0]).toMatchObject({
        assessmentId: id,
        url,
        name: "Fixture only",
        normalizedSeverity: "LOW",
      });
    } finally {
      await app.close();
    }
  } finally {
    try {
      await db.$transaction([
        db.finding.deleteMany({ where: { assessmentId: id } }),
        db.assessment.deleteMany({ where: { id } }),
        db.target.deleteMany({ where: { id } }),
      ]);
    } finally {
      await Promise.all([reader.$disconnect(), db.$disconnect()]);
    }
  }
});
