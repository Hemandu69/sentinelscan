import { expect, test, vi } from "vitest";
import { providerSession } from "../src/integrations/zap/session.ts";
import {
  captureSession,
  describeCapture,
} from "../src/integrations/zap/capture.ts";

const stamp =
  "a".repeat(64) + "|2026-11-22T08:00:00.123456789Z|true|127.0.0.1:8090";
const provider = (version = "2.17.0", location = "/zap/session") => ({
  version: async () => version,
  sessionLocation: async () => location,
});
test("fingerprint is stable and changes with container, start time or session location", async () => {
  const key = (s = stamp, location = "/zap/session") =>
    providerSession(provider(undefined, location), async () => s + "\r\n");
  const first = await key();
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(await key()).toBe(first);
  for (const other of [
    await key(stamp.replace(/^a/, "b")),
    await key(stamp.replace("08:00", "09:00")),
    await key(stamp, "/zap/other"),
  ])
    expect(other).not.toBe(first);
});
test.each([
  ["stopped container", stamp.replace("|true|", "|false|")],
  ["public binding", stamp.replace("127.0.0.1", "0.0.0.0")],
  ["second binding", stamp + "127.0.0.1:8091"],
  ["short ID", stamp.slice(1)],
  ["empty output", ""],
])("fingerprint refuses %s before contacting the provider", async (_n, value) => {
  const zap = { version: vi.fn(), sessionLocation: vi.fn() };
  await expect(providerSession(zap, async () => value)).rejects.toThrow(
    "ZAP_INSTANCE_UNVERIFIABLE",
  );
  expect(zap.version).not.toHaveBeenCalled();
});
test("Docker failures are sanitized and other provider versions are refused", async () => {
  await expect(
    providerSession(provider(), async () => {
      throw new Error("private docker detail");
    }),
  ).rejects.toThrow(/^ZAP_INSTANCE_UNVERIFIABLE$/);
  await expect(
    providerSession(provider("2.16.0"), async () => stamp),
  ).rejects.toThrow("UNVERIFIED_PROVIDER_VERSION");
});
test("capture command reports one consistent session without a provider URL or outcome claim", async () => {
  const run = {
    id: "0",
    state: "FINISHED" as const,
    progress: 100,
    reportedOrigin: "http://private.invalid",
    outcome: "UNKNOWN" as const,
    exactRootUrl: false,
    requests: null,
    alerts: null,
    fields: ["id"],
  };
  const capture = await captureSession(
    { inspectRuns: async (kind) => (kind === "spider" ? [run] : []) },
    async () => "c".repeat(64),
    () => new Date(0),
  );
  expect(capture).toEqual({
    capturedAt: "1970-01-01T00:00:00.000Z",
    sessionKey: "c".repeat(64),
    runs: [{ kind: "spider", id: "0", state: "FINISHED", progress: 100 }],
  });
  const text = describeCapture(capture).join("\n");
  expect(text).toContain("c".repeat(64));
  expect(text).toContain("Nothing was stored or associated");
  expect(text).not.toMatch(/private|SUCCEEDED/);
});
test("capture fails when the session changes while runs are read", async () => {
  const keys = ["c", "d"].map((x) => x.repeat(64));
  await expect(
    captureSession({ inspectRuns: async () => [] }, async () => keys.shift()!),
  ).rejects.toThrow("ZAP_SESSION_CHANGED");
});
