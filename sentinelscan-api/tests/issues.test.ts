import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { expect, test, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import type { AiConfiguration } from "../src/integrations/ai/provider.ts";
import { createZapClient } from "../src/integrations/zap/client.ts";
import { ApiError } from "../src/lib/errors.ts";
import { groupFindings, issueKey } from "../src/modules/issues/grouping.ts";
import { inputDigest, inputFor } from "../src/modules/issues/routes.ts";
import type { Analysis } from "../src/integrations/ai/schema.ts";

const assessmentId = "83ee2301-c70b-4c6b-b66d-b8f275d066f0";
const finding = (change: object = {}) => ({
  id: randomUUID(),
  assessmentId,
  sourceRuleId: "10104",
  name: "User Agent Fuzzer",
  sourceSeverity: "Informational",
  normalizedSeverity: "INFO",
  confidence: "Medium",
  url: "http://juice-shop:3000/assets",
  method: "GET",
  parameter: "Header User-Agent",
  redactedEvidence: null,
  description: "Check for differences in response based on fuzzed User Agent.",
  remediation: null,
  references: ["https://owasp.org/www-project-web-security-testing-guide/"],
  cweId: null,
  wascId: null,
  firstObservedAt: new Date("2026-11-24T06:48:31.303Z"),
  assessment: { targetId: "ed603ae8-933f-4bdc-af5e-5c09d72fa998", target: { displayName: "Local Juice Shop" } },
  ...change,
});
const pair = () => [finding({ url: "http://juice-shop:3000/assets/public" }), finding()];
const analysis: Analysis = {
  plainTitle: "Different browsers get different answers",
  summary: "The scanner reported a difference.",
  whatHappened: "x", whyItMatters: "x", technicalExplanation: "x", potentialImpact: "x",
  practicalPriority: "NO_ACTION", priorityReason: "x", recommendedAction: "Compare once.",
  remediation: [], verificationSteps: ["Compare."], falsePositiveNotes: "x", limitations: "x",
  evidenceSufficient: false, exampleCode: null,
};
type Saved = Record<string, unknown> & { finding_id: string };
function setup(rows = pair(), ai?: AiConfiguration, ready = true) {
  const saved = new Map<string, Saved>();
  const writes: string[] = [];
  const db = {
    finding: { findMany: vi.fn(async () => rows) },
    runEvidence: { findMany: vi.fn(async () => [{ assessmentId, facts: { attributedAlerts: 24 } }]) },
    $queryRaw: async (parts: TemplateStringsArray) =>
      parts.join("?").includes("to_regclass") ? [{ ready }] : [...saved.values()],
    $executeRaw: async (parts: TemplateStringsArray, ...args: unknown[]) => {
      writes.push(parts.join("?"));
      const [finding_id, status, input_digest, prompt_version, provider, model, result, error_code] = args as string[];
      saved.set(finding_id, { finding_id, status, input_digest, prompt_version, provider, model, result: result === null ? null : JSON.parse(result), error_code, analysed_at: new Date() });
      return 1;
    },
    $transaction: async (work: Promise<unknown>[]) => Promise.all(work),
  };
  const app = buildApp(db as unknown as PrismaClient, undefined, undefined, createZapClient("x"), ai ?? { enabled: false, reason: "AI_DISABLED" });
  const headers = { host: "127.0.0.1:4000" };
  return {
    app, saved, writes, rows,
    get: async (url = "/api/v1/issues?assessmentId=" + assessmentId) => app.inject({ url, headers }),
    analyse: (key = issueKey(rows[0])) =>
      app.inject({ method: "POST", url: `/api/v1/assessments/${assessmentId}/issues/${key}/analysis`, headers, payload: {} }),
  };
}
const enabled = (complete: () => Promise<{ text: string; model: string }>): AiConfiguration => ({
  enabled: true,
  provider: { name: "anthropic", model: "claude-opus-5-5", complete },
});
const answer = (change: object = {}) => async () => ({ text: JSON.stringify({ ...analysis, ...change }), model: "claude-opus-5-5" });

test("the same observation at two locations forms one issue and keeps both records", async () => {
  const f = setup();
  try {
    const body = (await f.get()).json();
    expect(body.counts).toEqual({ originalAlerts: 24, findings: 2, issues: 1, endpoints: 2 });
    expect(body.severities).toMatchObject({ INFO: 1, HIGH: 0 });
    expect(body.coverage).toEqual({ analysed: 0, unanalysed: 1 });
    expect(body.issues[0].findings.map((row: { id: string }) => row.id).sort()).toEqual(f.rows.map((r) => r.id).sort());
    expect(body.issues[0].endpoints).toEqual(["http://juice-shop:3000/assets", "http://juice-shop:3000/assets/public"]);
    expect(body.issues[0].scanner).toMatchObject({ title: "User Agent Fuzzer", sourceSeverity: "Informational", severity: "INFO", confidence: "Medium" });
    expect(body.issues[0].guide.plainTitle).toBeTruthy();
    expect(body.issues[0].analysis).toMatchObject({ status: "NONE", result: null });
  } finally {
    await f.app.close();
  }
});
test.each([
  { assessmentId: randomUUID() }, { sourceRuleId: "40012" }, { name: "Other" }, { sourceSeverity: "Low" }, { normalizedSeverity: "LOW" },
  { confidence: "High" }, { method: "POST" }, { parameter: "q" }, { description: "Other" }, { remediation: "Other" }, { cweId: 79 }, { wascId: 8 },
])("findings that differ in %o stay separate", (change) => {
  expect(groupFindings([finding(), finding({ url: "http://juice-shop:3000/b", ...change })])).toHaveLength(2);
});
test("issues are ordered by scanner severity", () => {
  const groups = groupFindings([finding(), finding({ name: "A", normalizedSeverity: "HIGH" }), finding({ name: "B", normalizedSeverity: "odd" })]);
  expect(groups.map((g) => g.findings[0].normalizedSeverity)).toEqual(["HIGH", "INFO", "odd"]);
});
test("alert totals are unknown without verified evidence for every finding", async () => {
  const f = setup([finding(), finding({ assessmentId: randomUUID() })]);
  try {
    expect((await f.get("/api/v1/issues")).json().counts.originalAlerts).toBeNull();
  } finally {
    await f.app.close();
  }
});
test("issues stay readable when AI is off and when its storage is absent", async () => {
  for (const ready of [true, false]) {
    const f = setup(pair(), undefined, ready);
    try {
      expect((await f.get()).statusCode).toBe(200);
      expect((await f.get("/api/v1/analysis/status")).json()).toEqual({ enabled: false, reason: "AI_DISABLED", provider: null, model: null, storageReady: ready });
      const response = await f.analyse();
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe("AI_DISABLED");
      expect(f.writes).toEqual([]);
    } finally {
      await f.app.close();
    }
  }
  const f = setup(pair(), enabled(answer()), false);
  try {
    expect((await f.analyse()).json().error).toBe("ANALYSIS_STORAGE_UNAVAILABLE");
  } finally {
    await f.app.close();
  }
});
test("one provider call covers the issue, is stored per finding and never repeats", async () => {
  const complete = vi.fn(answer());
  const f = setup(pair(), enabled(complete));
  try {
    const first = await f.analyse();
    expect(first.statusCode).toBe(200);
    expect(first.json().analysis).toMatchObject({ status: "COMPLETED", provider: "anthropic", model: "claude-opus-5-5", result: analysis });
    expect((await f.analyse()).json().analysis.status).toBe("COMPLETED");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(f.saved.size).toBe(2);
    const listed = (await f.get()).json();
    expect(listed.coverage).toEqual({ analysed: 1, unanalysed: 0 });
    // Scanner facts are unchanged, and only the analysis table was written.
    expect(listed.issues[0].scanner).toMatchObject({ severity: "INFO", sourceSeverity: "Informational", confidence: "Medium" });
    expect(f.writes.every((sql) => sql.startsWith("INSERT INTO finding_analyses("))).toBe(true);
  } finally {
    await f.app.close();
  }
});
test("an unusable answer is retried once, then recorded as failed and can be retried", async () => {
  const complete = vi.fn(async () => ({ text: "not json", model: "claude-opus-5-5" }));
  const f = setup(pair(), enabled(complete));
  try {
    const response = await f.analyse();
    expect([response.statusCode, response.json().error]).toEqual([502, "AI_INVALID_RESPONSE"]);
    expect(complete).toHaveBeenCalledTimes(2);
    expect((await f.get()).json().issues[0].analysis).toMatchObject({ status: "FAILED", errorCode: "AI_INVALID_RESPONSE", result: null });
    complete.mockImplementation(answer());
    expect((await f.analyse()).json().analysis.status).toBe("COMPLETED");
  } finally {
    await f.app.close();
  }
});
test("an answer that exaggerates an informational alert is never stored as a result", async () => {
  const f = setup(pair(), enabled(answer({ practicalPriority: "URGENT" })));
  try {
    expect((await f.analyse()).json().error).toBe("AI_INVALID_RESPONSE");
    expect([...f.saved.values()].every((row) => row.result === null)).toBe(true);
  } finally {
    await f.app.close();
  }
});
test.each([["AI_TIMEOUT", 504], ["AI_RATE_LIMITED", 429], ["AI_UNAVAILABLE", 503], ["AI_PROVIDER_ERROR", 502], ["AI_REFUSED", 502]] as const)(
  "%s is reported, recorded and not retried here",
  async (code, status) => {
    const complete = vi.fn(async () => {
      throw new ApiError(status, code);
    });
    const f = setup(pair(), enabled(complete));
    try {
      const response = await f.analyse();
      expect([response.statusCode, response.json().error]).toEqual([status, code]);
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      await f.app.close();
    }
  },
);
test("concurrent requests for one issue make one provider call", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const complete = vi.fn(async () => {
    await gate;
    return answer()();
  });
  const f = setup(pair(), enabled(complete));
  try {
    const first = f.analyse();
    await vi.waitFor(() => expect(complete).toHaveBeenCalled());
    expect((await f.analyse()).json().error).toBe("ANALYSIS_BUSY");
    release();
    expect((await first).statusCode).toBe(200);
    expect(complete).toHaveBeenCalledTimes(1);
  } finally {
    await f.app.close();
  }
});
test("partial, stale and corrupt stored results are never shown as complete", async () => {
  const f = setup();
  try {
    const digest = inputDigest(inputFor(groupFindings(f.rows)[0].findings));
    const row = (id: string, change: object = {}) => ({ finding_id: id, status: "COMPLETED", input_digest: digest, prompt_version: "1", provider: "anthropic", model: "m", result: analysis, error_code: null, analysed_at: new Date(), ...change });
    const status = async () => (await f.get()).json().issues[0].analysis.status;
    f.saved.set(f.rows[0].id, row(f.rows[0].id));
    expect(await status()).toBe("PARTIAL");
    f.saved.set(f.rows[1].id, row(f.rows[1].id));
    expect(await status()).toBe("COMPLETED");
    f.saved.set(f.rows[1].id, row(f.rows[1].id, { input_digest: "0".repeat(64) }));
    expect(await status()).toBe("PARTIAL");
    f.saved.set(f.rows[0].id, row(f.rows[0].id, { result: { ...analysis, severity: "HIGH" } }));
    expect(await status()).toBe("STALE");
    f.saved.clear();
    expect(await status()).toBe("NONE");
  } finally {
    await f.app.close();
  }
});
test("analysis input carries no identifiers, sessions or database values", () => {
  const text = JSON.stringify(inputFor(pair()));
  expect(text).not.toMatch(/83ee2301|assessment|fingerprint|session/i);
  expect(Object.keys(JSON.parse(text)).sort()).toEqual(["affectedUrls", "alertName", "cweId", "description", "evidence", "method", "parameter", "references", "ruleId", "scannerConfidence", "scannerRemediation", "scannerSeverity", "wascId"]);
});
test("unknown issues and malformed requests are refused", async () => {
  const f = setup(pair(), enabled(answer()));
  try {
    expect((await f.analyse("0".repeat(64))).json().error).toBe("ISSUE_NOT_FOUND");
    expect((await f.analyse("short")).statusCode).toBe(400);
  } finally {
    await f.app.close();
  }
});
