import { inventoryOutcome } from "./outcome.ts";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { z } from "zod";
import { ApiError } from "../../lib/errors.ts";
import { alertSchema, normalize, pageSchema } from "./findings.ts";

const limit = 1024 * 1024;
const progressSchema = z
  .union([z.string().regex(/^\d{1,3}$/), z.number()])
  .transform(Number)
  .pipe(z.number().int().min(0).max(100));
const malformed = () => new ApiError(502, "ZAP_MALFORMED_RESPONSE");
const oversized = () => new ApiError(502, "ZAP_RESPONSE_TOO_LARGE");
const denied = () => new ApiError(502, "ZAP_INVALID_CREDENTIALS");
const unavailable = () => new ApiError(503, "ZAP_UNAVAILABLE");
async function readJson(response: Response) {
  if (Number(response.headers.get("content-length")) > limit) throw oversized();
  if (!response.body) throw malformed();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw oversized();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  } catch {
    throw malformed();
  }
}
export function createZapClient(
  key?: string,
  timeoutMs = 5000,
  transport = fetch,
) {
  z.number().int().min(1).max(60000).parse(timeoutMs);
  async function view<T>(
    path: string,
    schema: z.ZodType<T>,
    params?: Record<string, string>,
  ): Promise<T> {
    if (!key?.trim()) throw new ApiError(503, "ZAP_MISSING_CREDENTIALS");
    const url = new URL("/JSON/" + path + "/", "http://127.0.0.1:8090");
    url.search = new URLSearchParams(params).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport(url, {
        redirect: "manual",
        headers: { "X-ZAP-API-Key": key },
        signal: controller.signal,
      });
      if ([401, 403].includes(response.status)) throw denied();
      if (response.status === 503) throw unavailable();
      if (response.status === 504) throw new ApiError(504, "ZAP_TIMEOUT");
      if (!response.ok && response.status !== 400)
        throw new ApiError(502, "ZAP_PROVIDER_ERROR");
      const body = await readJson(response);
      const error = z.object({ code: z.string() }).safeParse(body);
      if (
        error.success &&
        ["bad_api_key", "badApiKey"].includes(error.data.code)
      )
        throw denied();
      if (error.success || !response.ok)
        throw new ApiError(502, "ZAP_PROVIDER_ERROR");
      const parsed = schema.safeParse(body);
      if (!parsed.success || JSON.stringify(parsed.data).includes(key))
        throw malformed();
      return parsed.data;
    } catch (err) {
      if (controller.signal.aborted) throw new ApiError(504, "ZAP_TIMEOUT");
      if (err instanceof ApiError) throw err;
      throw unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  async function attributedIds(scanId: string) {
    z.string()
      .regex(/^\d{1,12}$/)
      .parse(scanId);
    const id = z
      .union([
        z.string().regex(/^\d{1,12}$/),
        z.number().int().nonnegative().max(999999999999),
      ])
      .transform(String);
    const response = await view(
      "ascan/view/alertsIds",
      z.object({ alertsIds: z.array(id).max(4096) }),
      { scanId },
    );
    if (new Set(response.alertsIds).size !== response.alertsIds.length)
      throw malformed();
    return response.alertsIds;
  }
  return {
    async sessionLocation() {
      const result = await view(
        "core/view/sessionLocation",
        z.object({ sessionLocation: z.string().trim().min(1).max(2048) }),
      );
      return result.sessionLocation;
    },
    async inspectRuns(kind: "spider" | "active") {
      const component = kind === "spider" ? "spider" : "ascan";
      const response = await view(
        component + "/view/scans",
        z.object({
          scans: z.array(z.record(z.string(), z.unknown())),
        }),
      );
      return response.scans.map((row) => {
        const id = z.coerce
          .string()
          .regex(/^\d{1,12}$/)
          .safeParse(row.id ?? row.scanId);
        const state = z
          .enum([
            "RUNNING",
            "FINISHED",
            "COMPLETED",
            "FAILED",
            "STOPPED",
            "CANCELLED",
            "CANCELED",
            "PAUSED",
            "NOT_STARTED",
          ])
          .safeParse(String(row.state ?? "").toUpperCase());
        let reportedOrigin: string | null = null;
        if (typeof row.url === "string" && URL.canParse(row.url)) {
          const url = new URL(row.url);
          if (["http:", "https:"].includes(url.protocol))
            reportedOrigin = url.origin;
        }
        return {
          id: id.success ? id.data : null,
          progress:
            row.progress == null
              ? null
              : (progressSchema.safeParse(row.progress).data ?? null),
          reportedOrigin,
          outcome: inventoryOutcome(row.state),
          exactDemoUrl:
            row.url === "http://juice-shop:3000/" ||
            row.url === "http://juice-shop:3000",
          state: state.success ? state.data : null,
          fields: Object.keys(row)
            .filter((field) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field))
            .sort(),
        };
      });
    },
    async inspectAlertIds(scanId: string) {
      return (await attributedIds(scanId)).length;
    },
    // Request history can corroborate destination independently of alert count.
    // Summarize locally so URLs, query strings, headers and bodies stay private.
    async inspectDemoScope(kind: "spider" | "active", scanId: string) {
      z.string()
        .regex(/^\d{1,12}$/)
        .parse(scanId);
      const target = "http://juice-shop:3000";
      function classify(urls: string[]) {
        if (!urls.length) return { evidence: "EMPTY", count: 0 };
        let unknown = false;
        for (const raw of urls) {
          if (!URL.canParse(raw)) {
            unknown = true;
            continue;
          }
          const url = new URL(raw);
          if (url.origin !== target || url.username || url.password)
            return { evidence: "OUT_OF_SCOPE", count: urls.length };
        }
        return {
          evidence: unknown ? "UNKNOWN" : "OBSERVED_TARGET_ORIGIN",
          count: urls.length,
        };
      }
      if (kind === "spider") {
        const { results } = await view(
          "spider/view/results",
          z.object({ results: z.array(z.string()).max(16000) }),
          { scanId },
        );
        return classify(results);
      }
      const messageIds = async () =>
        (
          await view(
            "ascan/view/messagesIds",
            z.object({
              messagesIds: z
                .array(
                  z
                    .union([z.string(), z.number().int()])
                    .transform(String)
                    .pipe(z.string().regex(/^\d{1,12}$/)),
                )
                .max(16000),
            }),
            { scanId },
          )
        ).messagesIds;
      const ids = await messageIds();
      if (new Set(ids).size !== ids.length) throw malformed();
      // Bound review work. A partial sample must never establish scope.
      if (ids.length > 256)
        return { evidence: "REVIEW_LIMIT", count: ids.length };
      const urls: string[] = [];
      const deadline = Date.now() + 30000;
      for (const id of ids) {
        if (Date.now() > deadline) throw new ApiError(504, "ZAP_TIMEOUT");
        const { message } = await view(
          "core/view/message",
          z.object({
            message: z.object({
              id: z.union([z.string(), z.number().int()]).transform(String),
              requestHeader: z.string().max(65536),
            }),
          }),
          { id },
        );
        if (message.id !== id) throw malformed();
        // Relative request-targets lack a verified scheme. Leave scope unknown.
        const lines = message.requestHeader.split(/\r?\n/);
        const uri = /^\S+ (\S+) HTTP\/\d(?:\.\d)?$/.exec(lines[0])?.[1] ?? "";
        const hosts = lines
          .filter((line) => /^host:/i.test(line))
          .map((line) => line.slice(5).trim().toLowerCase());
        if (hosts.some((host) => host !== "juice-shop:3000"))
          return { evidence: "OUT_OF_SCOPE", count: ids.length };
        urls.push(hosts.length > 1 ? "" : uri);
      }
      const after = new Set(await messageIds());
      if (after.size !== ids.length || ids.some((id) => !after.has(id)))
        throw new ApiError(409, "OBSERVATION_CHANGED");
      return classify(urls);
    },
    async readAttributedFindings(scanId: string, authorizedUrl: string) {
      const target = new URL(authorizedUrl);
      const deadline = Date.now() + 60_000;
      const ids = await attributedIds(scanId);
      const findings = [];
      let bytes = 0;
      for (const id of ids) {
        if (Date.now() >= deadline) throw new ApiError(504, "ZAP_TIMEOUT");
        const response = await view(
          "alert/view/alert",
          z.object({
            alert: alertSchema.and(
              z.object({
                id: z.union([z.string(), z.number().int()]).transform(String),
              }),
            ),
          }),
          { id },
        );
        if (response.alert.id !== id) throw malformed();
        const finding = normalize(response.alert);
        if (
          !finding.url ||
          !finding.description ||
          !finding.confidence ||
          !finding.normalizedSeverity
        )
          throw malformed();
        const url = new URL(finding.url);
        if (
          url.origin !== target.origin ||
          (url.pathname !== target.pathname &&
            !url.pathname.startsWith(target.pathname.replace(/\/$/, "") + "/"))
        )
          throw new ApiError(422, "FINDING_OUTSIDE_TARGET");
        bytes += Buffer.byteLength(JSON.stringify(finding));
        if (bytes > 4 * limit) throw oversized();
        findings.push(finding);
      }
      const finalIds = await attributedIds(scanId);
      const initial = new Set(ids);
      if (
        finalIds.length !== ids.length ||
        !finalIds.every((id) => initial.has(id))
      )
        throw new ApiError(409, "ZAP_ALERT_SET_CHANGED");
      return findings;
    },
    async version() {
      return (
        await view(
          "core/view/version",
          z.object({
            version: z
              .string()
              .regex(/^\d+\.\d+\.\d+[\w.-]*$/)
              .max(64),
          }),
        )
      ).version;
    },
    async alerts(start = 0, count = 50) {
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(start);
      z.number().int().min(1).max(100).parse(count);
      const page = await view("alert/view/alerts", pageSchema, {
        start: String(start),
        count: String(count),
      });
      if (page.alerts.length > count) throw malformed();
      return page.alerts.map(normalize);
    },
    async progress(kind: "spider" | "active", scanId: string) {
      z.string()
        .regex(/^\d{1,12}$/)
        .parse(scanId);
      const page = await view(
        (kind === "spider" ? "spider" : "ascan") + "/view/status",
        z.object({
          status: progressSchema,
        }),
        { scanId },
      );
      return page.status;
    },
  };
}
export function configuredZapClient() {
  let key = process.env.ZAP_API_KEY;
  if (key === undefined) {
    try {
      key = parseEnv(
        readFileSync(
          new URL(
            "../../../../sentinelscan-infrastructure/.env",
            import.meta.url,
          ),
          "utf8",
        ),
      ).ZAP_API_KEY;
    } catch {
      /* Missing configuration is reported by the provider routes. */
    }
  }
  return createZapClient(key, Number(process.env.ZAP_TIMEOUT_MS ?? 5000));
}
export type ZapClient = ReturnType<typeof createZapClient>;
