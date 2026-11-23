import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../../lib/errors.ts";
import {
  registeredScope,
  type Resolve,
} from "../../lib/security/destination.ts";
import { z } from "zod";
import { type confirmations, version } from "./consent.ts";
const assessmentSchema = z.strictObject({
  targetId: z.uuid(),
  url: z.string().max(2048),
  authorized: z.literal(true),
  authorizationTextVersion: z.literal(version),
  confirmationToken: z.uuid(),
});
export function registerAssessments(
  app: FastifyInstance,
  db: PrismaClient,
  consent: ReturnType<typeof confirmations>,
  resolve?: Resolve,
) {
  app.post("/api/v1/assessments", async (req, reply) => {
    const input = assessmentSchema.parse(req.body);
    consent.consume(input.confirmationToken, input.targetId, input.url);
    if ((await registeredScope(input.url, resolve)) !== input.url)
      throw new ApiError(409, "TARGET_CHANGED");
    const row = await db.$transaction(async (tx) => {
      const targets = await tx.$queryRaw<
        { canonical_url: string }[]
      >`SELECT canonical_url FROM targets WHERE id=${input.targetId}::uuid AND archived_at IS NULL FOR UPDATE`;
      if (!targets.length) throw new ApiError(404, "TARGET_NOT_FOUND");
      if (targets[0].canonical_url !== input.url)
        throw new ApiError(409, "TARGET_CHANGED");
      return tx.assessment.create({
        data: {
          targetId: input.targetId,
          targetUrlSnapshot: input.url,
          authorizationTextVersion: version,
          authorizationConfirmedAt: new Date(),
          source: "LOCAL",
          status: "PENDING",
        },
      });
    });
    return reply.code(201).send(row);
  });
}
