import { test } from "node:test";
import assert from "node:assert/strict";
import { readObservation, continueObserving } from "../lib/observation.ts";
const id = "b113e0b9-c57f-43a4-86a7-51fe94507c96";
const row = {
  assessmentId: id,
  kind: "active",
  scanId: "0",
  authorizedTarget: "http://juice-shop:3000/",
  provider: { endpoint: "http://127.0.0.1:8090", version: "2.17.0" },
  assessmentStatus: "PENDING",
  observedAt: "2026-11-22T09:03:04.648Z",
  providerState: "FINISHED",
  progress: 100,
  reportedOrigin: null,
  scopeEvidence: "UNAVAILABLE",
  associationVerified: false,
};
test("observation validates assessment, kind, run and scope evidence", () => {
  assert.deepEqual(readObservation(row, id, "active", "0"), row);
  for (const change of [
    { associationVerified: true },
    { kind: "spider" },
    { scanId: "1" },
    { assessmentId: crypto.randomUUID() },
    { scopeEvidence: "ORIGIN_ONLY" },
    { reportedOrigin: "https://example.org" },
  ])
    assert.throws(() =>
      readObservation({ ...row, ...change }, id, "active", "0"),
    );
});
test("only recognized nonterminal provider states continue polling", () => {
  for (const state of ["RUNNING", "NOT_STARTED", "PAUSED"])
    assert.equal(continueObserving(state), true);
  for (const state of [
    null,
    "FINISHED",
    "COMPLETED",
    "FAILED",
    "STOPPED",
    "CANCELLED",
    "unknown",
  ])
    assert.equal(continueObserving(state), false);
});
