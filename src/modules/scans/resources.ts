import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ApiError } from "../../lib/errors.ts";

const exec = promisify(execFile);
async function docker(...args: string[]) {
  try {
    const { stdout } = await exec("docker", ["--context", "desktop-linux", ...args], {
      timeout: 10000,
      maxBuffer: 65536,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    throw new ApiError(503, "DOCKER_UNAVAILABLE");
  }
}
const zap = "sentinelscan-infrastructure-zap-1";
const shop = "sentinelscan-infrastructure-juice-shop-1";
// Read-only. Containers are never started, stopped or changed here.
export const dockerResources = {
  async configuration() {
    const value = await docker(
      "inspect",
      "--format",
      "{{.HostConfig.Memory}}|{{.Config.Image}}|{{json .Config.Cmd}}",
      zap,
    );
    const match = /^(\d+)\|([^|]+)\|([\s\S]*)$/.exec(value);
    if (!match) throw new ApiError(503, "DOCKER_UNAVAILABLE");
    return {
      memoryBytes: Number(match[1]),
      image: match[2],
      heap: /-Xmx(\d+m)\b/.exec(match[3])?.[1] ?? null,
    };
  },
  async demoAddress() {
    return docker(
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      shop,
    );
  },
  // The demo website must be running only when it is the website being scanned.
  async sample(demo: boolean) {
    const state = await docker(
      "inspect",
      "--format",
      "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}} {{.State.OOMKilled}}",
      zap,
    );
    const target = demo
      ? await docker("inspect", "--format", "{{.State.Status}}", shop)
      : "running";
    const usage = await docker("stats", "--no-stream", "--format", "{{.MemPerc}}", zap);
    const match = /^(\d{1,3}(?:\.\d+)?)%$/.exec(usage);
    return {
      healthy: state === "running healthy false" && target === "running",
      memoryPercent: match ? Number(match[1]) : null,
    };
  },
};
export type Resources = typeof dockerResources;
