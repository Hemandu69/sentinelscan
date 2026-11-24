import { expect, test } from "vitest";
import { configuredZapClient } from "../src/integrations/zap/client.ts";
const live = test.runIf(process.env.npm_lifecycle_event === "test:zap:live");
live("the configured ZAP answers authenticated reads", async () => {
  const zap = configuredZapClient();
  expect(await zap.version()).toBe("2.17.0");
  for (const kind of ["spider", "active"] as const)
    expect(Array.isArray(await zap.inspectRuns(kind))).toBe(true);
});
