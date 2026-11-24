import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { normalize } from "../../integrations/zap/findings.ts";
import { ApiError } from "../../lib/errors.ts";

type Finding = ReturnType<typeof normalize>;

// The caller supplies the complete, assessment-specific result set after verifying
// provider completion. A page from the global alerts view is insufficient.
export async function persistFinalFindingsTx(
  tx: Prisma.TransactionClient,
  assessmentId: string,
  findings: readonly Finding[],
) {
  const [assessment] = await tx.$queryRaw<
    { status: string; target_url_snapshot: string }[]
  >`SELECT status, target_url_snapshot FROM assessments WHERE id = ${assessmentId}::uuid FOR UPDATE`;
  if (!assessment) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
  if (assessment.status === "COMPLETED")
    return tx.finding.count({ where: { assessmentId } });
  if (assessment.status !== "PROCESSING_RESULTS")
    throw new ApiError(409, "ASSESSMENT_NOT_PROCESSING");
  const target = new URL(assessment.target_url_snapshot);
  const rows = findings.map((finding) => {
    const { url, sourceSeverity, normalizedSeverity, description, confidence } =
      finding;
    if (
      !url ||
      !sourceSeverity ||
      !normalizedSeverity ||
      description == null ||
      !confidence
    )
      throw new ApiError(422, "FINDING_MISSING_REQUIRED_FIELD");
    const location = new URL(url);
    if (
      location.origin !== target.origin ||
      (location.pathname !== target.pathname &&
        !location.pathname.startsWith(target.pathname.replace(/\/$/, "") + "/"))
    )
      throw new ApiError(422, "FINDING_OUTSIDE_TARGET");
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          finding.sourceRuleId,
          finding.name,
          url,
          finding.method,
          finding.parameter,
        ]),
      )
      .digest("hex");
    return {
      ...finding,
      url,
      sourceSeverity,
      normalizedSeverity,
      description,
      confidence,
      assessmentId,
      fingerprint,
    };
  });
  if (rows.length)
    await tx.finding.createMany({ data: rows, skipDuplicates: true });
  await tx.assessment.update({
    where: { id: assessmentId },
    data: { status: "COMPLETED", finishedAt: new Date(), errorCode: null },
  });
  return tx.finding.count({ where: { assessmentId } });
}
