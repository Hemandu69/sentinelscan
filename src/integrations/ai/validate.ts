import { analysisSchema, priorities, type Analysis, type AnalysisInput } from "./schema.ts";

export class InvalidAnalysis extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
// AI priority may not exceed what the scanner severity supports.
const ceiling: Record<string, (typeof priorities)[number]> = {
  INFO: "LOW",
  LOW: "MEDIUM",
  MEDIUM: "HIGH",
  HIGH: "URGENT",
  CRITICAL: "URGENT",
};

export function validateAnalysis(
  raw: string,
  input: AnalysisInput,
  severity: string,
): Analysis {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new InvalidAnalysis("INVALID_JSON");
  }
  const parsed = analysisSchema.safeParse(body);
  if (!parsed.success) throw new InvalidAnalysis("INVALID_SHAPE");
  // No technology is ever supplied, so any example would be a guess.
  const analysis: Analysis = { ...parsed.data, exampleCode: null };
  const limit = ceiling[severity] ?? "LOW";
  if (priorities.indexOf(analysis.practicalPriority) > priorities.indexOf(limit))
    throw new InvalidAnalysis("PRIORITY_EXCEEDS_SEVERITY");

  const strings = Object.values(analysis).flatMap((value) =>
    typeof value === "string" ? [value] : Array.isArray(value) ? value : [],
  );
  const all = strings.join("\n");
  if (/<\s*\/?\s*[a-z!][^>]*>/i.test(all)) throw new InvalidAnalysis("MARKUP");
  const allowedUrls = new Set([...input.affectedUrls, ...input.references]);
  const trimmed = (value: string) => value.replace(/[).,;:'"\]}]+$/, "");
  for (const match of all.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi))
    if (!allowedUrls.has(trimmed(match[0]))) throw new InvalidAnalysis("UNKNOWN_URL");
  // A path that starts a word is a claim about an endpoint.
  const allowedPaths = new Set(
    input.affectedUrls.flatMap((url) =>
      URL.canParse(url) ? [new URL(url).pathname] : [],
    ),
  );
  for (const match of all.matchAll(/(?:^|[\s("'`])(\/[A-Za-z0-9][^\s"'`)<>]*)/gm))
    if (!allowedPaths.has(trimmed(match[1]))) throw new InvalidAnalysis("UNKNOWN_ENDPOINT");
  const supplied = JSON.stringify(input).toUpperCase();
  for (const match of all.matchAll(/\bCVE-\d{4}-\d{3,}\b/gi))
    if (!supplied.includes(match[0].toUpperCase())) throw new InvalidAnalysis("UNKNOWN_CVE");
  for (const match of all.matchAll(/\bCWE-(\d+)\b/gi))
    if (Number(match[1]) !== input.cweId) throw new InvalidAnalysis("UNKNOWN_CWE");
  if (
    /\b(?:has|have|was|were)\s+(?:been\s+)?(?:now\s+)?(?:fixed|patched|remediated|resolved)\b|\bfix (?:is|was) (?:applied|verified|confirmed)\b/i.test(all)
  )
    throw new InvalidAnalysis("CLAIMS_FIX");
  return analysis;
}
