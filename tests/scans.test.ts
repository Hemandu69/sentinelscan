import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { createZapClient, type ZapClient } from "../src/integrations/zap/client.ts";
import { ApiError } from "../src/lib/errors.ts";
import { canonicalize, registrationUrl, scanTarget, demoTarget as approvedTarget, type Resolve, type ScanTarget } from "../src/lib/security/destination.ts";
import { groups } from "../src/modules/scans/exclusions.ts";
import { createEgress, type Egress } from "../src/modules/scans/egress.ts";
import { confirmations } from "../src/modules/assessments/consent.ts";
import type { RunRecords } from "../src/modules/assessments/run-records.ts";
import { compare, comparable } from "../src/modules/assessments/comparison.ts";
import { createOrchestrator } from "../src/modules/scans/orchestrator.ts";
import type { Resources } from "../src/modules/scans/resources.ts";
import { registerScans } from "../src/modules/scans/routes.ts";

// Every provider, Docker and database operation is a fake. No scan can start here.
const realLog = readFileSync(new URL("./fixtures/zap-run.log", import.meta.url), "utf8");
const id = "83ee2301-c70b-4c6b-b66d-b8f275d066f0",
  targetId = "ed603ae8-933f-4bdc-af5e-5c09d72fa998",
  session = "a".repeat(64);
beforeEach(() => vi.stubEnv("SENTINELSCAN_DEMO_TARGET", "juice-shop"));
afterEach(() => vi.unstubAllEnvs());

type Kind = "spider" | "active";
function setup() {
  const base = Date.parse("2026-11-25T00:00:00Z");
  const s = {
    clock: base,
    calls: [] as string[],
    target: approvedTarget,
    dns: ["8.8.8.8"],
    demoAddress: "172.29.83.3",
    guard: { available: true, apply: true, holds: true, lockGate: Promise.resolve() as Promise<unknown> },
    name: "",
    session,
    scans: {} as Partial<Record<Kind, { state: string; progress: number; polls: number }>>,
    stopped: { spider: false, active: false },
    pollsNeeded: 2,
    memory: 40,
    healthy: true,
    sites: ["http://juice-shop:3000"],
    extraLog: "",
    logPrefix: true,
    stopWorks: true,
    spiderComplete: true,
    spiderScope: "OBSERVED_TARGET_ORIGIN",
    openInSession: [] as { id: string }[],
    storage: true,
    policy: { delayMs: 20, threadsPerHost: 2, hostsPerScan: 1, maxScanMinutes: 0, maxRuleMinutes: 0, passiveAlertLimit: 10, rules: 52, enabledRules: 52, domXss: false },
    statuses: [] as [string, string | null][],
    tick: undefined as undefined | (() => void),
    gate: Promise.resolve(),
  };
  const lines = () => {
    const out = s.logPrefix ? ["2026-11-24T23:50:00.000000000Z Found Java version 17.0.21"] : [];
    const at = (ms: number) => new Date(base + ms).toISOString().replace("Z", "000000Z");
    const row = (ms: number, thread: string, logger: string, text: string) => out.push(`${at(ms)} 1 [${thread}] INFO  ${logger} - ${text}`);
    if (s.name) row(1, "ZAP-IO", "org.parosproxy.paros.control.Control", `New session file created: /home/zap/.ZAP/session/${s.name}.session`);
    if (s.scans.spider) {
      row(2, "ZAP-SpiderInitThread-0", "org.zaproxy.addon.spider.SpiderThread", `Starting spidering scan on ${s.target} at x`);
      if (s.stopped.spider) {
        row(3, "ZAP-IO", "org.zaproxy.addon.spider.Spider", "Stopping spidering process by request.");
        row(4, "ZAP-IO", "org.zaproxy.addon.spider.SpiderThread", `Spider scanning complete: false on ${s.target} at x`);
      } else if (s.scans.spider.state === "FINISHED" && s.spiderComplete) {
        row(3, "ZAP-SpiderThreadPool-0", "org.zaproxy.addon.spider.Spider", "Spidering process is complete. Shutting down...");
        row(4, "ZAP-SpiderShutdownThread-0", "org.zaproxy.addon.spider.SpiderThread", `Spider scanning complete: true on ${s.target} at x`);
      }
    }
    if (s.scans.active) {
      row(5, "ZAP-IO", "org.parosproxy.paros.core.scanner.Scanner", "scanner with ID 0 started");
      if (s.stopped.active) {
        row(6, "ZAP-IO", "org.parosproxy.paros.core.scanner.Scanner", "scanner with ID 0 stopped");
        row(7, "Thread-1", "org.parosproxy.paros.core.scanner.Scanner", "scanner with ID 0 completed in 1s");
      }
    }
    return out.join("\n") + "\n" + s.extraLog;
  };
  const start = (kind: Kind) => async () => {
    s.calls.push("start " + kind);
    s.scans[kind] = { state: "RUNNING", progress: 0, polls: 0 };
    return "0";
  };
  const zap = {
    version: async () => "2.17.0",
    policy: async () => s.policy,
    mentionsCredential: (text: string) => text.includes("fixture-key"),
    configureScan: vi.fn<(options: { exclusions: readonly string[]; postForms: boolean }) => Promise<void>>(async () => {}),
    newSession: vi.fn(async (name: string) => {
      s.calls.push("session");
      s.name = name;
      s.scans = {};
    }),
    sessionLocation: async () => `/home/zap/.ZAP/session/${s.name}.session`,
    startSpider: vi.fn(start("spider")),
    startActive: vi.fn(start("active")),
    stopScan: vi.fn(async (kind: Kind) => {
      s.calls.push("stop " + kind);
      if (!s.stopWorks) throw new ApiError(503, "ZAP_UNAVAILABLE");
      s.stopped[kind] = true;
      s.scans[kind]!.state = "FINISHED";
    }),
    sites: async () => s.sites,
    inspectScope: async () => ({ evidence: s.spiderScope, count: 72 }),
    inspectRuns: vi.fn(async (kind: Kind) => {
      const scan = s.scans[kind];
      if (!scan) return [];
      if (scan.state === "RUNNING" && ++scan.polls >= s.pollsNeeded) scan.state = "FINISHED";
      scan.progress = scan.state === "FINISHED" ? 100 : scan.polls * 10;
      return [{ id: "0", state: scan.state, progress: scan.progress, requests: kind === "active" ? 5 : null, alerts: kind === "active" ? 0 : null }];
    }),
  };
  const records = {
    associate: vi.fn(async (_id: string, input: { kind: Kind }) => {
      s.calls.push("receipt " + input.kind);
    }),
    sync: vi.fn(async () => ({})),
    importRun: vi.fn(async () => {
      s.calls.push("import");
      return { status: "COMPLETED", findingCount: 2 } as { status: string; findingCount: number | null };
    }),
  };
  const db = {
    $queryRaw: async (parts: TemplateStringsArray) =>
      parts.join("?").includes("to_regclass") ? [{ ready: s.storage }] : parts.join("?").includes("session_key") ? s.openInSession : [{}],
    $executeRaw: async (_parts: TemplateStringsArray, status: string, code: string | null) => {
      s.statuses.push([status, code]);
      return 1;
    },
    assessment: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === id ? { status: "ACTIVE_SCAN_RUNNING" } : null) },
  };
  const resources = {
    configuration: vi.fn(async () => ({ memoryBytes: 3221225472, image: "x", heap: "1536m" })),
    demoAddress: async () => s.demoAddress,
    sample: vi.fn<(demo: boolean) => Promise<{ healthy: boolean; memoryPercent: number | null }>>(async () => ({ healthy: s.healthy, memoryPercent: s.memory as number | null })),
  };
  const egress = {
    available: async () => s.guard.available,
    apply: vi.fn(async (target: ScanTarget) => {
      s.calls.push("guard " + target.addresses.join(",") + ":" + target.port);
      if (!s.guard.apply) throw new ApiError(503, "EGRESS_UNVERIFIED");
      return "rules";
    }),
    holds: vi.fn<(rules: string) => Promise<boolean>>(async () => s.guard.holds),
    lock: vi.fn(async () => {
      await s.guard.lockGate;
      s.calls.push("lock");
    }),
  };
  const resolve: Resolve = async () => s.dns.map((address) => ({ address }));
  const scans = createOrchestrator({
    db: db as unknown as PrismaClient,
    zap: zap as unknown as ZapClient,
    records: records as unknown as RunRecords,
    getSession: async () => s.session,
    readLog: async () => ({ containerStartedAt: "2026-11-24T23:50:00.000000000Z", text: lines(), errors: "" }),
    resources: resources as unknown as Resources,
    egress: egress as unknown as Egress,
    resolve,
    now: () => s.clock,
    wait: async (ms) => {
      s.clock += ms;
      s.tick?.();
      await s.gate;
    },
  });
  const launch = (key: string = randomUUID()) => scans.launch(key, s.target, async () => (s.calls.push("create"), { id }));
  const done = async () => {
    await vi.waitFor(() => expect(["COMPLETED", "FAILED", "CANCELLED", "OUTCOME_UNKNOWN"]).toContain(scans.job(id)?.stage), { timeout: 4000 });
    return scans.job(id)!;
  };
  return { s, zap, records, resources, egress, resolve, scans, launch, done, db };
}
test("a normal scan follows the fixed order and imports through the verified path", async () => {
  const f = setup();
  const seen = new Set<string>();
  f.s.tick = () => seen.add(f.scans.job(id)!.stage);
  await f.launch();
  const job = await f.done();
  expect(f.s.calls).toEqual(["create", "guard 172.29.83.3:3000", "session", "start spider", "receipt spider", "start active", "receipt active", "import", "lock"]);
  expect(job).toMatchObject({ stage: "COMPLETED", findingCount: 2, code: null });
  expect([...seen]).toEqual(expect.arrayContaining(["SPIDER_RUNNING", "ACTIVE_RUNNING", "COLLECTING_EVIDENCE"]));
  expect(job.scans.active).toMatchObject({ progress: 100, requests: 5, alerts: 0 });
  expect(f.zap.newSession).toHaveBeenCalledWith(expect.stringMatching(/^sentinelscan-83ee2301-\d+$/));
  expect(f.records.associate).toHaveBeenCalledWith(id, { kind: "spider", scanId: "0", sessionKey: session });
  expect(f.s.statuses).toEqual([["INITIALIZING", null]]);
});
test.each<[string, (f: ReturnType<typeof setup>) => void, string]>([
  ["memory limit changed", (f) => f.resources.configuration.mockResolvedValueOnce({ memoryBytes: 1, image: "x", heap: "1536m" }), "RESOURCE_LIMITS_CHANGED"],
  ["heap changed", (f) => f.resources.configuration.mockResolvedValueOnce({ memoryBytes: 3221225472, image: "x", heap: "512m" }), "RESOURCE_LIMITS_CHANGED"],
  ["high memory", (f) => (f.s.memory = 80), "MEMORY_TOO_HIGH"],
  ["unhealthy service", (f) => (f.s.healthy = false), "SERVICE_UNHEALTHY"],
  ["Docker unavailable", (f) => f.resources.configuration.mockRejectedValueOnce(new Error("x")), "DOCKER_UNAVAILABLE"],
  ["threads", (f) => (f.s.policy.threadsPerHost = 5), "SCAN_POLICY_CHANGED"],
  ["delay", (f) => (f.s.policy.delayMs = 0), "SCAN_POLICY_CHANGED"],
  ["passive limit", (f) => (f.s.policy.passiveAlertLimit = 0), "SCAN_POLICY_CHANGED"],
  ["DOM XSS enabled", (f) => (f.s.policy.domXss = true), "SCAN_POLICY_CHANGED"],
  ["rule disabled", (f) => (f.s.policy.enabledRules = 51), "SCAN_POLICY_CHANGED"],
  ["rule added", (f) => (f.s.policy.rules = 53), "SCAN_POLICY_CHANGED"],
  ["time limit set", (f) => (f.s.policy.maxScanMinutes = 5), "SCAN_POLICY_CHANGED"],
  ["key in log", (f) => (f.s.extraLog = "fixture-key"), "CREDENTIAL_IN_LOG"],
  ["recent add-on update", (f) => (f.s.extraLog = "2026-11-24T23:59:30.000000000Z 1 [ZAP-DownloadInstaller] INFO  x - y"), "ZAP_STILL_STARTING"],
  ["evidence table missing", (f) => (f.s.storage = false), "EVIDENCE_STORAGE_UNAVAILABLE"],
  ["unresolved run in session", (f) => (f.s.openInSession = [{ id }]), "UNRESOLVED_SCAN_IN_SESSION"],
  ["scan already running in ZAP", (f) => { f.s.scans.active = { state: "RUNNING", progress: 1, polls: 0 }; f.s.pollsNeeded = 99; }, "SCAN_ALREADY_RUNNING"],
  ["ZAP unavailable", (f) => (f.zap.policy = async () => { throw new ApiError(503, "ZAP_UNAVAILABLE"); }), "ZAP_UNAVAILABLE"],
  ["demo scope disabled", () => vi.stubEnv("SENTINELSCAN_DEMO_TARGET", ""), "DEMO_SCOPE_DISABLED"],
])("launch is refused before consent or provider changes: %s", async (_name, change, reason) => {
  const f = setup();
  change(f);
  const error = await f.launch().catch((e) => e);
  expect(error).toMatchObject({ status: 409, message: "SCAN_NOT_READY" });
  expect(error.reasons).toContain(reason);
  expect(f.s.calls).toEqual([]);
});
test("repeated requests, parallel clicks and a second scan never start twice", async () => {
  const f = setup();
  const key = randomUUID();
  const [a, b] = await Promise.all([f.launch(key), f.launch(key)]);
  expect([a, b].map((r) => r.assessmentId)).toEqual([id, id]);
  expect([a.repeated, b.repeated]).toEqual([false, true]);
  await expect(f.launch()).rejects.toThrow("SCAN_ALREADY_RUNNING");
  await f.done();
  expect((await f.launch(key)).repeated).toBe(true);
  expect(f.s.calls.filter((c) => c.startsWith("start"))).toEqual(["start spider", "start active"]);
});
test("a failed attempt can be repeated with the same key", async () => {
  const f = setup();
  const key = randomUUID();
  f.s.memory = 80;
  await expect(f.launch(key)).rejects.toThrow("SCAN_NOT_READY");
  f.s.memory = 40;
  expect((await f.launch(key)).repeated).toBe(false);
  await f.done();
});
test.each<[string, (f: ReturnType<typeof setup>) => void]>([
  ["no natural completion", (f) => (f.s.spiderComplete = false)],
  ["results outside the website", (f) => (f.s.spiderScope = "OUT_OF_SCOPE")],
  ["truncated log", (f) => { f.s.tick = () => { if (f.s.scans.spider?.state === "FINISHED") f.s.logPrefix = false; }; }],
])("the active scan never starts after an unverified spider: %s", async (_name, change) => {
  const f = setup();
  change(f);
  if (_name === "truncated log") f.s.logPrefix = true;
  await f.launch();
  if (_name === "truncated log") f.s.logPrefix = false;
  const job = await f.done();
  expect(job).toMatchObject({ stage: "OUTCOME_UNKNOWN", code: "SPIDER_UNVERIFIED" });
  expect(f.zap.startActive).not.toHaveBeenCalled();
  expect(f.records.importRun).not.toHaveBeenCalled();
});
test.each<[string, (f: ReturnType<typeof setup>) => void, string]>([
  ["memory", (f) => (f.s.memory = 91), "SCAN_STOPPED_MEMORY"],
  ["unknown memory", (f) => (f.resources.sample.mockImplementation(async () => ({ healthy: true, memoryPercent: null }))), "SCAN_STOPPED_MEMORY"],
  ["service", (f) => (f.s.healthy = false), "SCAN_STOPPED_SERVICE"],
  ["other site", (f) => (f.s.sites = ["http://juice-shop:3000", "http://other.invalid"]), "SCAN_STOPPED_SCOPE"],
  ["provider error", (f) => (f.s.extraLog = "2026-11-25T00:10:00.000000000Z 1 [x] ERROR y - z"), "SCAN_STOPPED_ERRORS"],
  ["time", (f) => (f.s.clock += 3 * 3600_000), "SCAN_STOPPED_TIME"],
])("the active scan is stopped, confirmed and never imported: %s", async (_name, change, code) => {
  const f = setup();
  f.s.tick = () => {
    if (f.s.scans.active && !f.s.stopped.active) {
      f.s.pollsNeeded = 999;
      f.s.scans.active.state = "RUNNING";
      change(f);
    }
  };
  f.s.pollsNeeded = 3;
  await f.launch();
  const job = await f.done();
  expect(job).toMatchObject({ stage: "CANCELLED", code });
  expect(f.s.calls).toContain("stop active");
  expect(f.records.importRun).not.toHaveBeenCalled();
  expect(f.s.statuses.at(-1)).toEqual(["CANCELLED", code]);
});
test("older provider errors do not stop a new scan", async () => {
  const f = setup();
  f.s.extraLog = "2026-11-24T23:55:00.000000000Z 1 [x] ERROR y - z";
  await f.launch();
  expect((await f.done()).stage).toBe("COMPLETED");
});
test.each<Kind>(["spider", "active"])("operator cancellation stops the %s scan and later stages", async (kind) => {
  const f = setup();
  f.s.tick = () => {
    if (f.s.scans[kind] && !f.s.stopped[kind]) {
      f.s.pollsNeeded = 999;
      f.s.scans[kind]!.state = "RUNNING";
      if (!f.scans.job(id)!.cancelRequested) f.scans.cancel(id);
    }
  };
  f.s.pollsNeeded = 3;
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "CANCELLED", code: "OPERATOR_CANCELLED_SCAN" });
  await vi.waitFor(() => expect(f.s.calls.slice(-2)).toEqual(["stop " + kind, "lock"]));
  if (kind === "spider") expect(f.zap.startActive).not.toHaveBeenCalled();
  expect(f.records.importRun).not.toHaveBeenCalled();
  expect(f.records.sync).toHaveBeenCalled();
});
test("an unconfirmed stop is UNKNOWN, never cancelled or completed", async () => {
  const f = setup();
  f.s.stopWorks = false;
  f.s.tick = () => {
    if (f.s.scans.active && !f.scans.job(id)!.cancelRequested) f.scans.cancel(id);
  };
  f.s.pollsNeeded = 5;
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "OUTCOME_UNKNOWN", code: "CANCELLATION_UNCONFIRMED" });
});
test("cancellation is refused when nothing runs or while importing", async () => {
  const f = setup();
  expect(() => f.scans.cancel(id)).toThrow("SCAN_NOT_RUNNING");
  let refused = "";
  f.records.importRun.mockImplementationOnce(async () => {
    try { f.scans.cancel(id); } catch (error) { refused = (error as Error).message; }
    return { status: "COMPLETED", findingCount: 0 };
  });
  await f.launch();
  await f.done();
  expect(refused).toBe("SCAN_NOT_CANCELLABLE");
  expect(() => f.scans.cancel(id)).toThrow("SCAN_NOT_RUNNING");
});
test("refused evidence leaves the outcome unknown with its reasons", async () => {
  const f = setup();
  f.records.importRun.mockRejectedValueOnce(new ApiError(409, "ZAP_SUCCESS_OR_SCOPE_UNVERIFIED", ["ACTIVE_SCOPE"]));
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "OUTCOME_UNKNOWN", code: "EVIDENCE_UNVERIFIED", reasons: ["ACTIVE_SCOPE"], findingCount: null });
  expect(f.s.statuses.at(-1)).toEqual(["OUTCOME_UNKNOWN", "EVIDENCE_UNVERIFIED"]);
});
test.each(["FAILED", "CANCELLED"])("evidence of %s is shown as such", async (status) => {
  const f = setup();
  f.records.importRun.mockResolvedValueOnce({ status, findingCount: null });
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: status, findingCount: null });
});
test("a failure before any launch is FAILED; afterwards the outcome is unknown", async () => {
  const before = setup();
  before.zap.newSession.mockRejectedValueOnce(new ApiError(503, "ZAP_UNAVAILABLE"));
  await before.launch();
  expect(await before.done()).toMatchObject({ stage: "FAILED", code: "SCAN_START_FAILED" });
  expect(before.zap.startSpider).not.toHaveBeenCalled();
  const after = setup();
  after.zap.startSpider.mockRejectedValueOnce(new ApiError(504, "ZAP_TIMEOUT"));
  await after.launch();
  expect(await after.done()).toMatchObject({ stage: "OUTCOME_UNKNOWN" });
  const receipt = setup();
  receipt.records.associate.mockRejectedValueOnce(new ApiError(409, "ZAP_SESSION_CHANGED"));
  await receipt.launch();
  expect(await receipt.done()).toMatchObject({ stage: "OUTCOME_UNKNOWN" });
  expect(receipt.s.calls).toContain("stop spider");
});
test("a short interruption is tolerated; a lasting one or a changed session is unknown", async () => {
  const short = setup();
  const real = short.zap.inspectRuns.getMockImplementation()!;
  let n = 0;
  short.zap.inspectRuns.mockImplementation(async (kind) => {
    if (short.s.scans.spider && n++ < 3) throw new ApiError(503, "ZAP_UNAVAILABLE");
    return real(kind);
  });
  await short.launch();
  expect((await short.done()).stage).toBe("COMPLETED");
  const lost = setup();
  lost.s.tick = () => (lost.s.session = "b".repeat(64));
  lost.s.pollsNeeded = 9;
  await lost.launch();
  expect(await lost.done()).toMatchObject({ stage: "OUTCOME_UNKNOWN", code: "PROVIDER_LOST" });
  expect(lost.records.importRun).not.toHaveBeenCalled();
});

function http(clock = Date.now) {
  const f = setup();
  const consent = confirmations(clock);
  const create = vi.fn(async () => ({ id }));
  const db = {
    ...f.db,
    target: { findFirst: async ({ where }: { where: { id: string } }) => (where.id === targetId ? { canonicalUrl: f.s.target } : null) },
    $transaction: async (work: (tx: unknown) => unknown) => work({ $queryRaw: async () => [{ canonical_url: f.s.target }], assessment: { create } }),
  };
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.code(err instanceof ApiError ? err.status : err instanceof z.ZodError ? 400 : 500).send({ error: err instanceof ApiError ? err.message : "INVALID_REQUEST", ...(err instanceof ApiError && err.reasons.length ? { reasons: err.reasons } : {}) }),
  );
  registerScans(app, db as unknown as PrismaClient, consent, f.scans, f.resolve);
  const body = (change: object = {}) => ({ targetId, url: f.s.target, authorized: true, authorizationTextVersion: "2", confirmationToken: consent.issue(targetId, f.s.target).token, configuration: "standard", requestKey: randomUUID(), ...change });
  return { ...f, app, create, body, post: (payload: object) => app.inject({ method: "POST", url: "/api/v1/scans", payload }) };
}
test("launch needs consent for the exact registered address and accepts nothing else", async () => {
  const f = http();
  try {
    for (const change of [
      { authorized: false }, { authorizationTextVersion: "0" }, { confirmationToken: undefined }, { configuration: "custom" }, { requestKey: "x" },
      { scanId: "1" }, { sessionKey: session }, { policy: "x" }, { threads: 50 }, { action: "ascan/action/scan" },
    ])
      expect((await f.post(f.body(change))).statusCode).toBe(400);
    for (const url of ["http://127.0.0.1:3001/", "http://169.254.169.254/", "http://juice-shop:3000", "http://juice-shop:3000/x", "http://localhost/", "https://www.hemandu.com/", "http://juice-shop:3000@evil.example/"])
      expect((await f.post(f.body({ url }))).json().error).toBe("TARGET_CHANGED");
    expect((await f.post(f.body({ confirmationToken: randomUUID() }))).json().error).toBe("NEW_CONFIRMATION_REQUIRED");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.s.calls).toEqual([]);
  } finally {
    await f.app.close();
  }
});
test("the HTTP flow launches once, reports real progress and hides identifiers", async () => {
  const f = http();
  try {
    f.s.pollsNeeded = 400;
    let release = () => {};
    f.s.gate = new Promise<void>((resolve) => (release = resolve));
    const body = f.body();
    const first = await f.post(body);
    expect([first.statusCode, first.json()]).toEqual([202, { assessmentId: id }]);
    const again = await f.post(body);
    expect([again.statusCode, again.json()]).toEqual([200, { assessmentId: id }]);
    expect((await f.post(f.body())).json().error).toBe("SCAN_ALREADY_RUNNING");
    expect(f.create).toHaveBeenCalledTimes(1);
    const progress = await f.app.inject(`/api/v1/assessments/${id}/scan`);
    expect(progress.json()).toMatchObject({ tracked: true, assessmentId: id });
    expect(progress.body).not.toMatch(/session|aaaaaaaa|scanId|"id"/);
    expect((await f.app.inject({ method: "POST", url: `/api/v1/assessments/${id}/scan/cancel`, payload: {} })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "POST", url: `/api/v1/assessments/${id}/scan/cancel`, payload: { confirmed: true } })).json()).toMatchObject({ cancelRequested: true });
    release();
    expect((await f.done()).stage).toBe("CANCELLED");
  } finally {
    await f.app.close();
  }
});
test("a refused launch keeps the consent unused", async () => {
  const f = http();
  try {
    f.s.memory = 80;
    const body = f.body();
    const refused = await f.post(body);
    expect(refused.json()).toEqual({ error: "SCAN_NOT_READY", reasons: ["MEMORY_TOO_HIGH"] });
    f.s.memory = 40;
    expect((await f.post(body)).statusCode).toBe(202);
    await f.done();
  } finally {
    await f.app.close();
  }
});
test("an untracked or unknown assessment shows no invented progress", async () => {
  const f = http();
  try {
    expect((await f.app.inject(`/api/v1/assessments/${id}/scan`)).json()).toMatchObject({ tracked: false, stage: null, spider: null, active: null, memoryPercent: null });
    expect((await f.app.inject(`/api/v1/assessments/${randomUUID()}/scan`)).statusCode).toBe(404);
    expect((await f.app.inject("/api/v1/scans/policy")).json()).not.toHaveProperty("approvedTargets");
    expect((await f.app.inject(`/api/v1/targets/${targetId}/readiness`)).json()).toEqual({ ready: true, reasons: [] });
  } finally {
    await f.app.close();
  }
});
test("provider actions use fixed addresses, the header key and validated answers", async () => {
  const urls: string[] = [];
  const client = createZapClient("fixture-key", 500, async (url, options) => {
    urls.push(String(url));
    expect(new Headers(options?.headers).get("X-ZAP-API-Key")).toBe("fixture-key");
    return Response.json(String(url).includes("/scan/") ? { scan: "0" } : { Result: "OK" });
  });
  await client.newSession("sentinelscan-abc-1");
  expect([await client.startSpider(approvedTarget), await client.startActive(approvedTarget)]).toEqual(["0", "0"]);
  await client.stopScan("active", "0");
  expect(urls).toEqual([
    "http://127.0.0.1:8090/JSON/core/action/newSession/?name=sentinelscan-abc-1&overwrite=false",
    "http://127.0.0.1:8090/JSON/spider/action/scan/?url=http%3A%2F%2Fjuice-shop%3A3000%2F&recurse=true",
    "http://127.0.0.1:8090/JSON/ascan/action/scan/?url=http%3A%2F%2Fjuice-shop%3A3000%2F&recurse=true",
    "http://127.0.0.1:8090/JSON/ascan/action/stop/?scanId=0",
  ]);
  await expect(client.newSession("../x")).rejects.toThrow();
  await expect(client.stopScan("active", "0/../../x")).rejects.toThrow();
  const odd = createZapClient("k", 500, async () => Response.json({ scan: "x" }));
  await expect(odd.startSpider(approvedTarget)).rejects.toThrow("ZAP_MALFORMED_RESPONSE");
});
// --- Several websites, validated and enforced
const public1 = "https://www.hemandu.com/";
function website(url = public1, dns = ["216.198.79.65", "64.29.17.65"]) {
  const f = setup();
  f.s.target = url;
  f.s.dns = dns;
  f.s.sites = [new URL(url).origin];
  return f;
}
test.each([
  [public1, ["216.198.79.65", "64.29.17.65"], "216.198.79.65,64.29.17.65:443"],
  ["https://example.org/", ["8.8.8.8"], "8.8.8.8:443"],
  ["http://example.net:8080/", ["1.1.1.1", "2606:4700:4700::1111"], "1.1.1.1:8080"],
])("a validated public website is scanned only behind its own firewall: %s", async (url, dns, guard) => {
  const f = website(url, dns);
  expect(await f.scans.eligibility(url)).toMatchObject({ state: "ELIGIBLE", reasons: [] });
  await f.launch();
  expect((await f.done()).stage).toBe("COMPLETED");
  await vi.waitFor(() => expect(f.s.calls.at(-1)).toBe("lock"));
  expect(f.s.calls).toEqual(["create", "guard " + guard, "session", "start spider", "receipt spider", "start active", "receipt active", "import", "lock"]);
  expect(f.zap.startSpider).toHaveBeenCalledWith(url);
  expect(f.zap.startActive).toHaveBeenCalledWith(url);
  expect(f.resources.sample).toHaveBeenCalledWith(false);
});
test("the demo exception keeps its exact address and fixed container network", async () => {
  const f = setup();
  f.s.demoAddress = "10.0.0.5";
  expect(await f.scans.eligibility(approvedTarget)).toMatchObject({ state: "VALIDATION_FAILED", reasons: ["DEMO_ADDRESS_UNKNOWN"] });
  for (const url of ["http://juice-shop:3001/", "http://juice-shop:3000/x", "http://juice-shop/", "https://juice-shop:3000/"])
    expect((await f.scans.eligibility(url)).state).toBe("VALIDATION_FAILED");
  vi.stubEnv("SENTINELSCAN_DEMO_TARGET", "");
  expect(await f.scans.eligibility(approvedTarget)).toMatchObject({ state: "UNAVAILABLE", reasons: ["DEMO_SCOPE_DISABLED"] });
});
test.each([
  ["private 10/8", ["10.1.2.3"]],
  ["private 172.16/12", ["172.16.0.1"]],
  ["private 192.168/16", ["192.168.1.1"]],
  ["loopback", ["127.0.0.1"]],
  ["link-local", ["169.254.1.1"]],
  ["cloud metadata", ["169.254.169.254"]],
  ["Alibaba metadata", ["100.100.100.200"]],
  ["Azure wire server", ["168.63.129.16"]],
  ["unspecified", ["0.0.0.0"]],
  ["broadcast", ["255.255.255.255"]],
  ["multicast", ["224.0.0.1"]],
  ["benchmark", ["198.18.0.1"]],
  ["documentation", ["203.0.113.1"]],
  ["reserved", ["240.0.0.1"]],
  ["IPv6 loopback", ["::1"]],
  ["IPv6 local", ["fd00::1"]],
  ["IPv6 link-local", ["fe80::1"]],
  ["mapped loopback", ["::ffff:127.0.0.1"]],
  ["NAT64", ["64:ff9b::a00:1"]],
  ["mixed public and private", ["8.8.8.8", "10.0.0.1"]],
  ["mixed families", ["8.8.8.8", "::1"]],
])("a name that resolves to a prohibited address is refused before anything happens: %s", async (_name, dns) => {
  const f = website(public1, dns);
  expect(await f.scans.eligibility(public1)).toMatchObject({ state: "VALIDATION_FAILED", reasons: ["TARGET_ADDRESS_PROHIBITED"], addresses: [] });
  const error = await f.launch().catch((e) => e);
  expect([error.message, error.reasons]).toEqual(["SCAN_NOT_READY", ["TARGET_ADDRESS_PROHIBITED"]]);
  expect(f.s.calls).toEqual([]);
});
test.each([
  ["ftp://example.org/", "TARGET_URL_INVALID"],
  ["https://a:b@example.org/", "TARGET_CREDENTIALS"],
  ["https://localhost/", "TARGET_HOST_PROHIBITED"],
  ["https://db.internal/", "TARGET_HOST_PROHIBITED"],
  ["https://intranet/", "TARGET_HOST_PROHIBITED"],
  ["https://127.0.0.1/", "TARGET_ADDRESS_PROHIBITED"],
  ["https://[::1]/", "TARGET_ADDRESS_PROHIBITED"],
  ["https://EXAMPLE.org/", "TARGET_NOT_CANONICAL"],
  ["https://example.org", "TARGET_NOT_CANONICAL"],
  ["https://example.org/app/", "TARGET_NOT_ROOT"],
  ["https://example.org/?a=1", "TARGET_NOT_ROOT"],
])("only an exact canonical root address is eligible: %s", async (url, reason) => {
  const f = setup();
  expect((await f.scans.eligibility(url)).reasons).toEqual([reason]);
});
test("missing DNS, IPv6-only websites and a missing firewall are explained", async () => {
  expect((await website(public1, []).scans.eligibility(public1)).reasons).toEqual(["TARGET_DNS_FAILED"]);
  expect((await website(public1, ["2606:4700:4700::1111"]).scans.eligibility(public1)).reasons).toEqual(["TARGET_IPV4_REQUIRED"]);
  const f = website();
  f.s.guard.available = false;
  expect(await f.scans.eligibility(public1)).toMatchObject({ state: "UNAVAILABLE", reasons: ["EGRESS_GUARD_UNAVAILABLE"] });
  await expect(f.launch()).rejects.toThrow("SCAN_NOT_READY");
});
test("DNS that turns private after consent stops the scan before the firewall or ZAP is used", async () => {
  const f = website();
  await f.scans.launch(randomUUID(), public1, async () => {
    f.s.dns = ["10.0.0.1"];
    return { id };
  });
  expect(await f.done()).toMatchObject({ stage: "FAILED", code: "SCAN_START_FAILED", reasons: ["TARGET_ADDRESS_PROHIBITED"] });
  expect(f.s.calls).toEqual([]);
});
test("a public change after consent enforces the newly validated addresses", async () => {
  const f = website();
  await f.scans.launch(randomUUID(), public1, async () => {
    f.s.dns = ["9.9.9.9"];
    return { id };
  });
  await f.done();
  expect(f.s.calls[0]).toBe("guard 9.9.9.9:443");
});
test("DNS rebinding during the spider never reaches the active scan", async () => {
  const f = website();
  f.s.tick = () => {
    if (f.s.scans.spider) f.s.dns = ["8.8.8.8", "169.254.169.254"];
  };
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "FAILED", code: "SCAN_TARGET_INVALID", reasons: ["TARGET_ADDRESS_PROHIBITED"] });
  expect(f.zap.startActive).not.toHaveBeenCalled();
  expect(f.records.importRun).not.toHaveBeenCalled();
});
test("a firewall that cannot be proven means that nothing starts", async () => {
  const f = website();
  f.s.guard.apply = false;
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "FAILED", code: "SCAN_START_FAILED", reasons: ["EGRESS_UNVERIFIED"] });
  await vi.waitFor(() => expect(f.s.calls.at(-1)).toBe("lock"));
  expect(f.zap.newSession).not.toHaveBeenCalled();
  expect(f.zap.startSpider).not.toHaveBeenCalled();
});
test.each<Kind>(["spider", "active"])("losing the firewall stops the %s scan", async (kind) => {
  const f = website();
  f.s.pollsNeeded = 3;
  f.s.tick = () => {
    if (f.s.scans[kind] && !f.s.stopped[kind]) {
      f.s.pollsNeeded = 999;
      f.s.scans[kind]!.state = "RUNNING";
      f.s.guard.holds = false;
    }
  };
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "CANCELLED", code: "SCAN_STOPPED_EGRESS" });
  expect(f.records.importRun).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(f.s.calls.at(-1)).toBe("lock"));
});
test("evidence is not imported if the firewall is gone when the scans end", async () => {
  const f = website();
  f.egress.holds.mockImplementation(async () => f.scans.job(id)?.stage !== "COLLECTING_EVIDENCE");
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "OUTCOME_UNKNOWN", code: "SCAN_STOPPED_EGRESS" });
  expect(f.records.importRun).not.toHaveBeenCalled();
});
test("a redirect that brings ZAP to an unapproved origin stops the scan", async () => {
  const f = website();
  f.s.pollsNeeded = 999;
  f.s.tick = () => {
    if (f.s.scans.spider) f.s.sites = ["https://www.hemandu.com", "https://hemandu.com"];
  };
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "CANCELLED", code: "SCAN_STOPPED_SCOPE" });
});
test("ZAP is locked after every outcome, and the next scan waits for the lock", async () => {
  const f = website();
  let release = () => {};
  f.s.guard.lockGate = new Promise<void>((resolve) => (release = resolve));
  await f.launch();
  await f.done();
  await expect(f.launch()).rejects.toThrow("SCAN_ALREADY_RUNNING");
  expect((await f.scans.readiness(public1)).reasons).toEqual(["SCAN_ALREADY_RUNNING"]);
  release();
  await vi.waitFor(() => expect(f.s.calls.at(-1)).toBe("lock"));
  f.s.name = "";
  f.s.scans = {};
  await f.launch();
  await f.done();
});
test("over HTTP, registration authorizes nothing, and consent is exact, fresh and single-use", async () => {
  let clock = 0;
  const f = http(() => clock);
  f.s.target = public1;
  f.s.dns = ["216.198.79.65"];
  f.s.sites = ["https://www.hemandu.com"];
  try {
    expect((await f.app.inject(`/api/v1/targets/${targetId}/eligibility`)).json()).toEqual({ url: public1, state: "ELIGIBLE", reasons: [], addresses: ["216.198.79.65"], safety: expect.arrayContaining([expect.stringMatching(/sign-out/)]) });
    expect((await f.app.inject(`/api/v1/targets/${randomUUID()}/eligibility`)).statusCode).toBe(404);
    expect((await f.post(f.body({ authorized: undefined }))).statusCode).toBe(400);
    expect((await f.post(f.body({ url: "https://hemandu.com/" }))).json().error).toBe("TARGET_CHANGED");
    const expired = f.body();
    clock = 300000;
    expect((await f.post(expired)).json().error).toBe("NEW_CONFIRMATION_REQUIRED");
    const before = f.body();
    f.s.target = "https://changed.example.org/";
    expect((await f.post(before)).json().error).toBe("TARGET_CHANGED");
    f.s.target = public1;
    f.s.dns = ["192.168.0.1"];
    expect((await f.post(f.body())).json()).toEqual({ error: "SCAN_NOT_READY", reasons: ["TARGET_ADDRESS_PROHIBITED"] });
    expect(f.s.calls).toEqual([]);
    f.s.dns = ["216.198.79.65"];
    const good = f.body();
    expect((await f.post(good)).statusCode).toBe(202);
    await f.done();
    await vi.waitFor(() => expect(f.s.calls.at(-1)).toBe("lock"));
    expect((await f.post({ ...good, requestKey: randomUUID() })).statusCode).toBe(409);
  } finally {
    await f.app.close();
  }
});
test("the guard runs fixed commands only, joined to ZAP, without extra privileges", async () => {
  const calls: string[][] = [];
  let verdict = "VERIFIED";
  const egress = createEgress(async (...args) => {
    calls.push(args);
    return args.includes("probe") ? verdict : args[0] === "image" ? "1" : "table inet sentinelscan {}";
  });
  const target = await scanTarget(public1, async () => "", async () => [{ address: "216.198.79.65" }]);
  expect(await egress.available()).toBe(true);
  const rules = await egress.apply(target);
  expect(await egress.holds(rules)).toBe(true);
  expect(await egress.holds("other")).toBe(false);
  const run = calls.find((args) => args.includes("apply"))!;
  expect(run.join(" ")).toBe(
    "run --rm --pull never --network container:sentinelscan-infrastructure-zap-1 --cap-drop ALL --cap-add NET_ADMIN --security-opt no-new-privileges --tmpfs /tmp sentinelscan-egress-guard:1 apply www.hemandu.com 443 216.198.79.65",
  );
  verdict = "guard: reachable";
  await expect(egress.apply(target)).rejects.toThrow("EGRESS_UNVERIFIED");
  for (const bad of [{ host: "a;b" }, { host: "--x y" }, { port: 0 }, { port: 1.5 }, { addresses: [] }, { addresses: ["::1"] }, { addresses: ["1.1.1.1; x"] }])
    await expect(egress.apply({ ...target, ...bad })).rejects.toThrow("DESTINATION_PROHIBITED");
});
test("ZAP start actions accept only a canonical root address", async () => {
  const client = createZapClient("k", 500, async () => Response.json({ scan: "0" }));
  for (const url of ["http://x.example", "http://x.example/a", "file:///etc/passwd", "http://u:p@x.example/", "http://x.example/?a", "javascript:1", ""])
    for (const start of [client.startSpider, client.startActive]) {
      const error = await Promise.resolve()
        .then(() => start(url))
        .catch((e) => e);
      expect(error.message).toBe("DESTINATION_PROHIBITED");
    }
});
test("message scope follows the authorized website and its Host header", async () => {
  const read = (header: string) =>
    createZapClient("k", 500, async (url) =>
      Response.json(String(url).includes("messagesIds") ? { messagesIds: ["1"] } : { message: { id: "1", requestHeader: header, timestamp: "1" } }),
    ).readActiveMessages("0", public1);
  expect(await read("GET https://www.hemandu.com/a HTTP/1.1\r\nHost: www.hemandu.com")).toMatchObject({ evidence: "OBSERVED_TARGET_ORIGIN", mismatches: [] });
  for (const url of ["http://www.hemandu.com/", "https://hemandu.com/", "https://www.hemandu.com:8443/", "http://juice-shop:3000/"])
    expect((await read(`GET ${url} HTTP/1.1\r\nHost: www.hemandu.com`)).evidence).toBe("OUT_OF_SCOPE");
  expect((await read("GET https://www.hemandu.com/ HTTP/1.1\r\nHost: 169.254.169.254")).mismatches).toHaveLength(1);
});
test("public websites always get the safety exclusions, the demo keeps its verified settings", async () => {
  const f = website();
  await f.launch();
  await f.done();
  expect(f.zap.configureScan).toHaveBeenCalledWith(expect.objectContaining({ exclusions: groups.map((g) => g.pattern), postForms: false }));
  const demo = setup();
  await demo.launch();
  await demo.done();
  expect(demo.zap.configureScan).toHaveBeenCalledWith(expect.objectContaining({ exclusions: [], postForms: true }));
});
test("nothing starts if ZAP does not confirm the exclusions", async () => {
  const f = website();
  f.zap.configureScan.mockRejectedValueOnce(new ApiError(409, "SCAN_EXCLUSIONS_UNVERIFIED"));
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "FAILED", reasons: ["SCAN_EXCLUSIONS_UNVERIFIED"] });
  expect(f.zap.startSpider).not.toHaveBeenCalled();
});
test("exclusions match whole words of an address only", () => {
  const excluded = (path: string) => groups.some((g) => new RegExp(g.pattern.replace("(?i)", ""), "i").test("https://www.hemandu.com/" + path));
  for (const path of ["logout", "account/Log-Out", "a/signoff?x=1", "api/users/5/delete", "x?action=delete&id=1", "checkout/step", "orders/7", "wp-admin/", "contact", "api/payments", "unsubscribe.php", "reset-password"])
    expect([path, excluded(path)]).toEqual([path, true]);
  for (const path of ["", "about", "blog/paying-attention", "projects/ordering", "deleted-scenes-not", "administer", "search?q=x", "api/products", "removeable"])
    expect([path, excluded(path)]).toEqual([path, false]);
});
test("the client proves the exclusions it set", async () => {
  const calls: string[] = [];
  const lists: Record<string, string[]> = { spider: [], ascan: [] };
  let broken = false;
  const client = createZapClient("k", 500, async (input) => {
    const url = new URL(String(input));
    const [, , component, , action] = url.pathname.split("/");
    calls.push(component + "/" + action);
    if (action === "clearExcludedFromScan") lists[component] = [];
    if (action === "excludeFromScan" && !broken) lists[component].push(url.searchParams.get("regex")!);
    if (action === "excludedFromScan") return Response.json({ excludedFromScan: lists[component] });
    if (action === "optionPostForm") return Response.json({ PostForm: "false" });
    return Response.json({ Result: "OK" });
  });
  await client.configureScan({ exclusions: ["a", "b"], postForms: false });
  expect(lists).toEqual({ spider: ["a", "b"], ascan: ["a", "b"] });
  await expect(client.configureScan({ exclusions: [], postForms: true })).rejects.toThrow("SCAN_EXCLUSIONS_UNVERIFIED");
  broken = true;
  await expect(client.configureScan({ exclusions: ["a"], postForms: false })).rejects.toThrow("SCAN_EXCLUSIONS_UNVERIFIED");
});
test("any website can be registered by name without becoming eligible", async () => {
  for (const [raw, canonical] of [
    ["https://www.hemandu.com", "https://www.hemandu.com/"], ["HTTPS://WWW.Example-College.EDU:443/", "https://www.example-college.edu/"],
    ["https://www.example-company.com/", "https://www.example-company.com/"], ["http://sub.client.example.org:8080/#x", "http://sub.client.example.org:8080/"],
  ])
    expect(await registrationUrl(raw)).toBe(canonical);
  for (const raw of ["ftp://x.com/", "https://u:p@x.com/", "http://localhost/", "http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/", "http://[::1]/", "http://db.internal/", "junk"])
    await expect(registrationUrl(raw)).rejects.toThrow("DESTINATION_PROHIBITED");
  expect((await website("https://rebind.example.org/", ["10.0.0.1"]).scans.eligibility("https://rebind.example.org/")).state).toBe("VALIDATION_FAILED");
});
test("registration and scanning use the same address policy", async () => {
  const mixed: Resolve = async () => [{ address: "8.8.8.8" }, { address: "10.0.0.1" }];
  await expect(canonicalize("https://example.com", mixed)).rejects.toMatchObject({ message: "DESTINATION_PROHIBITED", reasons: ["TARGET_ADDRESS_PROHIBITED"] });
});
const row = (fingerprint: string, change: object = {}) => ({ id: randomUUID(), fingerprint, name: "n", url: "http://juice-shop:3000/", normalizedSeverity: "LOW", sourceSeverity: "Low", confidence: "Low", description: "d", remediation: null, ...change });
test("comparison separates new, persistent, changed and not seen again, and claims no resolution", () => {
  const result = compare([row("a"), row("b"), row("c")], [row("b"), row("c", { normalizedSeverity: "HIGH", sourceSeverity: "High" }), row("d")]);
  expect([result.new.length, result.persistent.length, result.changed.length, result.notSeenAgain.length]).toEqual([1, 1, 1, 1]);
  expect(result.changed[0]).toMatchObject({ previousSeverity: "LOW", severity: "HIGH", fields: ["normalizedSeverity", "sourceSeverity"] });
  expect([result.resolved, result.resolvedSupported]).toEqual([[], false]);
});
test("comparison needs equal coverage", () => {
  const facts = (change: object = {}, active: object = {}) => ({ target: approvedTarget, contract: "1.1", log: { active: { completedRules: 51, skippedRules: ["x"], ...active } }, ...change }) as never;
  expect(comparable(facts(), facts())).toEqual([]);
  expect(comparable(null, facts())).toEqual(["EVIDENCE_MISSING"]);
  expect(comparable(facts(), facts({ contract: "2" }))).toEqual(["DIFFERENT_CONTRACT"]);
  expect(comparable(facts(), facts({}, { completedRules: 50 }))).toEqual(["DIFFERENT_RULES"]);
  expect(comparable(facts(), facts({}, { skippedRules: [] }))).toEqual(["DIFFERENT_RULES"]);
  expect(comparable(facts(), facts({ target: "http://x/" }))).toEqual(["DIFFERENT_TARGET"]);
});
test("the real log fixture stays the reference for evidence", () => {
  expect(realLog).toContain("scanner with ID 0 completed");
});
