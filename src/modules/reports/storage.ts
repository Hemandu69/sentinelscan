import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../lib/errors.ts";
import { inspectPdf } from "./render.ts";

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export function defaultReportDirectory(env: NodeJS.ProcessEnv = process.env) {
  return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "SentinelScan", "reports") : null;
}
// Names are generated here and checked again on every use. Nothing from a request becomes a path.
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;
export function reportStorage(directory: string | null) {
  function locate(key: string) {
    if (!directory || !keyPattern.test(key)) throw new ApiError(500, "REPORT_STORAGE_FAILED");
    return path.join(directory, key);
  }
  return {
    async read(key: string, digest: string) {
      let pdf: Buffer;
      try {
        pdf = await readFile(locate(key));
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(404, "REPORT_FILE_MISSING");
      }
      const details = inspectPdf(pdf);
      if (!details || sha256(pdf) !== digest) throw new ApiError(409, "REPORT_CORRUPT");
      return { pdf, ...details };
    },
    // A new name every time, and the final name appears only once the file is complete.
    async write(pdf: Buffer) {
      const id = randomUUID(),
        key = id + ".pdf",
        target = locate(key),
        partial = target + ".partial";
      try {
        await mkdir(directory!, { recursive: true });
        const file = await open(partial, "wx");
        try {
          await file.writeFile(pdf);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(partial, target);
      } catch {
        await rm(partial, { force: true }).catch(() => {});
        throw new ApiError(500, "REPORT_STORAGE_FAILED");
      }
      return { id, key, digest: sha256(pdf) };
    },
    async discard(key: string) {
      await rm(locate(key), { force: true }).catch(() => {});
    },
  };
}
export type ReportStorage = ReturnType<typeof reportStorage>;
