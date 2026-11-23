const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000";
export type Site = {
  id: string;
  displayName: string;
  canonicalUrl: string;
  createdAt: string;
};
export async function request(
  path: string,
  signal: AbortSignal,
  payload?: unknown,
): Promise<unknown> {
  const root = new URL(base);
  if (
    !["http://127.0.0.1:4000", "http://localhost:4000"].includes(root.origin) ||
    root.username ||
    root.password ||
    root.pathname !== "/" ||
    root.search ||
    root.hash
  )
    throw new Error("Check the local API address.");
  const res = await fetch(root.origin + path, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(path.endsWith("/zap-import") ? 150000 : 8000),
    ]),
    ...(payload === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const messages: Record<string, string> = {
      ZAP_INSTANCE_UNVERIFIABLE:
        "Docker could not confirm the identity of the loopback ZAP service.",
      ZAP_SESSION_CHANGED:
        "The provider session differs from the recorded receipt. Import is blocked.",
      ZAP_SUCCESS_OR_SCOPE_UNVERIFIED:
        "ZAP has not supplied sufficient successful completion and scope evidence for both scans.",
      ZAP_RUN_ALREADY_BOUND:
        "This run or assessment slot already has a different binding.",
      SPIDER_RECEIPT_REQUIRED:
        "Save the Spider receipt from the same session first.",
      ZAP_RUN_NOT_FOUND:
        "This run is absent from the current provider inventory.",
      ZAP_RUN_OUTSIDE_TARGET: "The provider reported a different target.",
      ZAP_SCOPE_NOT_EXACT:
        "The provider reported a different target path from the authorized website.",
      ASSESSMENT_INELIGIBLE:
        "This assessment's current state prevents that operation. Reload its latest status.",
      BOTH_RUN_RECEIPTS_REQUIRED:
        "Record both the Spider and active run receipts before importing findings.",
      IMPORT_BUSY:
        "Another import is in progress. Wait for it to finish before retrying.",
      OBSERVATION_CHANGED:
        "Another request updated this record. Reload the assessment.",
      ZAP_ALERT_SET_CHANGED:
        "The attributed alert list changed during retrieval. Retry after the results settle.",
      TARGET_NOT_FOUND: "This website is unavailable or has been archived.",
      NEW_CONFIRMATION_REQUIRED:
        "Your authorization expired or was already used. Review the website again.",
      TARGET_CHANGED:
        "The target changed. Review the current website before confirming.",
      ACTIVE_TARGET_EXISTS: "This website is already registered.",
      DESTINATION_PROHIBITED:
        "Use a website address permitted by the local target policy.",
      INVALID_REQUEST: "Check the website name and URL.",
    };
    throw new Error(
      messages[body?.error] ||
        "The local service could not complete this request.",
    );
  }
  return res.json();
}
export function readSites(body: unknown): Site[] {
  if (
    !Array.isArray(body) ||
    !body.every(
      (s) =>
        s &&
        typeof s.id === "string" &&
        typeof s.displayName === "string" &&
        typeof s.canonicalUrl === "string" &&
        /^https?:\/\//.test(s.canonicalUrl) &&
        typeof s.createdAt === "string" &&
        Number.isFinite(Date.parse(s.createdAt)),
    )
  )
    throw new Error("Invalid website list.");
  return body;
}
export function serviceReady(path: string, body: unknown) {
  if (!body || typeof body !== "object") return false;
  return path === "/health/zap"
    ? "available" in body &&
        body.available === true &&
        "version" in body &&
        typeof body.version === "string" &&
        !!body.version
    : "status" in body && body.status === "ok";
}
export type WebsiteDetail = Site & {
  confirmation: {
    token: string;
    wording: string;
    version: string;
    url: string;
    expiresAt: string;
  };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function fetchWebsite(
  id: string,
  signal: AbortSignal,
): Promise<WebsiteDetail> {
  if (!uuid.test(id)) throw new Error("Invalid website ID.");
  const value = await request("/api/v1/targets/" + id, signal);
  const site = readSites([value])[0];
  const confirmation =
    value && typeof value === "object" && "confirmation" in value
      ? value.confirmation
      : null;
  if (
    site.id !== id ||
    !confirmation ||
    typeof confirmation !== "object" ||
    !("url" in confirmation) ||
    confirmation.url !== site.canonicalUrl ||
    !("token" in confirmation) ||
    typeof confirmation.token !== "string" ||
    !uuid.test(confirmation.token) ||
    !("version" in confirmation) ||
    typeof confirmation.version !== "string" ||
    !confirmation.version ||
    !("wording" in confirmation) ||
    typeof confirmation.wording !== "string" ||
    !confirmation.wording.trim() ||
    !("expiresAt" in confirmation) ||
    typeof confirmation.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(confirmation.expiresAt))
  ) {
    throw new Error("The website authorization details could not be verified.");
  }
  return {
    ...site,
    confirmation: {
      url: confirmation.url,
      token: confirmation.token,
      version: confirmation.version,
      wording: confirmation.wording,
      expiresAt: confirmation.expiresAt,
    },
  };
}
export async function createAssessment(
  site: WebsiteDetail,
  authorized: boolean,
  signal: AbortSignal,
) {
  const consent = site.confirmation;
  if (
    !authorized ||
    consent.url !== site.canonicalUrl ||
    Date.parse(consent.expiresAt) <= Date.now()
  )
    throw new Error("Review the website and confirm a fresh authorization.");
  const result = await request("/api/v1/assessments", signal, {
    targetId: site.id,
    url: site.canonicalUrl,
    authorized: true,
    authorizationTextVersion: consent.version,
    confirmationToken: consent.token,
  });
  if (
    !result ||
    typeof result !== "object" ||
    !("id" in result) ||
    typeof result.id !== "string" ||
    !uuid.test(result.id) ||
    !("targetId" in result) ||
    result.targetId !== site.id ||
    !("targetUrlSnapshot" in result) ||
    result.targetUrlSnapshot !== site.canonicalUrl ||
    !("status" in result) ||
    result.status !== "PENDING"
  )
    throw new Error(
      "The creation receipt could not be verified. The request may have been saved.",
    );
  return { id: result.id, status: result.status };
}
