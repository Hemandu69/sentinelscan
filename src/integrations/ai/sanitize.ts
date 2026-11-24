import type { AnalysisInput } from "./schema.ts";

const rules: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g, "[redacted key]"],
  [/\b(?:authorization|proxy-authorization|cookie|set-cookie|x-[\w-]*(?:key|token)[\w-]*)\s*[:=][^\r\n]*/gi, "[redacted header]"],
  [/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[redacted credential]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, "[redacted token]"],
  [/\b(?:sk|pk|ghp|gho|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{12,}/g, "[redacted token]"],
  [/\b(?:pass(?:word|wd)?|pwd|secret|token|api[-_ ]?key|session(?:id)?|jsessionid|phpsessid)\b\s*["']?\s*[:=]\s*["']?[^\s"'&;,]+/gi, "[redacted secret]"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/gi, "[redacted credential]@"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted email]"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "[redacted value]"],
  [/\b[A-Za-z0-9+_-]{48,}={0,2}/g, "[redacted value]"],
];
export function redact(value: string, max: number) {
  let out = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
  for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement);
  return out.slice(0, max);
}
// Query strings, fragments and credentials never leave the API.
export function bareUrl(value: string) {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) return null;
  return redact(url.origin + url.pathname, 500);
}
const optional = (value: string | null, max: number) =>
  value === null ? null : redact(value, max);
export function sanitize(input: AnalysisInput): AnalysisInput {
  const urls = input.affectedUrls.map(bareUrl).filter((url) => url !== null);
  return {
    alertName: redact(input.alertName, 200),
    description: redact(input.description, 4000),
    scannerSeverity: redact(input.scannerSeverity, 40),
    scannerConfidence: redact(input.scannerConfidence, 40),
    ruleId: optional(input.ruleId, 20),
    method: optional(input.method, 20),
    parameter: optional(input.parameter, 200),
    affectedUrls: [...new Set(urls)].sort().slice(0, 50),
    evidence: optional(input.evidence, 1000),
    scannerRemediation: optional(input.scannerRemediation, 2000),
    references: [...new Set(input.references.map(bareUrl).filter((url) => url !== null))].slice(0, 10),
    cweId: input.cweId,
    wascId: input.wascId,
  };
}
