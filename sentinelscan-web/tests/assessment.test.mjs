import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWebsite, createAssessment } from "../lib/api.ts";
const id = "7f94fe06-79b4-4522-b4ee-05960ff63b8c",
  url = "https://example.org/assessment-path?q=a%20b";
const site = {
  id,
  canonicalUrl: url,
  displayName: "Fixture",
  createdAt: "2026-01-01T00:00:00Z",
  confirmation: {
    token: "d5f6859f-9b45-4d4e-a4d5-91451e29f713",
    wording: "I own this website or have explicit permission.",
    version: "1",
    url,
    expiresAt: "2099-01-01T00:00:00Z",
  },
};
const signal = new AbortController().signal;
test("detail verifies target identity and consent scope", async (t) => {
  const get = t.mock.method(globalThis, "fetch", async () =>
    Response.json(site),
  );
  assert.deepEqual(
    (await fetchWebsite(id, signal)).confirmation,
    site.confirmation,
  );
  get.mock.mockImplementation(async () =>
    Response.json({
      ...site,
      confirmation: { ...site.confirmation, url: url + "/other" },
    }),
  );
  await assert.rejects(fetchWebsite(id, signal), /verified/);
});
test("no POST without explicit valid confirmation", async (t) => {
  const fn = t.mock.method(globalThis, "fetch", async () => {
    throw Error("unexpected network request");
  });
  await assert.rejects(createAssessment(site, false, signal), /confirm/);
  await assert.rejects(
    createAssessment(
      {
        ...site,
        confirmation: {
          ...site.confirmation,
          expiresAt: "2000-01-01T00:00:00Z",
        },
      },
      true,
      signal,
    ),
    /fresh/,
  );
  assert.equal(fn.mock.callCount(), 0);
});
test("submits exact backend payload and verifies pending receipt", async (t) => {
  const response = {
    id: "d4f1a34b-2e2a-458c-8a1d-37c7c9bc200f",
    targetId: id,
    targetUrlSnapshot: url,
    status: "PENDING",
  };
  const fn = t.mock.method(globalThis, "fetch", async () =>
    Response.json(response, { status: 201 }),
  );
  assert.deepEqual(await createAssessment(site, true, signal), {
    id: response.id,
    status: "PENDING",
  });
  const [path, opts] = fn.mock.calls[0].arguments;
  assert.equal(path, "http://127.0.0.1:4000/api/v1/assessments");
  assert.equal(opts.method, "POST");
  assert.deepEqual(JSON.parse(opts.body), {
    targetId: id,
    url,
    authorized: true,
    authorizationTextVersion: "1",
    confirmationToken: site.confirmation.token,
  });
  fn.mock.mockImplementation(async () =>
    Response.json({ ...response, status: "COMPLETED" }),
  );
  await assert.rejects(createAssessment(site, true, signal), /receipt/);
});
test("expired server token surfaces actionable error and does not retry", async (t) => {
  const fn = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "NEW_CONFIRMATION_REQUIRED" }, { status: 409 }),
  );
  await assert.rejects(
    createAssessment(site, true, signal),
    /authorization expired/,
  );
  assert.equal(fn.mock.callCount(), 1);
});
