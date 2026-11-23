import { beforeEach, afterEach, test, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.ts";
import { createZapClient } from "../src/integrations/zap/client.ts";
const target = "http://juice-shop:3000/";
const id = "b113e0b9-c57f-43a4-86a7-51fe94507c96";
beforeEach(() => vi.stubEnv("SENTINELSCAN_DEMO_TARGET", "juice-shop"));
afterEach(() => vi.unstubAllEnvs());
async function exercise(
  rows: unknown[],
  status: number,
  options: { consent?: string; outage?: boolean; state?: string } = {},
) {
  const findUnique = vi.fn(async () => ({
    status: "PENDING",
    authorizationTextVersion: options.consent ?? "1",
    authorizationConfirmedAt: new Date(),
    targetUrlSnapshot: target,
    target: { canonicalUrl: target, archivedAt: null },
  }));
  const transport = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (options.outage) return new Response(null, { status: 503 });
    if (path === "/JSON/core/view/version/")
      return Response.json({ version: "2.17.0" });
    if (path === "/JSON/ascan/view/scans/")
      return Response.json({ scans: rows });
    throw Error("unexpected provider operation");
  });
  const app = buildApp(
    { assessment: { findUnique } } as unknown as PrismaClient,
    undefined,
    undefined,
    createZapClient("test-credential", 500, transport),
  );
  try {
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        url: "/api/v1/assessments/" + id + "/zap-observations/active/0",
        headers: { host: "127.0.0.1:4000" },
      });
      expect(r.statusCode).toBe(status);
      if (status === 200)
        expect(r.json()).toMatchObject({
          assessmentStatus: "PENDING",
          associationVerified: false,
          providerState: options.state,
          progress: 100,
          scanId: "0",
        });
    }
    if (status === 403) expect(transport).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
}
test.each(["FINISHED", "FAILED", "CANCELLED"])(
  "repeated observation of %s never finalizes",
  async (state) =>
    exercise([{ id: "0", state, progress: "100" }], 200, { state }),
);
test("authorization is checked before provider access", () =>
  exercise([], 403, { consent: "obsolete" }));
test("refuses missing ID", () => exercise([{ id: "1" }], 404));
test("refuses duplicate provider ID", () =>
  exercise([{ id: "0" }, { id: "0" }], 409));
test("refuses another origin", () =>
  exercise([{ id: "0", url: "http://other.invalid/" }], 409));
test("outage remains unavailable", () => exercise([], 503, { outage: true }));
