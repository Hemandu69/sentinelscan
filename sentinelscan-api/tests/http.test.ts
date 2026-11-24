import { test, expect } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.ts";
test("record reads distinguish unavailable database from unrelated constraints without leaking details", async () => {
  const failures = [
    new Prisma.PrismaClientInitializationError("private fixture", "6", "P1001"),
    new Prisma.PrismaClientKnownRequestError("private fixture", {
      clientVersion: "6",
      code: "P2002",
    }),
  ];
  const db = {
    target: {
      findMany: async () => {
        throw failures.shift();
      },
    },
  };
  const app = buildApp(db as unknown as PrismaClient);
  try {
    for (const [status, code] of [
      [503, "DATABASE_UNAVAILABLE"],
      [500, "INTERNAL_ERROR"],
    ]) {
      const result = await app.inject({
        url: "/api/v1/targets",
        headers: { host: "127.0.0.1:4000" },
      });
      expect(result.statusCode).toBe(status);
      expect(result.json().error).toBe(code);
      expect(result.body).not.toContain("private fixture");
    }
  } finally {
    await app.close();
  }
});
test("local HTTP boundary rejects foreign hosts and browser origins", async () => {
  const db = new PrismaClient(),
    app = buildApp(db);
  const host = "127.0.0.1:4000";
  try {
    expect(
      (await app.inject({ method: "GET", url: "/health", headers: { host } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/health",
          headers: { host: "external.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/targets",
          headers: { host, origin: "null" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/targets",
          headers: { host },
          payload: { displayName: "x", url: "http://127.0.0.1/" },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/assessments",
          headers: { host },
          payload: { authorized: false },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

const localHost = { host: "127.0.0.1:4000" };
test("CORS preflight is limited to the configured web origin", async () => {
  const app = buildApp({} as PrismaClient);
  try {
    const preflight = (origin: string) =>
      app.inject({
        method: "OPTIONS",
        url: "/api/v1/assessments",
        headers: {
          ...localHost,
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
    const allowed = await preflight("http://127.0.0.1:3000");
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers).toMatchObject({
      "access-control-allow-origin": "http://127.0.0.1:3000",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      vary: "Origin",
    });
    expect(allowed.headers).not.toHaveProperty("access-control-allow-credentials");
    for (const origin of ["http://localhost:3000", "https://evil.example", "null"]) {
      const refused = await preflight(origin);
      expect(refused.statusCode).toBe(403);
      expect(refused.headers).not.toHaveProperty("access-control-allow-origin");
    }
  } finally {
    await app.close();
  }
});
test("unknown routes share the application error shape and the host check", async () => {
  const app = buildApp({} as PrismaClient);
  try {
    for (const [method, url] of [
      ["GET", "/private-path?token=value"],
      ["POST", "/api/v1/unknown"],
      ["PUT", "/api/v1/targets"],
    ] as const) {
      const response = await app.inject({ method, url, headers: localHost });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: "NOT_FOUND",
        requestId: expect.any(String),
      });
    }
    const foreign = await app.inject({ url: "/missing", headers: { host: "evil.example" } });
    expect(foreign.statusCode).toBe(403);
  } finally {
    await app.close();
  }
});
test("missing records return their specific 404 code through the full app", async () => {
  const none = async () => null;
  const app = buildApp({
    assessment: { findUnique: none },
    target: { findFirst: none, updateMany: async () => ({ count: 0 }) },
    $transaction: async (work: (tx: unknown) => unknown) =>
      work({ assessment: { findUnique: none }, $queryRaw: async () => [] }),
  } as unknown as PrismaClient);
  const id = "b113e0b9-c57f-43a4-86a7-51fe94507c96";
  const base = "/api/v1/assessments/" + id;
  try {
    for (const [method, url, code, payload] of [
      ["GET", base, "ASSESSMENT_NOT_FOUND"],
      ["GET", base + "/execution", "ASSESSMENT_NOT_FOUND"],
      ["POST", base + "/cancel-tracking", "ASSESSMENT_NOT_FOUND", { confirmed: true }],
      ["POST", base + "/zap-sync", "ASSESSMENT_NOT_FOUND", {}],
      ["GET", "/api/v1/targets/" + id, "TARGET_NOT_FOUND"],
      ["DELETE", "/api/v1/targets/" + id, "TARGET_NOT_FOUND"],
    ] as const) {
      const response = await app.inject({ method, url, headers: localHost, payload });
      expect([url, response.statusCode, response.json().error]).toEqual([url, 404, code]);
    }
    const unconfirmed = await app.inject({
      method: "POST",
      url: base + "/cancel-tracking",
      headers: localHost,
      payload: {},
    });
    expect(unconfirmed.json().error).toBe("INVALID_REQUEST");
  } finally {
    await app.close();
  }
});
test("dashboard failures are mapped by the full app without partial totals", async () => {
  const failures: [Error, number, string][] = [
    [new Prisma.PrismaClientInitializationError("private fixture", "6", "P1001"), 503, "DATABASE_UNAVAILABLE"],
    [
      new Prisma.PrismaClientKnownRequestError("private fixture", {
        clientVersion: "6",
        code: "P2024",
      }),
      503,
      "DATABASE_UNAVAILABLE",
    ],
    [new Error("private fixture"), 500, "INTERNAL_ERROR"],
  ];
  for (const [failure, status, code] of failures) {
    const app = buildApp({
      assessment: { count: () => 0 },
      finding: { groupBy: () => [] },
      $transaction: async () => {
        throw failure;
      },
    } as unknown as PrismaClient);
    try {
      const response = await app.inject({ url: "/api/v1/dashboard", headers: localHost });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ error: code, requestId: expect.any(String) });
    } finally {
      await app.close();
    }
  }
});
