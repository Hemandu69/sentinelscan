import { test } from "node:test";
import assert from "node:assert/strict";
import { readSites, request, serviceReady } from "../lib/api.ts";
test("empty registry is a verified zero", () =>
  assert.deepEqual(readSites([]), []));
test("malformed registry is unavailable", () => {
  for (const value of [null, {}, [{}]]) assert.throws(() => readSites(value));
});
test("website count and recent registrations use real response rows", () => {
  const list = [
    {
      id: "one",
      displayName: "Example",
      canonicalUrl: "https://example.org/",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ];
  assert.equal(readSites(list)[0], list[0]);
});
test("only explicit per-service successes are operational", () => {
  assert.equal(serviceReady("/health", { status: "ok" }), true);
  assert.equal(serviceReady("/health/database", { status: "failed" }), false);
  assert.equal(
    serviceReady("/health/zap", { available: true, version: "2.17.0" }),
    true,
  );
  assert.equal(serviceReady("/health/zap", {}), false);
  assert.equal(serviceReady("/health/zap", { status: "ok" }), false);
});
test("HTTP errors become actionable messages", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "ACTIVE_TARGET_EXISTS" }, { status: 409 }),
  );
  await assert.rejects(
    request("/api/v1/targets", new AbortController().signal, {}),
    /already registered/,
  );
});
test("create sends JSON to Fastify", async (t) => {
  const f = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ id: "one" }),
  );
  const data = { displayName: "Site", url: "https://example.org" };
  await request("/api/v1/targets", new AbortController().signal, data);
  const [url, options] = f.mock.calls[0].arguments;
  assert.equal(url, "http://127.0.0.1:4000/api/v1/targets");
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), data);
});
test("network failures never become an empty response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("offline");
  });
  await assert.rejects(
    request("/health", new AbortController().signal),
    /offline/,
  );
});
