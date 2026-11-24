import { test } from "node:test";
import assert from "node:assert/strict";
import { assessment, findings } from "../lib/records.ts";
import { detailFor } from "../lib/records.ts";
test("detail matches the requested record and only displays reconciled final counts", () => {
  const id = "b113e0b9-c57f-43a4-86a7-51fe94507c96";
  const timestamp = "2026-11-22T08:53:03.274Z";
  const pending = {
    id,
    website: "Fixture",
    targetUrlSnapshot: "https://example.invalid/",
    status: "PENDING",
    requestedAt: timestamp,
    startedAt: null,
    finishedAt: null,
    findingCount: null,
    severities: null,
  };
  const schema = detailFor(id);
  assert.equal(schema.safeParse(pending).success, true);
  assert.equal(
    schema.safeParse({ ...pending, id: "5bc499f5-0790-4714-ad87-49e7da07de09" })
      .success,
    false,
  );
  assert.equal(
    schema.safeParse({ ...pending, findingCount: 0, severities: [] }).success,
    false,
  );
  const final = {
    ...pending,
    status: "COMPLETED",
    finishedAt: timestamp,
    findingCount: 0,
    severities: [],
  };
  assert.equal(schema.safeParse(final).success, true);
  assert.equal(
    schema.safeParse({
      ...final,
      findingCount: 2,
      severities: [{ severity: "HIGH", count: 1 }],
    }).success,
    false,
  );
});
test("run evidence is optional, strict and labels unknown outcomes", async () => {
  const { runEvidence, statusLabel } = await import("../lib/records.ts");
  const evidence = {
    contract: "1.1",
    collectedAt: "2026-11-24T06:48:31.285Z",
    digest: "a".repeat(64),
    spider: { scanId: "0", startedAt: "2026-11-24T06:34:20.915690255Z", endedAt: "2026-11-24T06:34:39.026403793Z", results: 72 },
    active: { scanId: "0", startedAt: "2026-11-24T06:34:55.118271264Z", endedAt: "2026-11-24T06:39:53.988294585Z", completedRules: 51, skippedRules: ["x"], stoppedRules: 0, alerts: 24, requests: 3005, messages: 3002 },
    reconciliations: [{ ruleId: "20015", ruleName: "x", kind: "RAW_SOCKET", expectedRequests: 3, observedRequests: 3, observedMessages: 0, acceptedDiscrepancy: 3, targetOrigin: "http://juice-shop:3000", hostValues: [] }],
  };
  assert.equal(runEvidence.safeParse(evidence).success, true);
  for (const change of [{ digest: "x" }, { active: { ...evidence.active, alerts: -1 } }, { collectedAt: "later" }])
    assert.equal(runEvidence.safeParse({ ...evidence, ...change }).success, false);
  assert.equal(statusLabel("OUTCOME_UNKNOWN"), "Ended, outcome unknown");
  assert.equal(statusLabel("COMPLETED"), "Completed");
  assert.match(statusLabel("ACTIVE_SCAN_RUNNING"), /^Last recorded/);
  assert.equal(statusLabel("SOMETHING_NEW"), "SOMETHING_NEW");
});
test("records distinguish unreported findings from an empty result page", () => {
  assert.equal(assessment.shape.findingCount.parse(null), null);
  assert.equal(assessment.shape.findingCount.parse(0), 0);
  assert.equal(
    findings.safeParse({ items: null, hasMore: false }).success,
    false,
  );
  assert.deepEqual(findings.parse({ items: [], hasMore: false }), {
    items: [],
    hasMore: false,
  });
});
test("stored run responses preserve unknown progress and reject invalid percentages", async () => {
  const { execution } = await import("../lib/records.ts");
  const run = {
    kind: "active",
    scan_id: "0",
    progress: null,
    state: null,
    observed_at: "2026-11-22T08:53:03.274Z",
  };
  assert.deepEqual(
    execution.parse({ status: "PENDING", runs: [run] }).runs[0],
    run,
  );
  assert.equal(
    execution.safeParse({
      status: "PENDING",
      runs: [{ ...run, progress: 101 }],
    }).success,
    false,
  );
});
