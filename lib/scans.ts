import { z } from "zod";

const scan = z
  .object({
    progress: z.number().int().min(0).max(100).nullable(),
    requests: z.number().int().nonnegative().nullable(),
    alerts: z.number().int().nonnegative().nullable(),
  })
  .nullable();
export const stages = [
  "PREPARING",
  "INITIALIZING",
  "SPIDER_RUNNING",
  "SPIDER_VERIFYING",
  "ACTIVE_RUNNING",
  "COLLECTING_EVIDENCE",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "OUTCOME_UNKNOWN",
] as const;
export type Stage = (typeof stages)[number];
export const scanState = z
  .object({
    assessmentId: z.uuid(),
    status: z.string(),
    tracked: z.boolean(),
    stage: z.enum(stages).nullable(),
    stageAt: z.iso.datetime().nullable(),
    spider: scan,
    active: scan,
    memoryPercent: z.number().nullable(),
    peakMemoryPercent: z.number().nullable(),
    cancelRequested: z.boolean(),
    code: z.string().nullable(),
    reasons: z.array(z.string()),
  })
  .refine((row) => row.tracked === (row.stage !== null));
export type ScanState = z.infer<typeof scanState>;
export const scanPolicy = z.object({
  configuration: z.object({ id: z.string(), name: z.string(), details: z.array(z.string()) }),
});
export const readiness = z
  .object({ ready: z.boolean(), reasons: z.array(z.string()) })
  .refine((row) => row.ready === (row.reasons.length === 0));
export const eligibility = z
  .object({
    url: z.url(),
    state: z.enum(["ELIGIBLE", "VALIDATION_FAILED", "UNAVAILABLE"]),
    reasons: z.array(z.string()),
    addresses: z.array(z.string()),
    safety: z.array(z.string()),
  })
  .refine((row) => (row.state === "ELIGIBLE") === (row.reasons.length === 0));
export type Eligibility = z.infer<typeof eligibility>;
export const eligibilityTitle = {
  ELIGIBLE: "Eligible for scanning.",
  VALIDATION_FAILED: "Target validation failed.",
  UNAVAILABLE: "Scan unavailable.",
} as const;
export const launched = z.object({ assessmentId: z.uuid() });

export const steps: { stage: Stage; label: string; detail: string }[] = [
  { stage: "PREPARING", label: "Preparing the assessment", detail: "Recording your authorization." },
  { stage: "INITIALIZING", label: "Preparing the scanner", detail: "Starting a fresh scanner session." },
  { stage: "SPIDER_RUNNING", label: "Finding pages", detail: "Following links on the authorized website." },
  { stage: "SPIDER_VERIFYING", label: "Checking the page list", detail: "Confirming that discovery finished and stayed on the website." },
  { stage: "ACTIVE_RUNNING", label: "Testing pages", detail: "Sending security tests. This usually takes about five minutes." },
  { stage: "COLLECTING_EVIDENCE", label: "Verifying and importing", detail: "Collecting evidence twice, validating it and importing findings together." },
];
export const isEnded = (stage: Stage | null) =>
  stage !== null && ["COMPLETED", "FAILED", "CANCELLED", "OUTCOME_UNKNOWN"].includes(stage);
// Only numbers reported by the scanner are shown. Anything else is described in words.
export function measured(state: ScanState) {
  const value =
    state.stage === "SPIDER_RUNNING"
      ? state.spider?.progress
      : state.stage === "ACTIVE_RUNNING"
        ? state.active?.progress
        : null;
  return value ?? null;
}
export function stepState(index: number, stage: Stage | null): "done" | "current" | "upcoming" {
  if (stage === "COMPLETED") return "done";
  const at = steps.findIndex((step) => step.stage === stage);
  return at < 0 ? "upcoming" : index < at ? "done" : index === at ? "current" : "upcoming";
}
export const outcomeText: Record<string, string> = {
  COMPLETED: "The scan finished and its results were verified and imported.",
  FAILED: "The scan could not be completed. No results were imported.",
  CANCELLED: "The scan was stopped. No results were imported.",
  OUTCOME_UNKNOWN: "The scan ended, but how it ended is not verified. No results were imported.",
};
const readinessText: Record<string, string> = {
  SCAN_ALREADY_RUNNING: "Another scan is running. Wait for it to finish.",
  DEMO_SCOPE_DISABLED: "The local API was started without the Juice Shop demo setting.",
  RESOURCE_LIMITS_CHANGED: "The scanner's memory settings differ from the approved ones.",
  TARGET_URL_INVALID: "The address is not a valid http:// or https:// address.",
  TARGET_CREDENTIALS: "The address contains a user name or password.",
  TARGET_HOST_PROHIBITED: "The host name is local or internal.",
  TARGET_DNS_FAILED: "The host name could not be resolved.",
  TARGET_ADDRESS_PROHIBITED: "The host name resolves to a private, local or reserved address.",
  TARGET_NOT_CANONICAL: "The stored address is not in its canonical form. Register it again.",
  TARGET_NOT_ROOT: "Only a whole website can be scanned. Register its address without a path.",
  TARGET_IPV4_REQUIRED: "The website has no usable IPv4 address.",
  TARGET_VALIDATION_FAILED: "The address could not be validated.",
  DEMO_ADDRESS_UNKNOWN: "The demo container is not on its expected network address.",
  EGRESS_GUARD_UNAVAILABLE: "The outbound firewall image is missing. Build it as described in the infrastructure README.",
  EGRESS_UNVERIFIED: "The outbound firewall could not be proven.",
  SCAN_EXCLUSIONS_UNVERIFIED: "The scanner did not confirm the safety exclusions.",
  SERVICE_UNHEALTHY: "The scanner or the demo website is not healthy.",
  MEMORY_TOO_HIGH: "The scanner is using too much memory. Restarting ZAP frees it.",
  DOCKER_UNAVAILABLE: "Docker could not be checked. Make sure Docker Desktop is running.",
  ZAP_VERSION_CHANGED: "The scanner version differs from the approved one.",
  SCAN_POLICY_CHANGED: "The scanner's rules or limits differ from the approved configuration.",
  ZAP_UNAVAILABLE: "The scanner could not be reached.",
  CREDENTIAL_IN_LOG: "The scanner log contains its key, so evidence from it cannot be trusted.",
  ZAP_STILL_STARTING: "The scanner is still starting or updating. Try again in a minute.",
  ZAP_LOG_UNAVAILABLE: "The scanner log could not be read.",
  EVIDENCE_STORAGE_UNAVAILABLE: "The evidence table is not available.",
  UNRESOLVED_SCAN_IN_SESSION: "An earlier scan has not been resolved. Open it and check its outcome, or cancel its tracking.",
  DATABASE_OR_SESSION_UNAVAILABLE: "The database or the scanner session could not be checked.",
};
// Known codes become sentences. Evidence codes stay as they are.
export const reasonText = (reason: string) =>
  readinessText[reason] ?? reason.replace(/[^A-Z0-9_]/g, "").slice(0, 60);
export const readinessMessage = (reason: string) =>
  readinessText[reason] ?? "A scanner check did not pass (" + reason.replace(/[^A-Z_]/g, "").slice(0, 40) + ").";

const difference = z.object({ id: z.uuid(), name: z.string(), url: z.string(), severity: z.string() });
const assessmentRef = z.object({ id: z.uuid(), finishedAt: z.iso.datetime(), findings: z.number().int().nonnegative() });
export const comparison = z
  .object({
    earlier: assessmentRef,
    later: assessmentRef,
    comparable: z.boolean(),
    reasons: z.array(z.string()),
    result: z
      .object({
        new: z.array(difference),
        persistent: z.array(difference),
        changed: z.array(difference.extend({ previousSeverity: z.string(), fields: z.array(z.string()) })),
        notSeenAgain: z.array(difference),
        resolved: z.array(difference),
        resolvedSupported: z.boolean(),
      })
      .nullable(),
  })
  .refine((row) => row.comparable === (row.result !== null));
export const comparisonReason = (reason: string) =>
  ({
    EVIDENCE_MISSING: "At least one assessment has no verified run evidence.",
    DIFFERENT_TARGET: "The assessments cover different addresses.",
    DIFFERENT_CONTRACT: "The assessments were verified under different evidence rules.",
    DIFFERENT_RULES: "The assessments ran different scanner rules.",
  })[reason] ?? "The assessments cannot be compared.";
