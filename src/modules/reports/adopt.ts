import { readFile, stat } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { validateLocalDatabaseUrl } from "../../config/local.ts";
import { ApiError } from "../../lib/errors.ts";
import { inspectPdf } from "./render.ts";
import { defaultReportDirectory, reportStorage, sha256 } from "./storage.ts";

// Operator command for a PDF that was printed before the API stored reports. It copies the file
// into report storage and records it as an older template. The original file is only read.
// npm.cmd run report:adopt -- <assessment id> <pdf file> <sha256>
async function adopt() {
  const [id, file, expected] = z
    .tuple([z.uuid(), z.string().min(1), z.string().regex(/^[a-f0-9]{64}$/)])
    .parse(process.argv.slice(2));
  validateLocalDatabaseUrl(process.env.DATABASE_URL);
  const pdf = await readFile(file);
  if (!inspectPdf(pdf)) throw new ApiError(422, "NOT_A_PDF");
  if (sha256(pdf) !== expected) throw new ApiError(409, "CHECKSUM_MISMATCH");
  const { mtime } = await stat(file);
  const db = new PrismaClient();
  try {
    const assessment = await db.assessment.findUnique({ where: { id }, select: { status: true } });
    if (assessment?.status !== "COMPLETED") throw new ApiError(409, "ASSESSMENT_NOT_COMPLETED");
    if (await db.report.findFirst({ where: { assessmentId: id, contentDigest: expected } })) {
      console.log("Already recorded.");
      return;
    }
    const storage = reportStorage(defaultReportDirectory());
    const stored = await storage.write(pdf);
    try {
      await db.report.create({
        data: {
          id: stored.id,
          assessmentId: id,
          generatedAt: mtime,
          format: "application/pdf",
          templateVersion: "adopted",
          contentDigest: stored.digest,
          storageKey: stored.key,
        },
      });
    } catch (error) {
      await storage.discard(stored.key);
      throw error;
    }
    console.log("Recorded report", stored.id, "for assessment", id);
  } finally {
    await db.$disconnect();
  }
}
adopt().catch((error) => {
  console.error(error instanceof ApiError ? error.message : "REPORT_ADOPTION_FAILED");
  process.exitCode = 1;
});
