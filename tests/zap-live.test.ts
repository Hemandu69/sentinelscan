import { PrismaClient } from "@prisma/client";
import { expect, test } from "vitest";
import { buildApp } from "../src/app.ts";
const live = test.runIf(process.env.npm_lifecycle_event === "test:zap:live");
live.each([
  "version",
  "alerts?count=1",
  "scans?kind=spider",
  "scans?kind=active",
])("local ZAP via Fastify: %s", async (path) => {
  const db = new PrismaClient();
  const app = buildApp(db);
  try {
    const result = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/zap/" + path,
      headers: { host: "127.0.0.1:4000" },
    });
    expect(result.statusCode, result.json().error).toBe(200);
    if (path === "version") expect(result.json().version).toBe("2.17.0");
    else if (path.startsWith("scans")) {
      expect(result.json().provider).toEqual({
        endpoint: "http://127.0.0.1:8090",
        version: "2.17.0",
      });
      expect(Array.isArray(result.json().runs)).toBe(true);
    } else expect(Array.isArray(result.json().findings)).toBe(true);
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
