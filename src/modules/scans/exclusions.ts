import { demoTarget } from "../../lib/security/destination.ts";

// Fixed safety exclusions. The browser cannot add, change or remove any of them.
// A word counts only as a whole part of the path or query, in any case.
const part = (words: string) => `(?i)^https?://[^/]+/(?:.*[^a-z0-9])?(?:${words})(?:[^a-z0-9].*)?$`;
export const groups = [
  { name: "sign-out", pattern: part("log[-_]?(?:out|off)|sign[-_]?(?:out|off)") },
  {
    name: "deleting, resetting and cancelling",
    pattern: part("delete|remove|destroy|drop|purge|wipe|erase|reset|deactivate|disable|cancel|unsubscribe"),
  },
  {
    name: "payment and orders",
    pattern: part("pay|payments?|checkout|billing|purchase|buy|orders?|refunds?|transfers?|donate|invoices?|subscribe"),
  },
  {
    name: "administration, publishing and messages",
    pattern: part("admin|wp-admin|administrator|backups?|restore|deploy|publish|import|export|invite|send|contact|feedback|newsletter"),
  },
] as const;
// The isolated demo keeps the configuration that its evidence was verified with.
export function safety(target: string) {
  const demo = target === demoTarget;
  return {
    exclusions: demo ? [] : groups.map((group) => group.pattern),
    postForms: demo,
    description: demo
      ? []
      : [
          ...groups.map((group) => `Addresses for ${group.name} are not requested.`),
          "Forms that submit data are not filled in while pages are discovered.",
        ],
  };
}
