import { ApiError } from "../../lib/errors.ts";
import type { ZapClient } from "./client.ts";
import { providerSession } from "./session.ts";

// Reads the fingerprint on both sides of the inventory so that a captured run ID
// and its session belong to the same observation. Nothing is stored or associated.
export async function captureSession(
  zap: Pick<ZapClient, "inspectRuns">,
  getSession: () => Promise<string>,
  now = () => new Date(),
) {
  const sessionKey = await getSession();
  const runs = [];
  for (const kind of ["spider", "active"] as const)
    for (const { id, state, progress } of await zap.inspectRuns(kind))
      runs.push({ kind, id, state, progress });
  if ((await getSession()) !== sessionKey)
    throw new ApiError(409, "ZAP_SESSION_CHANGED");
  return { capturedAt: now().toISOString(), sessionKey, runs };
}
export function describeCapture(capture: Awaited<ReturnType<typeof captureSession>>) {
  return [
    "Captured (UTC): " + capture.capturedAt,
    "Session fingerprint: " + capture.sessionKey,
    "Runs listed in this session: " + capture.runs.length,
    ...capture.runs.map((run) => "  " + JSON.stringify(run)),
    "Record this while your run belongs to the current session. It cannot be used to",
    "reconstruct a receipt for an earlier run. Nothing was stored or associated.",
  ];
}
export function captureConfiguredSession(zap: ZapClient) {
  return captureSession(zap, () => providerSession(zap));
}
