import { test, expect, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerRecords } from "../src/modules/assessments/records.ts";
test("assessment counts stay unknown until completion; history is scoped and paged", async () => {
  const targetId = "19cf23db-3901-4c11-be04-cd6b499db65f";
  const row = {
    id: targetId,
    target: { displayName: "Fixture" },
    status: "PENDING",
    _count: { findings: 0 },
  };
  const list = vi.fn(async () => Array(26).fill(row));
  const db = { assessment: { findMany: list } };
  const app = Fastify();
  registerRecords(app, db as unknown as PrismaClient);
  try {
    const response = await app.inject(
      "/api/v1/assessments?targetId=" + targetId,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(25);
    expect(response.json()).toMatchObject({ hasMore: true });
    expect(response.json().items[0].findingCount).toBeNull();
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ where: { targetId }, take: 26 }),
    );
  } finally {
    await app.close();
  }
});
test("finding explorer restricts reads to completed assessments and strips private URL components", async () => {
  const list = vi.fn(async () => [
    {
      url: "https://user:pw@example.org/x?private#private",
      assessment: { target: { displayName: "Fixture" } },
    },
  ]);
  const app = Fastify();
  registerRecords(app, {
    finding: { findMany: list },
  } as unknown as PrismaClient);
  try {
    const response = await app.inject(
      "/api/v1/findings?severity=LOW&q=fixture",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toEqual({
      url: "https://example.org/x",
      website: "Fixture",
    });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assessment: { status: "COMPLETED" },
          normalizedSeverity: "LOW",
          name: { contains: "fixture", mode: "insensitive" },
        }),
      }),
    );
  } finally {
    await app.close();
  }
});
test.each([
  ["newest", "firstObservedAt", "desc"],
  ["oldest", "firstObservedAt", "asc"],
  ["title", "name", "asc"],
])(
  "findings sort %s is applied before pagination",
  async (sort, key, direction) => {
    const list = vi.fn(async () => []);
    const app = Fastify();
    registerRecords(app, {
      finding: { findMany: list },
    } as unknown as PrismaClient);
    try {
      expect(
        (await app.inject("/api/v1/findings?offset=25&sort=" + sort))
          .statusCode,
      ).toBe(200);
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 25,
          orderBy: [{ [key]: direction }, { id: direction }],
          select: expect.objectContaining({ method: true, parameter: true }),
        }),
      );
    } finally {
      await app.close();
    }
  },
);
