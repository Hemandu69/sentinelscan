import { expect, it, vi } from "vitest";
import { canonicalize } from "../src/lib/security/destination.ts";
import { confirmations } from "../src/modules/assessments/consent.ts";
it.each([
  "file:///tmp",
  "https://x:y@example.com",
  "http://localhost.",
  "http://2130706433",
  "http://169.254.169.254",
  "http://10.0.0.1",
  "http://192.0.2.1",
  "http://224.0.0.1",
  "http://[::ffff:127.0.0.1]",
  "http://[fc00::1]",
  "http://[fe80::1]",
  "http://[2001:db8::5]",
  "http://[::1]",
  "http://168.63.129.16",
  "http://100.100.100.200",
  "junk",
])("rejects %s", async (raw) => {
  await expect(canonicalize(raw, vi.fn())).rejects.toThrow(
    "DESTINATION_PROHIBITED",
  );
});
it("checks all DNS answers and fails closed on resolution errors", async () => {
  for (const addresses of [[], [{ address: "8.8.8.8" }, { address: "::1" }]])
    await expect(
      canonicalize("https://example.com", async () => addresses),
    ).rejects.toThrow();
  await expect(
    canonicalize("https://example.com", async () => {
      throw Error("DNS");
    }),
  ).rejects.toThrow();
  expect(
    await canonicalize("HTTPS://Example.com.:443/path#fragment", async () => [
      { address: "8.8.8.8" },
      { address: "2606:4700:4700::1111" },
    ]),
  ).toBe("https://example.com/path");
});
it("binds consent to the selected URL and target, refuses expiry and reuse", () => {
  let now = 0;
  const grants = confirmations(() => now);
  const grant = grants.issue("a", "https://example.com/");
  expect(() => grants.consume(grant.token, "b", grant.url)).toThrow();
  expect(() => grants.consume(grant.token, "a", grant.url + "other")).toThrow();
  grants.consume(grant.token, "a", grant.url);
  expect(() => grants.consume(grant.token, "a", grant.url)).toThrow();
  const expired = grants.issue("a", grant.url);
  now = 300000;
  expect(() => grants.consume(expired.token, "a", grant.url)).toThrow();
});
it("allows only the exact opt-in demo record while preserving the ordinary network policy", async () => {
  const { registeredScope } =
    await import("../src/lib/security/destination.ts");
  try {
    vi.stubEnv("SENTINELSCAN_DEMO_TARGET", "");
    await expect(registeredScope("http://juice-shop:3000/")).rejects.toThrow();
    vi.stubEnv("SENTINELSCAN_DEMO_TARGET", "juice-shop");
    expect(await registeredScope("http://juice-shop:3000/")).toBe(
      "http://juice-shop:3000/",
    );
    await expect(canonicalize("http://juice-shop:3000/")).rejects.toThrow();
    for (const url of [
      "http://juice-shop:3001/",
      "http://juice-shop:3000/private",
      "http://127.0.0.1:3001/",
      "http://juice-shop:3000/?x=1",
    ])
      await expect(registeredScope(url)).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
  }
});
