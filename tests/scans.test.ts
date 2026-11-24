import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { createZapClient, type ZapClient } from "../src/integrations/zap/client.ts";
import { ApiError } from "../src/lib/errors.ts";
import { demoTarget as approvedTarget } from "../src/lib/security/destination.ts";
import { createEgress, demoDestination, type Egress, type ScanTarget } from "../src/modules/scans/egress.ts";
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
      row(2, "ZAP-SpiderInitThread-0", "org.zaproxy.addon.spider.SpiderThread", "Starting spidering scan on http://juice-shop:3000/ at x");
      if (s.stopped.spider) {
        row(3, "ZAP-IO", "org.zaproxy.addon.spider.Spider", "Stopping spidering process by request.");
        row(4, "ZAP-IO", "org.zaproxy.addon.spider.SpiderThread", "Spider scanning complete: false on http://juice-shop:3000/ at x");
      } else if (s.scans.spider.state === "FINISHED" && s.spiderComplete) {
        row(3, "ZAP-SpiderThreadPool-0", "org.zaproxy.addon.spider.Spider", "Spidering process is complete. Shutting down...");
        row(4, "ZAP-SpiderShutdownThread-0", "org.zaproxy.addon.spider.SpiderThread", "Spider scanning complete: true on http://juice-shop:3000/ at x");
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
    resetScanOptions: vi.fn(async () => {}),
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
    inspectDemoScope: async () => ({ evidence: s.spiderScope, count: 72 }),
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
    sample: vi.fn(async () => ({ healthy: s.healthy, memoryPercent: s.memory as number | null })),
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
  const scans = createOrchestrator({
    db: db as unknown as PrismaClient,
    zap: zap as unknown as ZapClient,
    records: records as unknown as RunRecords,
    getSession: async () => s.session,
    readLog: async () => ({ containerStartedAt: "2026-11-24T23:50:00.000000000Z", text: lines(), errors: "" }),
    resources: resources as unknown as Resources,
    egress: egress as unknown as Egress,
    now: () => s.clock,
    wait: async (ms) => {
      s.clock += ms;
      s.tick?.();
      await s.gate;
    },
  });
  const launch = (key: string = randomUUID()) => scans.launch(key, async () => (s.calls.push("create"), { id }));
  const done = async () => {
    await vi.waitFor(() => expect(["COMPLETED", "FAILED", "CANCELLED", "OUTCOME_UNKNOWN"]).toContain(scans.job(id)?.stage), { timeout: 4000 });
    return scans.job(id)!;
  };
  return { s, zap, records, resources, egress, scans, launch, done, db };
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
  ["firewall image missing", (f) => (f.s.guard.available = false), "EGRESS_GUARD_UNAVAILABLE"],
  ["demo container elsewhere", (f) => (f.s.demoAddress = "10.0.0.5"), "DEMO_ADDRESS_UNKNOWN"],
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

function http() {
  const f = setup();
  const consent = confirmations();
  const create = vi.fn(async () => ({ id }));
  const db = {
    ...f.db,
    $transaction: async (work: (tx: unknown) => unknown) => work({ $queryRaw: async () => [{ canonical_url: approvedTarget }], assessment: { create } }),
  };
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.code(err instanceof ApiError ? err.status : err instanceof z.ZodError ? 400 : 500).send({ error: err instanceof ApiError ? err.message : "INVALID_REQUEST", ...(err instanceof ApiError && err.reasons.length ? { reasons: err.reasons } : {}) }),
  );
  registerScans(app, db as unknown as PrismaClient, consent, f.scans);
  const body = (change: object = {}) => ({ targetId, url: approvedTarget, authorized: true, authorizationTextVersion: "1", confirmationToken: consent.issue(targetId, approvedTarget).token, configuration: "standard", requestKey: randomUUID(), ...change });
  return { ...f, app, create, body, post: (payload: object) => app.inject({ method: "POST", url: "/api/v1/scans", payload }) };
}
test("launch needs consent for the exact approved address and accepts nothing else", async () => {
  const f = http();
  try {
    for (const change of [
      { authorized: false }, { authorizationTextVersion: "0" }, { confirmationToken: undefined }, { configuration: "custom" }, { requestKey: "x" },
      { scanId: "1" }, { sessionKey: session }, { policy: "x" }, { threads: 50 }, { action: "ascan/action/scan" },
    ])
      expect((await f.post(f.body(change))).statusCode).toBe(400);
    for (const url of ["http://127.0.0.1:3001/", "http://169.254.169.254/", "http://juice-shop:3000", "http://juice-shop:3000/x", "http://localhost/", "https://www.hemandu.com/", "http://juice-shop:3000@evil.example/"])
      expect((await f.post(f.body({ url }))).json().error).toBe("SCAN_TARGET_NOT_APPROVED");
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
    expect((await f.app.inject("/api/v1/scans/policy")).json().approvedTargets).toEqual([approvedTarget]);
    expect((await f.app.inject("/api/v1/scans/readiness")).json()).toEqual({ ready: true, reasons: [] });
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
  expect([await client.startSpider(), await client.startActive()]).toEqual(["0", "0"]);
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
  await expect(odd.startSpider()).rejects.toThrow("ZAP_MALFORMED_RESPONSE");
});
const telemetry = "2026-11-25T00:00:00.500000000Z 8592126 [ZAP-telemetry-stats] ERROR org.zaproxy.addon.callhome.ExtensionCallHome - tel.zaproxy.org: Temporary failure in name resolution";
test("telemetry refused by the firewall does not stop a scan, anything else does", async () => {
  const f = setup();
  f.s.extraLog = telemetry + "\n2026-11-25T00:00:00.500000000Z org.zaproxy.addon.network.common.ZapUnknownHostException: tel.zaproxy.org: Temporary failure in name resolution";
  await f.launch();
  expect((await f.done()).stage).toBe("COMPLETED");
  for (const line of [
    telemetry.replace("ExtensionCallHome", "Other"),
    telemetry.replace("tel.zaproxy.org", "juice-shop"),
    telemetry.replace("Temporary failure in name resolution", "x"),
    telemetry.replace("ZAP-telemetry-stats", "ZAP-Scanner-0"),
    telemetry + " and more",
  ]) {
    const g = setup();
    g.s.extraLog = line;
    await g.launch();
    expect(await g.done()).toMatchObject({ stage: "CANCELLED", code: "SCAN_STOPPED_ERRORS" });
  }
});
test("scan options are restored in the new session, or nothing starts", async () => {
  const f = setup();
  f.zap.resetScanOptions.mockRejectedValueOnce(new ApiError(409, "SCAN_POLICY_CHANGED"));
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "FAILED", reasons: ["SCAN_POLICY_CHANGED"] });
  expect(f.zap.startSpider).not.toHaveBeenCalled();
  let left: string[] = ["x"];
  let keep = false;
  const client = createZapClient("k", 500, async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("clearExcluded") && !keep) left = [];
    if (path.includes("excludedFromScan")) return Response.json({ excludedFromScan: left });
    if (path.includes("optionPostForm")) return Response.json({ PostForm: "true" });
    return Response.json({ Result: "OK" });
  });
  await client.resetScanOptions();
  left = ["x"];
  keep = true;
  await expect(client.resetScanOptions()).rejects.toThrow("SCAN_POLICY_CHANGED");
});
test("a firewall that cannot be proven means that nothing starts", async () => {
  const f = setup();
  f.s.guard.apply = false;
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "FAILED", code: "SCAN_START_FAILED", reasons: ["EGRESS_UNVERIFIED"] });
  await vi.waitFor(() => expect(f.s.calls.at(-1)).toBe("lock"));
  expect(f.zap.newSession).not.toHaveBeenCalled();
  expect(f.zap.startSpider).not.toHaveBeenCalled();
});
test.each<Kind>(["spider", "active"])("losing the firewall stops the %s scan", async (kind) => {
  const f = setup();
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
  const f = setup();
  f.egress.holds.mockImplementation(async () => f.scans.job(id)?.stage !== "COLLECTING_EVIDENCE");
  await f.launch();
  expect(await f.done()).toMatchObject({ stage: "OUTCOME_UNKNOWN", code: "SCAN_STOPPED_EGRESS" });
  expect(f.records.importRun).not.toHaveBeenCalled();
});
test("ZAP is locked after every outcome, and the next scan waits for the lock", async () => {
  const f = setup();
  let release = () => {};
  f.s.guard.lockGate = new Promise<void>((resolve) => (release = resolve));
  await f.launch();
  await f.done();
  await expect(f.launch()).rejects.toThrow("SCAN_ALREADY_RUNNING");
  release();
  await vi.waitFor(() => expect(f.s.calls.at(-1)).toBe("lock"));
  f.s.name = "";
  f.s.scans = {};
  await f.launch();
  await f.done();
});
test("the guard runs fixed commands only, joined to ZAP, without extra privileges", async () => {
  const calls: string[][] = [];
  let verdict = "VERIFIED";
  const egress = createEgress(async (...args) => {
    calls.push(args);
    return args.includes("probe") ? verdict : args[0] === "image" ? "1" : "table inet sentinelscan {}";
  });
  const target = demoDestination("172.29.83.3");
  expect(await egress.available()).toBe(true);
  const rules = await egress.apply(target);
  expect([await egress.holds(rules), await egress.holds("other")]).toEqual([true, false]);
  expect(calls.find((args) => args.includes("apply"))!.join(" ")).toBe(
    "run --rm --pull never --network container:sentinelscan-infrastructure-zap-1 --cap-drop ALL --cap-add NET_ADMIN --security-opt no-new-privileges --tmpfs /tmp sentinelscan-egress-guard:1 apply juice-shop 3000 172.29.83.3",
  );
  verdict = "guard: reachable";
  await expect(egress.apply(target)).rejects.toThrow("EGRESS_UNVERIFIED");
  for (const bad of [{ host: "a;b" }, { host: "--x y" }, { port: 0 }, { port: 1.5 }, { addresses: [] }, { addresses: ["::1"] }, { addresses: ["1.1.1.1; x"] }])
    await expect(egress.apply({ ...target, ...bad })).rejects.toThrow("DESTINATION_PROHIBITED");
  for (const address of ["10.0.0.1", "172.29.83.1", "172.29.83.16", "8.8.8.8", "", "172.29.83.3;x"])
    expect(() => demoDestination(address)).toThrow("DEMO_ADDRESS_UNKNOWN");
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
