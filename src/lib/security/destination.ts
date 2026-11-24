import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { ApiError } from "../errors.ts";
// The only website that scans may reach.
export const demoTarget = "http://juice-shop:3000/";
const deny = () => new ApiError(422, "DESTINATION_PROHIBITED");
export type Resolve = (host: string) => Promise<{ address: string }[]>;
const systemResolve: Resolve = (host) =>
  lookup(host, { all: true, verbatim: true });
function publicAddress(address: string) {
  if (!isIP(address)) return false;
  const ip = ipaddr.parse(address);
  if (ip.range() !== "unicast") return false;
  if (ip.kind() === "ipv4")
    return !["192.0.0.0/24", "192.88.99.0/24", "168.63.129.16/32"].some((net) =>
      ip.match(ipaddr.parseCIDR(net)),
    );
  return (
    ip.match(ipaddr.parseCIDR("2000::/3")) &&
    !["2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"].some((net) =>
      ip.match(ipaddr.parseCIDR(net)),
    )
  );
}
export async function canonicalize(
  raw: string,
  resolve: Resolve = systemResolve,
) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw deny();
  }
  if (
    !/^https?:\/\//i.test(raw) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    raw.includes("\\") ||
    /[\u0000-\u0020\u007f]/u.test(raw)
  )
    throw deny();
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    !host ||
    (!isIP(host) &&
      (!host.includes(".") ||
        /(^|\.)(localhost|local|internal|test|invalid|home\.arpa|onion)$/.test(
          host,
        )))
  )
    throw deny();
  if (!isIP(host)) url.hostname = host;
  let addresses: { address: string }[];
  try {
    addresses = isIP(host) ? [{ address: host }] : await resolve(host);
  } catch {
    throw deny();
  }
  if (!addresses.length || !addresses.every((v) => publicAddress(v.address)))
    throw deny();
  url.hash = "";
  return url.href;
}
export function registeredScope(raw: string, resolve?: Resolve) {
  // Record-only exception for the isolated demo. Outbound network requests must use the ordinary destination policy.
  if (
    process.env.SENTINELSCAN_DEMO_TARGET === "juice-shop" &&
    raw === demoTarget
  ) {
    return Promise.resolve(raw);
  }
  return canonicalize(raw, resolve);
}
