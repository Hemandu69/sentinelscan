import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { confirmations, version } from "../src/modules/assessments/consent.ts";
import { registerAssessments } from "../src/modules/assessments/routes.ts";
import { ApiError } from "../src/lib/errors.ts";

test.each([
  ["archived target", [], "TARGET_NOT_FOUND"],
  [
    "changed URL",
    [{ canonical_url: "https://example.org/other" }],
    "TARGET_CHANGED",
  ],
])(
  "consent issued before %s cannot create an assessment",
  async (_case, rows, code) => {
    const id = "b113e0b9-c57f-43a4-86a7-51fe94507c96",
      url = "https://example.org/";
    const consent = confirmations(),
      create = vi.fn();
    const db = {
      $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
        work({
          $queryRaw: async (query: TemplateStringsArray) => {
            expect(query.join("?")).toMatch(/archived_at IS NULL FOR UPDATE/);
            return rows;
          },
          assessment: { create },
        }),
    };
    const app = Fastify();
    app.setErrorHandler((err, _req, res) =>
      res
        .code(err instanceof ApiError ? err.status : 500)
        .send({ error: (err as Error).message }),
    );
    registerAssessments(
      app,
      db as unknown as PrismaClient,
      consent,
      async () => [{ address: "93.184.216.34" }],
    );
    try {
      const token = consent.issue(id, url).token;
      const submit = () =>
        app.inject({
          method: "POST",
          url: "/api/v1/assessments",
          payload: {
            targetId: id,
            url,
            authorized: true,
            authorizationTextVersion: version,
            confirmationToken: token,
          },
        });
      expect((await submit()).json().error).toBe(code);
      expect((await submit()).json().error).toBe("NEW_CONFIRMATION_REQUIRED");
      expect(create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  },
);
