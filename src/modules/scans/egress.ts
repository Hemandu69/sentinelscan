import { execFile } from "node:child_process";
import { isIPv4 } from "node:net";
import { promisify } from "node:util";
import { ApiError } from "../../lib/errors.ts";
import type { ScanTarget } from "../../lib/security/destination.ts";

// The kernel firewall inside ZAP's network namespace. ZAP has no capability to change it.
// Only fixed commands of the guard image run here, without a shell. See egress-guard in the
// infrastructure repository.
const image = "sentinelscan-egress-guard:1";
const container = "sentinelscan-infrastructure-zap-1";
const exec = promisify(execFile);
async function run(...args: string[]) {
  try {
    const { stdout } = await exec("docker", ["--context", "desktop-linux", ...args], {
      timeout: 60000,
      maxBuffer: 65536,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    throw new ApiError(503, "EGRESS_GUARD_UNAVAILABLE");
  }
}
export function createEgress(docker: (...args: string[]) => Promise<string> = run) {
  const guard = (...args: string[]) =>
    docker(
      "run", "--rm", "--pull", "never",
      "--network", "container:" + container,
      "--cap-drop", "ALL", "--cap-add", "NET_ADMIN",
      "--security-opt", "no-new-privileges",
      "--tmpfs", "/tmp",
      image,
      ...args,
    );
  return {
    async available() {
      const label = await docker(
        "image", "inspect", "--format", '{{index .Config.Labels "sentinelscan.egress-guard"}}', image,
      ).catch(() => "");
      return label === "1";
    },
    // Allows only this address and port, then proves it. Returns the applied rules.
    async apply(target: ScanTarget) {
      if (
        !/^[a-z0-9.-]{1,253}$/.test(target.host) ||
        !Number.isInteger(target.port) || target.port < 1 || target.port > 65535 ||
        !target.addresses.length || !target.addresses.every(isIPv4)
      )
        throw new ApiError(422, "DESTINATION_PROHIBITED");
      const rules = await guard("apply", target.host, String(target.port), ...target.addresses);
      if (!rules.includes("table inet sentinelscan")) throw new ApiError(503, "EGRESS_UNVERIFIED");
      const verdict = await guard("probe", String(target.port), target.addresses[0]).catch(() => "");
      if (verdict !== "VERIFIED") throw new ApiError(503, "EGRESS_UNVERIFIED");
      return rules;
    },
    // A restarted or changed namespace no longer reports the applied rules.
    async holds(rules: string) {
      return (await guard("status")) === rules;
    },
    async lock() {
      await guard("lock");
    },
  };
}
export type Egress = ReturnType<typeof createEgress>;
