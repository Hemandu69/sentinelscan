import { z } from "zod";

const observation = z.object({
  assessmentId: z.uuid(),
  kind: z.enum(["spider", "active"]),
  scanId: z.string().regex(/^\d{1,12}$/),
  authorizedTarget: z.literal("http://juice-shop:3000/"),
  provider: z.object({
    endpoint: z.literal("http://127.0.0.1:8090"),
    version: z.literal("2.17.0"),
  }),
  assessmentStatus: z.string(),
  observedAt: z.iso.datetime(),
  providerState: z.string().nullable(),
  progress: z.number().int().min(0).max(100),
  reportedOrigin: z.literal("http://juice-shop:3000").nullable(),
  scopeEvidence: z.enum(["ORIGIN_ONLY", "UNAVAILABLE"]),
  associationVerified: z.literal(false),
});
export type RunObservation = z.infer<typeof observation>;
export function readObservation(
  body: unknown,
  assessmentId: string,
  kind: string,
  scanId: string,
) {
  const row = observation.parse(body);
  if (
    row.assessmentId !== assessmentId ||
    row.kind !== kind ||
    row.scanId !== scanId ||
    (row.scopeEvidence === "ORIGIN_ONLY") !== Boolean(row.reportedOrigin)
  ) {
    throw new Error("The response does not match the selected observation.");
  }
  return row;
}
export function continueObserving(state: string | null) {
  return state === "RUNNING" || state === "PAUSED" || state === "NOT_STARTED";
}
