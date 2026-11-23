import { z } from "zod";
export const settingsSchema = z.object({
  API_HOST_HEADER: z
    .enum(["localhost:4000", "127.0.0.1:4000"])
    .default("127.0.0.1:4000"),
  WEB_ORIGIN: z
    .enum(["http://localhost:3000", "http://127.0.0.1:3000"])
    .default("http://127.0.0.1:3000"),
});
export type Settings = z.infer<typeof settingsSchema>;

export function validateLocalDatabaseUrl(value: string | undefined) {
  let database: URL;
  try {
    database = new URL(value ?? "");
  } catch {
    throw new Error("Invalid local database configuration");
  }
  if (
    database.protocol !== "postgresql:" ||
    database.hostname !== "127.0.0.1" ||
    database.port !== "5432" ||
    database.pathname !== "/sentinelscan" ||
    database.search !== "?schema=sentinelscan" ||
    database.hash
  )
    throw new Error("Invalid local database configuration");
}
