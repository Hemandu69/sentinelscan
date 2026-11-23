import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeError,
  request,
  RequestFailure,
  RequestTimeout,
  timeoutFor,
} from "../lib/api.ts";

const base = "/api/v1/assessments/b113e0b9-c57f-43a4-86a7-51fe94507c96";
const live = () => new AbortController().signal;
test("provider operations wait longer than their server-side reads", () => {
  // Two session checks (Docker, version, location) plus one inventory and progress read.
  const verification = 2 * 3 * 5000 + 2 * 5000;
  assert.ok(timeoutFor(base + "/zap-association") > verification);
  assert.ok(timeoutFor(base + "/zap-sync") > verification);
  // Import verifies twice, sequentially for both runs, around a 60 second result read.
  assert.ok(timeoutFor(base + "/zap-import") > 2 * (verification + 10000) + 60000);
  assert.ok(timeoutFor(base + "/zap-observations/active/0") > 15000);
  assert.equal(timeoutFor(base + "/execution"), 8000);
  assert.equal(timeoutFor(base + "/cancel-tracking"), 8000);
  assert.equal(timeoutFor("/health"), 8000);
});
test("request applies the operation's timeout", async (t) => {
  const limits = [];
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms) => {
    limits.push(ms);
    return original.call(AbortSignal, ms);
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await request(base + "/zap-sync", live(), {});
  await request("/health", live());
  assert.deepEqual(limits, [60000, 8000]);
});
for (const [name, payload, message] of [
  ["read", undefined, /did not respond in time/],
  ["write", {}, /may still have finished/],
])
  test("timed out " + name + " is explained without claiming an outcome", async (t) => {
    t.mock.method(AbortSignal, "timeout", () =>
      AbortSignal.abort(new DOMException("internal", "TimeoutError")),
    );
    t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
      signal.throwIfAborted();
    });
    await assert.rejects(request(base + "/zap-sync", live(), payload), (error) => {
      assert.ok(error instanceof RequestTimeout);
      assert.equal(error.name, "TimeoutError");
      assert.match(describeError(error), message);
      return true;
    });
  });
test("a timeout while reading the body is also explained", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => {
      throw new DOMException("internal", "TimeoutError");
    },
  }));
  await assert.rejects(request("/health", live()), RequestTimeout);
});
test("deliberate cancellation is not reported as a timeout", async (t) => {
  const control = new AbortController();
  control.abort();
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    signal.throwIfAborted();
  });
  await assert.rejects(request("/health", control.signal), { name: "AbortError" });
});
test("known codes are explained; unknown, inherited and malformed codes are summarized", async (t) => {
  for (const [body, message] of [
    [{ error: "ZAP_UNAVAILABLE" }, /ZAP is unavailable/],
    [{ error: "DATABASE_UNAVAILABLE" }, /database is unavailable/],
    [{ error: "ASSESSMENT_NOT_FOUND" }, /does not exist/],
    [{ error: "DEMO_SCOPE_DISABLED" }, /demo setting/],
    [{ error: "private detail" }, /^The local service could not complete/],
    [{ error: "constructor" }, /^The local service could not complete/],
    [null, /^The local service could not complete/],
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(body, { status: 503 }));
    await assert.rejects(request("/health", live()), (error) => {
      assert.ok(error instanceof RequestFailure);
      assert.match(error.message, message);
      return true;
    });
  }
});
test("internal errors are never shown verbatim", () => {
  assert.match(describeError(new TypeError("fetch internals")), /^Could not reach/);
  assert.match(describeError(new Error("internal detail")), /unexpected response/);
  assert.match(describeError("text"), /unexpected response/);
});
