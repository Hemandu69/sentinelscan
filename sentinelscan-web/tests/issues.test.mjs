import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisLabel, disabledReason, explain, issueList, summarize } from "../lib/issues.ts";
import { timeoutFor } from "../lib/api.ts";
const id = "83ee2301-c70b-4c6b-b66d-b8f275d066f0";
const result = { plainTitle: "AI title", summary: "AI", whatHappened: "AI", whyItMatters: "AI", technicalExplanation: "AI", potentialImpact: "AI", practicalPriority: "NO_ACTION", priorityReason: "AI", recommendedAction: "AI", remediation: [], verificationSteps: ["AI"], falsePositiveNotes: "AI", limitations: "AI", evidenceSufficient: false, exampleCode: null };
const row = (change = {}) => ({
  key: "a".repeat(64), assessmentId: id, targetId: id, website: "x",
  scanner: { title: "Raw alert", ruleId: "1", severity: "INFO", sourceSeverity: "Informational", confidence: "Medium", method: null, parameter: null, evidence: null, description: "First sentence. Second.", remediation: null, references: [], cweId: null, wascId: null },
  guide: { plainTitle: "Guide title", summary: "Guide", whatHappened: "Guide", whyItMatters: "Guide", nextAction: "Guide", verify: [] },
  findings: [{ id, url: "http://x/", firstObservedAt: "2026-11-24T06:48:31.303Z" }],
  endpoints: ["http://x/"],
  analysis: { status: "NONE", errorCode: null, provider: null, model: null, analysedAt: null, result: null },
  ...change,
});
const list = (rows) => ({ counts: { originalAlerts: 24, findings: rows.length, issues: rows.length, endpoints: 1 }, severities: { INFO: rows.length }, coverage: { analysed: 0, unanalysed: rows.length }, issues: rows });
test("explanations prefer AI, then the guide, then scanner text, and say which", () => {
  const ai = row({ analysis: { ...row().analysis, status: "COMPLETED", result } });
  assert.deepEqual([explain(ai).origin, explain(ai).title], ["ai", "AI title"]);
  assert.deepEqual([explain(row()).origin, explain(row()).title], ["guide", "Guide title"]);
  const raw = explain(row({ guide: null }));
  assert.deepEqual([raw.origin, raw.title, raw.summary, raw.why], ["scanner", "Raw alert", "First sentence.", null]);
  assert.equal(ai.scanner.severity, "INFO");
});
test("lists with inconsistent totals or a completed analysis without a result are refused", () => {
  assert.equal(issueList.safeParse(list([row()])).success, true);
  for (const bad of [
    { ...list([row()]), counts: { ...list([row()]).counts, findings: 24 } },
    { ...list([row()]), coverage: { analysed: 1, unanalysed: 1 } },
    { ...list([row()]), severities: { HIGH: 2 } },
    list([row({ analysis: { ...row().analysis, status: "COMPLETED" } })]),
  ])
    assert.equal(issueList.safeParse(bad).success, false);
});
test("the summary uses scanner severity only and never claims safety", () => {
  assert.match(summarize(list([])).headline, /no findings/);
  assert.match(summarize(list([row()])).headline, /Only informational/);
  const high = row({ scanner: { ...row().scanner, severity: "HIGH" } });
  assert.match(summarize(list([high])).headline, /1 issue needs attention/);
  for (const rows of [[], [row()], [high]]) assert.doesNotMatch(summarize(list(rows)).headline, /secure|safe|score/i);
});
test("availability messages are specific", () => {
  assert.match(disabledReason("AI_DISABLED", true), /not configured/);
  assert.match(disabledReason("AI_MISSING_KEY", true), /no API key/);
  assert.match(disabledReason(null, false), /table/);
  assert.equal(disabledReason(null, true), null);
  assert.equal(analysisLabel("PARTIAL"), "Partly AI analysed");
  assert.equal(timeoutFor("/api/v1/assessments/" + id + "/issues/" + "a".repeat(64) + "/analysis"), 600000);
});
