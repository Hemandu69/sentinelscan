import { z } from "zod";

const field = z.string().nullish();
const id = z.union([z.string(), z.number().int()]).nullish();
export const alertSchema = z
  .object({
    name: field,
    alert: field,
    pluginId: id,
    risk: field,
    confidence: field,
    url: field,
    method: field,
    param: field,
    evidence: field,
    description: field,
    solution: field,
    reference: field,
    cweid: id,
    wascid: id,
  })
  .refine((alert) => Boolean(alert.name?.trim() || alert.alert?.trim()));
function taxonomy(value: string | number | null | undefined) {
  const number = Number(value);
  return /^\d+$/.test(String(value)) &&
    Number.isSafeInteger(number) &&
    number > 0
    ? number
    : null;
}
function publicUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}
const severities = new Map([
  ["informational", "INFO"],
  ["low", "LOW"],
  ["medium", "MEDIUM"],
  ["high", "HIGH"],
]);
export function normalize(alert: z.infer<typeof alertSchema>) {
  return {
    name: alert.name?.trim() || alert.alert!.trim(),
    sourceRuleId: alert.pluginId == null ? null : String(alert.pluginId),
    sourceSeverity: alert.risk ?? null,
    normalizedSeverity:
      severities.get(alert.risk?.trim().toLowerCase() ?? "") ?? null,
    confidence: alert.confidence ?? null,
    url: publicUrl(alert.url),
    method: alert.method ?? null,
    parameter: alert.param || null,
    redactedEvidence: alert.evidence ? "[redacted]" : null,
    description: alert.description ?? null,
    remediation: alert.solution ?? null,
    references: (alert.reference ?? "")
      .split(/\s+/)
      .map(publicUrl)
      .filter((url) => url !== null),
    cweId: taxonomy(alert.cweid),
    wascId: taxonomy(alert.wascid),
  };
}
