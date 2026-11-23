import type { PrismaClient } from "@prisma/client";
import { expect, test, vi } from "vitest";
import { normalize } from "../src/integrations/zap/findings.ts";
import { persistFinalFindings } from "../src/modules/assessments/persist-findings.ts";

const fixture = normalize({
  name: "Fixture",
  risk: "Low",
  confidence: "Medium",
  description: "Test only",
  url: "https://example.test/app/page",
});
function setup(status: string) {
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { status, target_url_snapshot: "https://example.test/app" },
      ]),
    finding: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(1),
    },
    assessment: { update: vi.fn() },
  };
  const db = {
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  } as unknown as PrismaClient;
  return { tx, db };
}
test("failed insert never reaches completion", async () => {
  const { tx, db } = setup("PROCESSING_RESULTS");
  tx.finding.createMany.mockRejectedValue(new Error("fixture failure"));
  await expect(persistFinalFindings(db, "id", [fixture])).rejects.toThrow(
    "fixture failure",
  );
  expect(tx.assessment.update).not.toHaveBeenCalled();
});
test.each(["FAILED", "CANCELLED", "PENDING"])(
  "%s cannot finalize",
  async (status) => {
    const { db, tx } = setup(status);
    await expect(persistFinalFindings(db, "id", [])).rejects.toThrow(
      "ASSESSMENT_NOT_PROCESSING",
    );
    expect(tx.assessment.update).not.toHaveBeenCalled();
  },
);
test("scope validation precedes writes", async () => {
  const { db, tx } = setup("PROCESSING_RESULTS");
  await expect(
    persistFinalFindings(db, "id", [
      fixture,
      { ...fixture, url: "https://example.test/application" },
    ]),
  ).rejects.toThrow("FINDING_OUTSIDE_TARGET");
  expect(tx.finding.createMany).not.toHaveBeenCalled();
});
