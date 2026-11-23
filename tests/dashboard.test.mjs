import { test } from "node:test";
import assert from "node:assert/strict";
import { readDashboard } from "../lib/dashboard.ts";

const zero = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, OTHER: 0 };
const empty = {
  totalChecks: 0,
  completedChecks: 0,
  findingCount: 0,
  severityCounts: zero,
};

test("preserves empty history, incomplete checks and completed zero findings", () => {
  for (const summary of [
    empty,
    { ...empty, totalChecks: 1 },
    { ...empty, totalChecks: 1, completedChecks: 1 },
  ]) {
    assert.deepEqual(readDashboard(summary), summary);
  }
});
test("rejects inconsistent counts and keeps unknown severities in the total", () => {
  const summary = {
    totalChecks: 3,
    completedChecks: 2,
    findingCount: 3,
    severityCounts: { ...zero, HIGH: 2, OTHER: 1 },
  };
  assert.deepEqual(readDashboard(summary), summary);
  for (const invalid of [
    null,
    {},
    { ...summary, completedChecks: 0 },
    { ...summary, completedChecks: 4 },
    { ...summary, findingCount: 2 },
    { ...summary, severityCounts: {} },
  ]) {
    assert.throws(() => readDashboard(invalid));
  }
});
