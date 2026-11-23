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
