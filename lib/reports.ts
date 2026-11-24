import { z } from "zod";

export const reportState = z
  .object({
    assessmentId: z.uuid(),
    assessmentStatus: z.string(),
    canGenerate: z.boolean(),
    reports: z.array(
      z.object({
        id: z.uuid(),
        generatedAt: z.iso.datetime(),
        filename: z.string().regex(/^sentinelscan-report-[0-9a-f-]{36}\.pdf$/),
        contentType: z.literal("application/pdf"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        available: z.boolean(),
        size: z.number().int().positive().nullable(),
        pages: z.number().int().positive().nullable(),
        outdated: z.boolean(),
      }),
    ),
  })
  .refine((state) => state.canGenerate === (state.assessmentStatus === "COMPLETED"))
  .refine((state) => state.canGenerate || state.reports.length === 0)
  .refine((state) => state.reports.every((row) => row.filename.includes(state.assessmentId)));
export type ReportState = z.infer<typeof reportState>;
export const reportsFor = (id: string) =>
  reportState.refine((state) => state.assessmentId === id);
export function unavailableReason(status: string) {
  return (
    {
      FAILED: "This assessment failed, so there are no verified results to report.",
      CANCELLED: "Tracking was cancelled, so there are no verified results to report.",
      OUTCOME_UNKNOWN: "The scans ended, but their outcome is not verified. A report needs verified results.",
    }[status] ?? "A report becomes available once the assessment is completed with verified results."
  );
}
