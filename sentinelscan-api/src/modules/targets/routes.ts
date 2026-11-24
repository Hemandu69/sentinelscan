import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ApiError } from "../../lib/errors.ts";
import {
  registeredScope,
  type Resolve,
} from "../../lib/security/destination.ts";
import { z } from "zod";
import type { confirmations } from "../assessments/consent.ts";
const idSchema = z.strictObject({ id: z.uuid() });
const targetSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(160),
  url: z.string().max(2048),
});
export function registerTargets(
  app: FastifyInstance,
  db: PrismaClient,
  consent: ReturnType<typeof confirmations>,
  resolve?: Resolve,
) {
  const base = "/api/v1/targets";
  app.get(base, async () =>
    db.target.findMany({
      where: { archivedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
  );
  app.post(base, async (req, reply) => {
    const { displayName, url } = targetSchema.parse(req.body);
    const canonicalUrl = await registeredScope(url, resolve);
    try {
      const target = await db.target.create({
        data: { displayName, canonicalUrl },
      });
      return reply.code(201).send(target);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ApiError(409, "ACTIVE_TARGET_EXISTS");
      throw error;
    }
  });
  app.get(base + "/:id", async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    const target = await db.target.findFirst({
      where: { id, archivedAt: null },
    });
    if (!target) throw new ApiError(404, "TARGET_NOT_FOUND");
    reply.header("Cache-Control", "no-store");
    return { ...target, confirmation: consent.issue(id, target.canonicalUrl) };
  });
  app.delete(base + "/:id", async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    const { count } = await db.target.updateMany({
      where: { id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (!count) throw new ApiError(404, "TARGET_NOT_FOUND");
    return reply.code(204).send();
  });
}
