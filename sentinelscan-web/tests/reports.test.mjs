import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { requestPdf, timeoutFor } from "../lib/api.ts";
import { reportsFor, unavailableReason } from "../lib/reports.ts";

const id = "83ee2301-c70b-4c6b-b66d-b8f275d066f0",
  other = "b113e0b9-c57f-43a4-86a7-51fe94507c96";
const pdf = Buffer.from("%PDF-1.4 fixture %%EOF");
const digest = createHash("sha256").update(pdf).digest("hex");
const live = () => new AbortController().signal;
const serve = (t, body, headers = {}, status = 200) =>
  t.mock.method(globalThis, "fetch", async () =>
    new Response(body, { status, headers: { "Content-Type": "application/pdf", "X-Report-Sha256": digest, ...headers } }),
  );
test("a verified PDF becomes a PDF blob", async (t) => {
  serve(t, pdf);
  const blob = await requestPdf("/x/pdf", live());
  assert.equal(blob.type, "application/pdf");
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), pdf);
});
for (const [name, body, headers] of [
  ["HTML", "<html></html>", { "Content-Type": "text/html" }],
  ["HTML labelled as PDF", "<html></html>", {}],
  ["a changed file", Buffer.from("%PDF-1.4 changed %%EOF"), {}],
  ["a missing checksum", pdf, { "X-Report-Sha256": "" }],
])
  test(name + " is never offered as a report", async (t) => {
    serve(t, body, headers);
    await assert.rejects(requestPdf("/x/pdf", live()), /PDF/);
  });
test("server errors are explained and never saved as a file", async (t) => {
  for (const [code, message] of [
    ["REPORT_NOT_FOUND", /Generate one first/],
    ["REPORT_CORRUPT", /checksum/],
    ["ASSESSMENT_NOT_COMPLETED", /completed assessment/],
    ["REPORT_BROWSER_MISSING", /Chrome or Edge/],
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: code }, { status: 404 }));
    await assert.rejects(requestPdf("/x/pdf", live()), message);
  }
});
const row = (change = {}) => ({ id: other, generatedAt: "2026-11-24T06:48:31.303Z", filename: `sentinelscan-report-${id}.pdf`, contentType: "application/pdf", sha256: digest, available: true, size: 10, pages: 2, outdated: false, ...change });
const state = (change = {}) => ({ assessmentId: id, assessmentStatus: "COMPLETED", canGenerate: true, reports: [row()], ...change });
test("report state must match the assessment, its status and a safe filename", () => {
  const schema = reportsFor(id);
  assert.equal(schema.safeParse(state()).success, true);
  for (const bad of [
    state({ assessmentId: other }),
    state({ assessmentStatus: "PENDING" }),
    state({ assessmentStatus: "PENDING", canGenerate: false }),
    state({ reports: [row({ filename: "../x.pdf" })] }),
    state({ reports: [row({ filename: `sentinelscan-report-${other}.pdf` })] }),
    state({ reports: [row({ contentType: "text/html" })] }),
    state({ reports: [row({ sha256: "x" })] }),
  ])
    assert.equal(schema.safeParse(bad).success, false);
  assert.equal(schema.safeParse(state({ assessmentStatus: "PENDING", canGenerate: false, reports: [] })).success, true);
});
test("unfinished assessments say why no report exists", () => {
  assert.match(unavailableReason("PENDING"), /once the assessment is completed/);
  assert.match(unavailableReason("OUTCOME_UNKNOWN"), /not verified/);
  assert.match(unavailableReason("FAILED"), /failed/);
  assert.equal(timeoutFor("/api/v1/assessments/" + id + "/reports"), 90000);
});
