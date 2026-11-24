import { lookup } from "node:dns/promises";
import { isIP, isIPv4 } from "node:net";
import ipaddr from "ipaddr.js";
import { ApiError } from "../errors.ts";
// The code stays the same for every refusal. The reason says which check failed.
const deny = (reason: string) =>
  new ApiError(422, "DESTINATION_PROHIBITED", [reason]);
export const demoTarget = "http://juice-shop:3000/";
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
// Without a resolver, names are checked by syntax only.
async function inspectTarget(raw: string, resolve: Resolve | null) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw deny("TARGET_URL_INVALID");
  }
  if (url.username || url.password) throw deny("TARGET_CREDENTIALS");
  if (
    !/^https?:\/\//i.test(raw) ||
    !["http:", "https:"].includes(url.protocol) ||
    raw.includes("\\") ||
    /[\u0000-\u0020\u007f]/u.test(raw)
  )
    throw deny("TARGET_URL_INVALID");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    !host ||
    (!isIP(host) &&
      (!host.includes(".") ||
        /(^|\.)(localhost|local|internal|test|invalid|home\.arpa|onion)$/.test(
          host,
        )))
  )
    throw deny("TARGET_HOST_PROHIBITED");
  if (!isIP(host)) url.hostname = host;
  let addresses: { address: string }[];
  try {
    addresses = isIP(host)
      ? [{ address: host }]
      : resolve
        ? await resolve(host)
        : [];
  } catch {
    throw deny("TARGET_DNS_FAILED");
  }
  if (!addresses.length && resolve) throw deny("TARGET_DNS_FAILED");
  // One prohibited answer among public ones is enough to refuse.
  if (!addresses.every((v) => publicAddress(v.address)))
    throw deny("TARGET_ADDRESS_PROHIBITED");
  url.hash = "";
  return { url, host, addresses: addresses.map((v) => v.address) };
}
export async function canonicalize(
  raw: string,
  resolve: Resolve = systemResolve,
) {
  return (await inspectTarget(raw, resolve)).url.href;
}
export type ScanTarget = {
  url: string;
  origin: string;
  host: string;
  port: number;
  addresses: string[];
};
// Everything that a scan needs to know about its destination, resolved now. The addresses are
// enforced by the firewall in ZAP's network namespace, so later DNS answers have no effect.
export async function scanTarget(
  raw: string,
  demoAddress: () => Promise<string>,
  resolve: Resolve = systemResolve,
): Promise<ScanTarget> {
  if (raw === demoTarget) {
    if (process.env.SENTINELSCAN_DEMO_TARGET !== "juice-shop")
      throw deny("DEMO_SCOPE_DISABLED");
    const address = await demoAddress();
    if (!/^172\.29\.83\.(?:[2-9]|1[0-4])$/.test(address))
      throw deny("DEMO_ADDRESS_UNKNOWN");
    const url = new URL(raw);
    return { url: raw, origin: url.origin, host: "juice-shop", port: 3000, addresses: [address] };
  }
  const { url, host, addresses } = await inspectTarget(raw, resolve);
  if (url.href !== raw) throw deny("TARGET_NOT_CANONICAL");
  // ZAP tests a whole origin, so consent for part of one cannot authorize a scan.
  if (url.pathname !== "/" || url.search) throw deny("TARGET_NOT_ROOT");
  const ipv4 = [...new Set(addresses.filter(isIPv4))].sort();
  if (!ipv4.length || ipv4.length > 16) throw deny("TARGET_IPV4_REQUIRED");
  return {
    url: raw,
    origin: url.origin,
    host,
    port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
    addresses: ipv4,
  };
}
export async function registrationUrl(raw: string) {
  if (raw === demoTarget) return registeredScope(raw);
  return (await inspectTarget(raw, null)).url.href;
}
export function registeredScope(raw: string, resolve?: Resolve) {
  // Exception for the isolated demo container only.
  if (
    process.env.SENTINELSCAN_DEMO_TARGET === "juice-shop" &&
    raw === demoTarget
  ) {
    return Promise.resolve(raw);
  }
  return canonicalize(raw, resolve);
}
