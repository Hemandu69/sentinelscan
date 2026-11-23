import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { loadReport } from "../lib/report.ts";

const id = randomUUID(),
  timestamp = "2026-11-22T08:53:03.274Z";
const row = {
  id: randomUUID(),
  assessmentId: id,
  website: "Fixture",
  name: "Fixture",
  normalizedSeverity: "LOW",
  url: "http://fixture.invalid/",
  confidence: "HIGH",
  firstObservedAt: timestamp,
  description: "Fixture",
  remediation: null,
  cweId: null,
  wascId: null,
};
const detail = {
  id,
  website: "Fixture",
  targetUrlSnapshot: row.url,
  status: "COMPLETED",
  requestedAt: timestamp,
  startedAt: null,
  finishedAt: timestamp,
  findingCount: 1,
  severities: [{ severity: "LOW", count: 1 }],
};
const page = (items, hasMore = false) => ({ items, hasMore });
function read(t, body, ...pages) {
  let offset = 0;
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/" + id)) return Response.json(body);
    assert.equal(url.searchParams.get("assessmentId"), id);
    assert.equal(url.searchParams.get("offset"), String(offset));
    const next = pages.shift();
    if (next instanceof Error) throw next;
    assert.ok(next);
    offset += next.items.length;
    return Response.json(next);
  });
  return loadReport(id, new AbortController().signal);
}
test("collects all pages in order and reconciles persisted totals", async (t) => {
  const second = { ...row, id: randomUUID() };
  const report = await read(
    t,
    { ...detail, findingCount: 2, severities: [{ severity: "LOW", count: 2 }] },
    page([row], true),
    page([second]),
  );
  assert.deepEqual(
    report.items.map((r) => r.id),
    [row.id, second.id],
  );
});
test("accepts a verified empty completed assessment", async (t) =>
  assert.deepEqual(
    (await read(t, { ...detail, findingCount: 0, severities: [] }, page([])))
      .items,
    [],
  ));
for (const [name, body, pages] of [
  ["incomplete assessment", { ...detail, status: "PENDING" }, []],
  ["mismatched assessment id", { ...detail, id: randomUUID() }, []],
  [
    "unrelated finding",
    detail,
    [page([{ ...row, assessmentId: randomUUID() }])],
  ],
  ["duplicate finding id", detail, [page([row, row])]],
  ["missing finding", detail, [page([])]],
  [
    "severity mismatch",
    { ...detail, severities: [{ severity: "HIGH", count: 1 }] },
    [page([row])],
  ],
  [
    "duplicate severity",
    {
      ...detail,
      severities: [...detail.severities, { severity: "LOW", count: 0 }],
    },
    [page([row])],
  ],
  ["missing severity", { ...detail, severities: [] }, [page([row])]],
  ["empty intermediate page", detail, [page([], true)]],
  [
    "failed second page",
    { ...detail, findingCount: 2 },
    [page([row], true), new Error("fixture disconnect")],
  ],
])
  test("withholds report for " + name, async (t) =>
    assert.rejects(read(t, body, ...pages)),
  );
