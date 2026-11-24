import { expect, test, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.ts";
import { normalize } from "../src/integrations/zap/findings.ts";
import { createZapClient } from "../src/integrations/zap/client.ts";
const key = "fixture-secret";
const reply = (body: unknown) =>
  createZapClient(key, 1000, async () => Response.json(body));
test("authenticated version request uses the local view and secret header", async () => {
  const client = createZapClient(key, 1000, async (url, options) => {
    expect(String(url)).toBe("http://127.0.0.1:8090/JSON/core/view/version/");
    expect(new Headers(options?.headers).get("X-ZAP-API-Key")).toBe(key);
    expect(options?.redirect).toBe("manual");
    return Response.json({ version: "2.17.0" });
  });
  expect(await client.version()).toBe("2.17.0");
});
test("missing credentials make no request", async () => {
  const transport = vi.fn();
  await expect(
    createZapClient(undefined, 100, transport).version(),
  ).rejects.toThrow("ZAP_MISSING_CREDENTIALS");
  expect(transport).not.toHaveBeenCalled();
});
test.each([
  [403, "denied", "ZAP_INVALID_CREDENTIALS"],
  [400, '{"code":"bad_api_key"}', "ZAP_INVALID_CREDENTIALS"],
  [503, "offline", "ZAP_UNAVAILABLE"],
  [500, "provider detail", "ZAP_PROVIDER_ERROR"],
  [200, "{", "ZAP_MALFORMED_RESPONSE"],
  [200, '{"unexpected":[]}', "ZAP_MALFORMED_RESPONSE"],
  [302, "", "ZAP_PROVIDER_ERROR"],
] as const)("HTTP %i response %s", async (status, body, code) => {
  await expect(
    createZapClient(
      key,
      500,
      async () => new Response(body, { status }),
    ).version(),
  ).rejects.toThrow(code);
});
test("connection refused", async () => {
  await expect(
    createZapClient(key, 500, async () => {
      throw Object.assign(new Error(), { code: "ECONNREFUSED" });
    }).version(),
  ).rejects.toThrow("ZAP_UNAVAILABLE");
});
test("timeout covers stalled response body", async () => {
  const client = createZapClient(
    key,
    15,
    async (_, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            options?.signal?.addEventListener("abort", () =>
              controller.error(new Error("aborted")),
            );
          },
        }),
      ),
  );
  await expect(client.version()).rejects.toThrow("ZAP_TIMEOUT");
});
test.each([true, false])(
  "bounds alerts with declared size %s",
  async (declared) => {
    const client = createZapClient(
      key,
      1000,
      async () =>
        new Response("a".repeat(1048577), {
          headers: declared ? { "content-length": "1048577" } : {},
        }),
    );
    await expect(client.version()).rejects.toThrow("ZAP_RESPONSE_TOO_LARGE");
  },
);
test("sparse alerts", () => {
  expect(
    normalize({ alert: "Example" }),
  ).toMatchObject({
    sourceSeverity: null,
    normalizedSeverity: null,
    redactedEvidence: null,
    cweId: null,
    url: null,
    references: [],
  });
});
test("normalizes populated alerts, strips credentials and bounds evidence", () => {
  const alert = {
    alert: "Example",
    pluginId: "123",
    risk: "Medium",
    confidence: "Low",
    url: "https://u:p@example.org/path?q=secret",
    method: "GET",
    param: "q",
    evidence: "s".repeat(4000),
    description: "Description",
    solution: "Fix",
    reference: "https://example.org/docs",
    cweid: "42",
    wascid: "-1",
  };
  expect(normalize(alert)).toEqual({
      name: "Example",
      sourceRuleId: "123",
      sourceSeverity: "Medium",
      normalizedSeverity: "MEDIUM",
      confidence: "Low",
      url: "https://example.org/path",
      method: "GET",
      parameter: "q",
      redactedEvidence: "[redacted]",
      description: "Description",
      remediation: "Fix",
      references: ["https://example.org/docs"],
      cweId: 42,
      wascId: null,
    });
});
test("a provider answer that echoes the credential is suppressed", async () => {
  await expect(reply({ scans: [{ id: "0", state: key }] }).inspectRuns("spider")).rejects.toThrow(
    "ZAP_MALFORMED_RESPONSE",
  );
});
test.each(["spider", "active"] as const)("reads %s progress", async (kind) => {
  const client = createZapClient(key, 500, async (url) => {
    expect(String(url)).toBe(
      "http://127.0.0.1:8090/JSON/" +
        (kind === "active" ? "ascan" : "spider") +
        "/view/status/?scanId=7",
    );
    return Response.json({ status: "42" });
  });
  expect(await client.progress(kind, "7")).toBe(42);
  await expect(reply({ status: "101" }).progress(kind, "7")).rejects.toThrow(
    "ZAP_MALFORMED_RESPONSE",
  );
});
test("Fastify surfaces sanitized provider errors", async () => {
  const db = new PrismaClient();
  const app = buildApp(
    db,
    undefined,
    undefined,
    createZapClient(key, 100, async () => new Response(key, { status: 403 })),
  );
  try {
    for (const path of ["/health/zap"]) {
      const res = await app.inject({
        method: "GET",
        url: path,
        headers: { host: "127.0.0.1:4000" },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({
        error: "ZAP_INVALID_CREDENTIALS",
        requestId: expect.any(String),
      });
    }
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
test("compatibility probe reads existing run metadata without printing target values", async () => {
  const paths: string[] = [];
  const client = createZapClient(key, 500, async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname + url.search);
    if (url.pathname.endsWith("/alertsIds/"))
      return Response.json({ alertsIds: ["42"] });
    return Response.json({
      scans: [
        { id: "7", state: "FINISHED", url: "https://fixture.invalid/private" },
      ],
    });
  });
  for (const kind of ["spider", "active"] as const)
    expect(await client.inspectRuns(kind)).toEqual([
      {
        id: "7",
        state: "FINISHED",
        progress: null,
        reportedOrigin: "https://fixture.invalid",
        exactDemoUrl: false,
        requests: null,
        alerts: null,
        outcome: "UNKNOWN",
        fields: ["id", "state", "url"],
      },
    ]);
  expect(await client.inspectAlertIds("7")).toBe(1);
  expect(paths).toEqual([
    "/JSON/spider/view/scans/",
    "/JSON/ascan/view/scans/",
    "/JSON/ascan/view/alertsIds/?scanId=7",
  ]);
});
test.each([
  "valid",
  "wrong id",
  "off scope",
  "partial",
  "duplicate ids",
  "empty",
])("scan-specific alerts: %s", async (scenario) => {
  const urls: string[] = [];
  const client = createZapClient(key, 500, async (input) => {
    const url = new URL(String(input));
    urls.push(url.pathname);
    if (url.pathname === "/JSON/ascan/view/alertsIds/")
      return Response.json({
        alertsIds:
          scenario === "empty"
            ? []
            : scenario === "duplicate ids"
              ? ["1", "1"]
              : ["1", "2"],
      });
    expect(url.pathname).toBe("/JSON/alert/view/alert/");
    const id = url.searchParams.get("id");
    if (scenario === "partial" && id === "2")
      return new Response(null, { status: 503 });
    return Response.json({
      alert: {
        id: scenario === "wrong id" ? "9" : id,
        name: "Fixture",
        risk: "Low",
        confidence: "Medium",
        description: "Test only",
        url:
          scenario === "off scope"
            ? "http://fixture.invalid/outside"
            : "http://fixture.invalid/path/item?private=value#part",
        evidence: "private",
      },
    });
  });
  const result = client.readAttributedFindings(
    "4",
    "http://fixture.invalid/path",
  );
  if (scenario === "valid") {
    const rows = await result;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      url: "http://fixture.invalid/path/item",
      redactedEvidence: "[redacted]",
    });
  } else if (scenario === "empty") {
    expect(await result).toEqual([]);
    expect(urls).toHaveLength(2);
  } else await expect(result).rejects.toThrow();
});
test("import rejects changed attributed IDs after retrieval", async () => {
  let read = 0;
  const client = createZapClient(key, 1000, async () =>
    Response.json({ alertsIds: read++ === 0 ? [] : ["23"] }),
  );
  await expect(
    client.readAttributedFindings("2", "http://juice-shop:3000/"),
  ).rejects.toThrow("ZAP_ALERT_SET_CHANGED");
});
test.each([
  [[], "EMPTY"],
  [["http://juice-shop:3000/a"], "OBSERVED_TARGET_ORIGIN"],
  [["http://juice-shop:3000/a", "https://elsewhere.invalid/"], "OUT_OF_SCOPE"],
  [["/relative"], "UNKNOWN"],
] as [string[], string][])(
  "spider scope from run-specific results %j",
  async (results, evidence) => {
    expect(await reply({ results }).inspectDemoScope("spider", "0")).toEqual({
      count: results.length,
      evidence,
    });
  },
);
test.each([
  [
    "GET http://juice-shop:3000/a HTTP/1.1\r\nHost: juice-shop:3000",
    "OBSERVED_TARGET_ORIGIN",
  ],
  ["GET /a HTTP/1.1\r\nHost: juice-shop:3000", "UNKNOWN"],
  [
    "GET http://juice-shop:3000/a HTTP/1.1\r\nHost: elsewhere.invalid",
    "OUT_OF_SCOPE",
  ],
])(
  "active scope uses attributed messages independently of alerts (%s)",
  async (requestHeader, evidence) => {
    const client = createZapClient(key, 1000, async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messagesIds/")) {
        expect(url.searchParams.get("scanId")).toBe("0");
        return Response.json({ messagesIds: ["41"] });
      }
      expect(url.pathname).toBe("/JSON/core/view/message/");
      expect(url.searchParams.get("id")).toBe("41");
      return Response.json({ message: { id: "41", requestHeader } });
    });
    expect(await client.inspectDemoScope("active", "0")).toEqual({
      count: 1,
      evidence,
    });
  },
);

const inScope: (id: string) => string = () => "GET http://juice-shop:3000/a HTTP/1.1\r\nHost: juice-shop:3000";
function messages(count: number, header = inScope, change = false) {
  const read: string[] = [];
  let lists = 0;
  const client = createZapClient(key, 1000, async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messagesIds/"))
      return Response.json({
        messagesIds: Array.from({ length: count + (change && lists++ ? 1 : 0) }, (_, i) => String(i)),
      });
    const id = url.searchParams.get("id")!;
    read.push(id);
    const requestHeader = header(id);
    return requestHeader ? Response.json({ message: { id, requestHeader } }) : new Response(null, { status: 503 });
  });
  return { client, read };
}
test("active scope reads every attributed message beyond the former limit exactly once", async () => {
  const { client, read } = messages(1500);
  expect(await client.inspectDemoScope("active", "0")).toEqual({ evidence: "OBSERVED_TARGET_ORIGIN", count: 1500 });
  expect(read).toHaveLength(1500);
  expect(new Set(read).size).toBe(1500);
});
test("one message outside the target decides the whole scan", async () => {
  const { client } = messages(400, (id) => `GET http://${id === "399" ? "elsewhere.invalid" : "juice-shop:3000"}/ HTTP/1.1`);
  expect((await client.inspectDemoScope("active", "0")).evidence).toBe("OUT_OF_SCOPE");
});
test("a failed read or a changed list never yields partial scope", async () => {
  await expect(messages(400, (id) => (id === "200" ? "" : "GET http://juice-shop:3000/ HTTP/1.1")).client.inspectDemoScope("active", "0")).rejects.toThrow("ZAP_UNAVAILABLE");
  await expect(messages(5, undefined, true).client.inspectDemoScope("active", "0")).rejects.toThrow("OBSERVATION_CHANGED");
  await expect(messages(16001).client.inspectDemoScope("active", "0")).rejects.toThrow("ZAP_MALFORMED_RESPONSE");
});
const rule = (status: string) => ({ Plugin: ["Rule", "1", "release", status, "5", "1", "0"] });
test("scan progress reports host and rule counts without an outcome", async () => {
  const client = reply({
    scanProgress: [
      "http://juice-shop:3000",
      { HostProcess: ["Complete", "Complete", "Skipped, no OAST", "40%", "Pending", "other"].map(rule) },
    ],
  });
  const result = await client.scanProgress("0");
  expect(result).toEqual({
    hosts: [{ origin: "http://juice-shop:3000", rules: { complete: 2, skipped: 1, running: 1, pending: 1, unknown: 1 }, requests: 6, named: [] }],
  });
  expect(JSON.stringify(result)).not.toMatch(/SUCCEEDED|outcome/);
});
test("malformed scan progress is rejected and unusable hosts stay unknown", async () => {
  for (const scanProgress of [["http://juice-shop:3000"], [{ HostProcess: [] }, "x"], ["h", { HostProcess: [{ Plugin: ["a"] }] }], null])
    await expect(reply({ scanProgress }).scanProgress("0")).rejects.toThrow("ZAP_MALFORMED_RESPONSE");
  expect((await reply({ scanProgress: ["juice-shop", { HostProcess: [] }] }).scanProgress("0")).hosts[0].origin).toBeNull();
});
test("an unsaved provider session is refused with its own code", async () => {
  await expect(reply({ sessionLocation: "" }).sessionLocation()).rejects.toThrow("ZAP_SESSION_NOT_SAVED");
  await expect(reply({}).sessionLocation()).rejects.toThrow("ZAP_MALFORMED_RESPONSE");
  expect(await reply({ sessionLocation: "/zap/a.session" }).sessionLocation()).toBe("/zap/a.session");
});
test("active messages keep only origin, differing hosts and times", async () => {
  const client = createZapClient(key, 1000, async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messagesIds/")) return Response.json({ messagesIds: ["2", "1"] });
    const id = url.searchParams.get("id")!;
    return Response.json({
      message: {
        id,
        timestamp: "1795502186864",
        requestHeader: `GET http://juice-shop:3000/a?secret=1 HTTP/1.1\r\nHost: ${id === "1" ? "169.254.169.254" : "juice-shop:3000"}\r\nCookie: private`,
        responseBody: "private",
      },
    });
  });
  const result = await client.readActiveMessages("0");
  expect(result).toEqual({ evidence: "OBSERVED_TARGET_ORIGIN", count: 2, mismatches: [{ messageId: "1", host: "169.254.169.254", sentAt: 1795502186864 }] });
  expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  expect(await client.inspectDemoScope("active", "0")).toEqual({ evidence: "OUT_OF_SCOPE", count: 2 });
});
test("scan progress keeps the two contract rules and the request total", async () => {
  const plugin = (id: string, requests: string) => ({ Plugin: ["Name " + id, id, "release", "Complete", "5", requests, "0"] });
  const read = (...rows: object[]) => reply({ scanProgress: ["http://juice-shop:3000", { HostProcess: rows }] }).scanProgress("0");
  const [host] = (await read(plugin("6", "9"), plugin("90034", "13"), plugin("20015", "3"))).hosts;
  expect(host).toMatchObject({ requests: 25, named: [{ id: "90034", requests: 13 }, { id: "20015", requests: 3 }] });
  expect((await read(plugin("6", "x"))).hosts[0].requests).toBeNull();
});
test("completed assessments summarize only verified evidence of both runs", async () => {
  const { summarizeEvidence } = await import("../src/modules/assessments/records.ts");
  expect(summarizeEvidence([])).toBeNull();
});
