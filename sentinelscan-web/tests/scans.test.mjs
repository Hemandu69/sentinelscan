import test from "node:test";
import assert from "node:assert/strict";
import { comparison, isEnded, measured, readiness, readinessMessage, scanState, stepState } from "../lib/scans.ts";
import { actionGroup } from "../lib/issues.ts";

const id = "d4f1a34b-2e2a-458c-8a1d-37c7c9bc200f";
const state = (change) =>
  scanState.parse({
    assessmentId: id, status: "SPIDER_RUNNING", tracked: true, stage: "SPIDER_RUNNING",
    stageAt: "2026-11-24T08:00:00.000Z", spider: { progress: 40, requests: 1, alerts: 0 }, active: null,
    memoryPercent: 40, peakMemoryPercent: 41, cancelRequested: false, code: null, reasons: [], ...change,
  });
test("only scanner-reported percentages are shown", () => {
  assert.equal(measured(state({})), 40);
  assert.equal(measured(state({ spider: { progress: 0, requests: null, alerts: null } })), 0);
  for (const stage of ["PREPARING", "INITIALIZING", "SPIDER_VERIFYING", "ACTIVE_RUNNING", "COLLECTING_EVIDENCE", "COMPLETED"])
    assert.equal(measured(state({ stage })), null);
});
test("an untracked scan has no stage and invalid progress is rejected", () => {
  assert.throws(() => state({ tracked: false }));
  assert.throws(() => state({ stage: null }));
  assert.throws(() => state({ spider: { progress: 101, requests: 1, alerts: 1 } }));
  assert.throws(() => state({ stage: "ALMOST_DONE" }));
});
test("steps never mark unreached work as done", () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => stepState(i, "SPIDER_RUNNING")), ["done", "done", "current", "upcoming"]);
  for (const ended of ["FAILED", "CANCELLED", "OUTCOME_UNKNOWN"]) {
    assert.equal(isEnded(ended), true);
    assert.equal(stepState(0, ended), "upcoming");
  }
  assert.equal(isEnded("ACTIVE_RUNNING"), false);
  assert.equal(isEnded(null), false);
});
test("readiness must agree with its reasons", () => {
  assert.throws(() => readiness.parse({ ready: true, reasons: ["MEMORY_TOO_HIGH"] }));
  assert.throws(() => readiness.parse({ ready: false, reasons: [] }));
  assert.match(readinessMessage("DOCKER_UNAVAILABLE"), /Docker Desktop/);
  assert.doesNotMatch(readinessMessage("<b>x</b>"), /</);
});
test("a comparison without a fair basis carries no result", () => {
  const ref = { id, finishedAt: "2026-11-24T08:00:00.000Z", findings: 0 };
  assert.throws(() => comparison.parse({ earlier: ref, later: ref, comparable: true, reasons: [], result: null }));
  assert.ok(comparison.parse({ earlier: ref, later: ref, comparable: false, reasons: ["EVIDENCE_MISSING"], result: null }));
});
test("grouping uses AI priority only where it exists", () => {
  const row = (severity, practicalPriority) => ({ scanner: { severity }, analysis: { result: practicalPriority ? { practicalPriority } : null } });
  assert.equal(actionGroup(row("HIGH")), "first");
  assert.equal(actionGroup(row("LOW")), "plan");
  assert.equal(actionGroup(row("INFO")), "review");
  assert.equal(actionGroup(row("HIGH", "NO_ACTION")), "review");
});
