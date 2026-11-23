import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { ApiError } from "../../lib/errors.ts";
import type { ZapClient } from "./client.ts";
const exec = promisify(execFile);
export async function providerSession(zap: ZapClient) {
  let stamp: string;
  try {
    const { stdout } = await exec(
      "docker",
      [
        "--context",
        "desktop-linux",
        "inspect",
        "--format",
        '{{.Id}}|{{.State.StartedAt}}|{{.State.Running}}|{{range (index .NetworkSettings.Ports "8090/tcp")}}{{.HostIp}}:{{.HostPort}}{{end}}',
        "sentinelscan-infrastructure-zap-1",
      ],
      { timeout: 5000, maxBuffer: 2048, windowsHide: true },
    );
    stamp = stdout.trim();
    if (!/^[a-f0-9]{64}\|[\dT:.Z-]+\|true\|127\.0\.0\.1:8090$/.test(stamp))
      throw Error();
  } catch {
    throw new ApiError(503, "ZAP_INSTANCE_UNVERIFIABLE");
  }
  if ((await zap.version()) !== "2.17.0")
    throw new ApiError(409, "UNVERIFIED_PROVIDER_VERSION");
  return createHash("sha256")
    .update(JSON.stringify([stamp, await zap.sessionLocation()]))
    .digest("hex");
}
