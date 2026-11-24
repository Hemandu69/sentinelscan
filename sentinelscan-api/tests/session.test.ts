import { expect, test, vi } from "vitest";
import { providerSession } from "../src/integrations/zap/session.ts";

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
