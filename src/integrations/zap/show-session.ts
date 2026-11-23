import { ApiError } from "../../lib/errors.ts";
import { captureConfiguredSession, describeCapture } from "./capture.ts";
import { configuredZapClient } from "./client.ts";

// Read-only command for the operator. Run from PowerShell: npm.cmd run zap:session
async function show() {
  const capture = await captureConfiguredSession(configuredZapClient());
  for (const line of describeCapture(capture)) console.log(line);
}
show().catch((error) => {
  console.error(
    error instanceof ApiError ? error.message : "ZAP_SESSION_CAPTURE_FAILED",
  );
  process.exitCode = 1;
});
