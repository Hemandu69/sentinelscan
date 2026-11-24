import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { ZapClient } from "../../integrations/zap/client.ts";
import { ApiError } from "../../lib/errors.ts";
import { demoTarget as demo, registeredScope } from "../../lib/security/destination.ts";
import { acceptedVersions } from "./consent.ts";

const params = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["spider", "active"]),
  scanId: z.string().regex(/^\d{1,12}$/),
});

export function registerObservation(
  app: FastifyInstance,
  db: PrismaClient,
  zap: ZapClient,
) {
  app.get(
    "/api/v1/assessments/:id/zap-observations/:kind/:scanId",
    async (req, reply) => {
      const { id, kind, scanId } = params.parse(req.params);
      const assessment = await db.assessment.findUnique({
        where: { id },
        select: {
          status: true,
          targetUrlSnapshot: true,
          authorizationConfirmedAt: true,
          authorizationTextVersion: true,
          target: { select: { archivedAt: true, canonicalUrl: true } },
        },
      });
      if (!assessment) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
      if (
        !assessment.authorizationConfirmedAt ||
        !acceptedVersions.includes(assessment.authorizationTextVersion) ||
        assessment.target.archivedAt ||
        assessment.target.canonicalUrl !== demo ||
        assessment.targetUrlSnapshot !== demo
      )
        throw new ApiError(403, "ASSESSMENT_SCOPE_NOT_AUTHORIZED");
      await registeredScope(demo);
      const version = await zap.version();
      if (version !== "2.17.0")
        throw new ApiError(409, "UNVERIFIED_PROVIDER_VERSION");
      const rows = (await zap.inspectRuns(kind)).filter(
        (row) => row.id === scanId,
      );
      if (!rows.length) throw new ApiError(404, "ZAP_RUN_NOT_FOUND");
      if (rows.length !== 1) throw new ApiError(409, "ZAP_RUN_AMBIGUOUS");
      const [row] = rows;
      if (row.reportedOrigin && row.reportedOrigin !== new URL(demo).origin)
        throw new ApiError(409, "ZAP_RUN_OUTSIDE_TARGET");
      // Use the listing snapshot when available. Separate provider reads are only observations.
      const progress = row.progress ?? (await zap.progress(kind, scanId));
      return reply.header("Cache-Control", "no-store").send({
        assessmentId: id,
        assessmentStatus: assessment.status,
        authorizedTarget: demo,
        provider: { endpoint: "http://127.0.0.1:8090", version },
        observedAt: new Date().toISOString(),
        kind,
        scanId,
        progress,
        providerState: row.state,
        reportedOrigin: row.reportedOrigin,
        scopeEvidence: row.reportedOrigin ? "ORIGIN_ONLY" : "UNAVAILABLE",
        associationVerified: false,
      });
    },
  );
}
