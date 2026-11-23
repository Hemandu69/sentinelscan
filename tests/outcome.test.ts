import { expect, test } from "vitest";
import { inventoryOutcome } from "../src/integrations/zap/outcome.ts";

test.each([
  "FINISHED",
  "COMPLETED",
  "FAILED",
  "STOPPED",
  "CANCELLED",
  "PAUSED",
  "NOT_STARTED",
  null,
  100,
])("inventory alone leaves outcome unknown for %s", (state) => {
  expect(inventoryOutcome(state)).toBe("UNKNOWN");
});
test("recognizes the observed ZAP running state", () => {
  expect(inventoryOutcome("RUNNING")).toBe("RUNNING");
});
