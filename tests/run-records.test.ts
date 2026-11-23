import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { registerRunRecords } from "../src/modules/assessments/run-records.ts";
import type { ZapClient } from "../src/integrations/zap/client.ts";
import { ApiError } from "../src/lib/errors.ts";
const id = "b113e0b9-c57f-43a4-86a7-51fe94507c96",
  target = "http://juice-shop:3000/",
  session = "a".repeat(64);
type Row = {
  kind: string;
  scan_id: string;
  session_key: string;
  observed_at: Date;
  state: string;
  progress: number;
};
function setup() {
  const updateReceipt = vi.fn(() => true);
  const state = {
    authorized: true,
    exists: true,
    startedAt: null as Date | null,
    status: "PENDING",
    runs: [] as Row[],
    count: 0,
  };
  const db = {
    finding: { count: async () => state.count },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
      const draft = structuredClone(state);
      const tx = {
        async $queryRaw(parts: TemplateStringsArray) {
          const sql = parts.join("?");
          if (sql.includes("FROM assessment_runs")) return draft.runs;
          if (sql.includes("AS eligible"))
            return [{ status: draft.status, eligible: draft.authorized }];
          if (sql.includes("target_url_snapshot FROM assessments"))
            return [{ status: draft.status, target_url_snapshot: target }];
          if (sql.startsWith("SELECT status FROM assessments"))
            return draft.exists ? [{ status: draft.status }] : [];
          throw Error("Unexpected query");
        },
        async $executeRaw(parts: TemplateStringsArray, ...args: unknown[]) {
          const sql = parts.join("?");
          if (sql.startsWith("INSERT INTO assessment_runs"))
            draft.runs.push({
              kind: String(args[1]),
              scan_id: String(args[2]),
              session_key: String(args[3]),
              state: String(args[4]),
              progress: Number(args[5]),
              observed_at: new Date(),
            });
          else if (sql.startsWith("UPDATE assessments SET status"))
{
            draft.status = String(args[0]);
            if (args[1] === true) draft.startedAt ??= new Date();
          } else if (sql.startsWith("UPDATE assessment_runs SET state=")) {
            if (!updateReceipt()) return 0;
            if (args.length > 1) {
              const row = draft.runs.find((r) => r.kind === args[3])!;
              row.state = String(args[0]);
              row.progress = Number(args[1]);
            }
          } else throw Error("Unexpected write");
          return 1;
        },
        assessment: {
          findUnique: async () =>
            draft.exists ? { status: draft.status } : null,
          updateMany: async () => {
            draft.startedAt ??= new Date();
          },
          update: async ({ data }: { data: { status: string } }) => {
            draft.status = data.status;
          },
        },
        finding: {
          count: async () => draft.count,
          createMany: async ({ data }: { data: unknown[] }) => {
            draft.count += data.length;
          },
        },
      };
      const result = await fn(tx);
      Object.assign(state, draft);
      return result;
    },
  };
  const row = {
    id: "0",
    state: "RUNNING",
    progress: 20,
    reportedOrigin: "http://juice-shop:3000",
    exactDemoUrl: true,
    outcome: "RUNNING",
  };
  const zap = {
    inspectRuns: vi.fn(async () => [row]),
    readAttributedFindings: vi.fn(async () => [] as unknown[]),
  };
  const stamp = vi.fn(async () => session);
  const open = () => {
    const app = Fastify();
    app.setErrorHandler((err, req, reply) =>
      reply
        .code(err instanceof ApiError ? err.status : 500)
        .send({ code: (err as Error).message }),
    );
    registerRunRecords(
      app,
      db as unknown as PrismaClient,
      zap as unknown as ZapClient,
      stamp,
    );
    return app;
  };
  let app = open();
  const call = (name: string, payload = {}) =>
    app.inject({
      method: "POST",
      url: "/api/v1/assessments/" + id + "/" + name,
      payload,
    });
  const bind = (kind: string) =>
    call("zap-association", {
      kind,
      scanId: "0",
      sessionKey: session,
      target,
      confirmedOperatorReceipt: true,
    });
  return {
    state,
    updateReceipt,
    zap,
    row,
    stamp,
    bind,
    call,
    get: (path: string) => app.inject(path),
    close: () => app.close(),
    restart: async () => {
      await app.close();
      app = open();
    },
  };
}
beforeEach(() => vi.stubEnv("SENTINELSCAN_DEMO_TARGET", "juice-shop"));
afterEach(() => vi.unstubAllEnvs());
test("losing a receipt at final write rolls back both run snapshots and completion", async () => {
  const f = setup();
  try {
    await f.bind("spider");
    await f.bind("active");
    f.row.state = "FINISHED";
    f.row.outcome = "SUCCEEDED"; // Fixture attestation.
    f.row.progress = 100;
    f.updateReceipt.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect((await f.call("zap-import")).json().code).toBe("OBSERVATION_CHANGED");
    expect(f.state.status).toBe("ACTIVE_SCAN_RUNNING");
    expect(f.state.runs.every(r => r.progress === 20)).toBe(true);
  } finally {
    await f.close();
  }
});
test("duplicate receipt and service restart retain both typed IDs; empty verified import is idempotent", async () => {
  const f = setup();
  try {
    expect((await f.bind("active")).statusCode).toBe(409);
    expect((await f.bind("spider")).statusCode).toBe(200);
    expect((await f.bind("spider")).statusCode).toBe(200);
    expect((await f.bind("active")).statusCode).toBe(200);
    await f.restart();
    expect(f.state.runs).toHaveLength(2);
    f.row.state = "FINISHED";
    f.row.outcome = "SUCCEEDED"; // Independent outcome evidence supplied by the fixture.
    f.row.progress = 100;
    expect((await f.call("zap-import")).json()).toEqual({
      status: "COMPLETED",
      findingCount: 0,
    });
    expect((await f.call("zap-import")).statusCode).toBe(200);
    expect(f.state.runs.map((r) => [r.state, r.progress])).toEqual([
      ["FINISHED", 100],
      ["FINISHED", 100],
    ]);
    expect(f.zap.readAttributedFindings).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});
test.each(["FINISHED", "RUNNING", "PAUSED", "STOPPED", "FAILED"])(
  "100 percent with %s cannot import",
  async (state) => {
    const f = setup();
    try {
      await f.bind("spider");
      await f.bind("active");
      f.row.state = state;
      f.row.progress = 100;
      expect((await f.call("zap-import")).statusCode).toBe(409);
      expect(f.zap.readAttributedFindings).not.toHaveBeenCalled();
      expect(f.state.status).not.toBe("COMPLETED");
    } finally {
      await f.close();
    }
  },
);
test.each([
  ["FAILED", "FAILED"],
  ["STOPPED", "CANCELLED"],
])(
  "sync preserves %s as a distinct terminal outcome",
  async (provider, status) => {
    const f = setup();
    try {
      await f.bind("spider");
      await f.bind("active");
      f.row.state = provider;
      f.row.outcome = status;
      expect((await f.call("zap-sync")).json().status).toBe(status);
      expect((await f.call("zap-import")).statusCode).toBe(409);
    } finally {
      await f.close();
    }
  },
);
test("cancellation blocks subsequent import and is repeatable", async () => {
  const f = setup();
  try {
    await f.bind("spider");
    await f.bind("active");
    for (let i = 0; i < 2; i++)
      expect(
        (await f.call("cancel-tracking", { confirmed: true })).json(),
      ).toEqual({ status: "CANCELLED", providerScanStopped: false });
    expect((await f.call("zap-import")).statusCode).toBe(409);
  } finally {
    await f.close();
  }
});
test("consent, provider restart and scope failures block binding or import", async () => {
  const f = setup();
  try {
    f.state.authorized = false;
    expect((await f.bind("spider")).statusCode).toBe(403);
    expect(f.stamp).not.toHaveBeenCalled();
    f.state.authorized = true;
    f.row.id = "1";
    expect((await f.bind("spider")).statusCode).toBe(404);
    f.row.id = "0";
    await f.bind("spider");
    await f.bind("active");
    f.stamp.mockResolvedValueOnce("b".repeat(64));
    expect((await f.call("zap-import")).json().code).toBe(
      "ZAP_SESSION_CHANGED",
    );
    f.row.reportedOrigin = "http://other.invalid";
    expect((await f.call("zap-import")).json().code).toBe(
      "ZAP_RUN_OUTSIDE_TARGET",
    );
  } finally {
    await f.close();
  }
});
test("failed persistence validation rolls processing state back; retry uses the same receipts", async () => {
  const f = setup();
  try {
    await f.bind("spider");
    await f.bind("active");
    f.row.state = "FINISHED";
    f.row.outcome = "SUCCEEDED"; // Independent outcome evidence supplied by the fixture.
    f.row.progress = 100;
    f.zap.readAttributedFindings.mockResolvedValueOnce([
      {
        url: "https://outside.invalid/",
        sourceSeverity: "Low",
        normalizedSeverity: "LOW",
        description: "fixture",
        confidence: "Low",
      },
    ]);
    expect((await f.call("zap-import")).json().code).toBe(
      "FINDING_OUTSIDE_TARGET",
    );
    expect(f.state.status).toBe("ACTIVE_SCAN_RUNNING");
    expect(f.state.count).toBe(0);
    expect(
      f.state.runs.every((r) => r.state === "RUNNING" && r.progress === 20),
    ).toBe(true);
    f.zap.readAttributedFindings.mockResolvedValueOnce([
      {
        url: target,
        name: "Fixture",
        sourceSeverity: "Low",
        normalizedSeverity: "LOW",
        description: "fixture",
        confidence: "Low",
      },
    ]);
    expect((await f.call("zap-import")).json()).toEqual({
      status: "COMPLETED",
      findingCount: 1,
    });
  } finally {
    await f.close();
  }
});

test.each([["archived or non-demo", false], ["eligible", true]] as const)(
  "%s assessment can be cancelled locally without provider access",
  async (_name, authorized) => {
    const f = setup();
    try {
      f.state.authorized = authorized;
      expect((await f.call("cancel-tracking", { confirmed: true })).json()).toEqual({
        status: "CANCELLED",
        providerScanStopped: false,
      });
      expect(f.zap.inspectRuns).not.toHaveBeenCalled();
      expect(f.stamp).not.toHaveBeenCalled();
      // Cancellation never relaxes authorization for provider operations.
      if (!authorized)
        for (const name of ["zap-sync", "zap-import"])
          expect((await f.call(name)).statusCode).toBe(403);
    } finally {
      await f.close();
    }
  },
);
test("cancellation needs explicit confirmation, an existing assessment and an open status", async () => {
  const f = setup();
  try {
    expect((await f.call("cancel-tracking", {})).statusCode).toBe(500); // Zod is mapped by the full app.
    for (const status of ["COMPLETED", "FAILED"]) {
      f.state.status = status;
      const response = await f.call("cancel-tracking", { confirmed: true });
      expect(response.json().code).toBe("ASSESSMENT_INELIGIBLE");
      expect(f.state.status).toBe(status);
    }
    f.state.exists = false;
    expect((await f.call("cancel-tracking", { confirmed: true })).statusCode).toBe(404);
  } finally {
    await f.close();
  }
});
test("a conflicting receipt never replaces the stored one", async () => {
  const f = setup();
  const bind = (change: object) =>
    f.call("zap-association", {
      kind: "spider",
      scanId: "0",
      sessionKey: session,
      target,
      confirmedOperatorReceipt: true,
      ...change,
    });
  try {
    await f.bind("spider");
    const stored = structuredClone(f.state.runs);
    for (const change of [{ scanId: "1" }, { sessionKey: "b".repeat(64) }]) {
      const response = await bind(change);
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe("ZAP_RUN_ALREADY_BOUND");
    }
    expect(f.state.runs).toEqual(stored);
    const other = await bind({ kind: "active", sessionKey: "b".repeat(64) });
    expect(other.json().code).toBe("ZAP_SESSION_CHANGED");
    expect(f.state.runs).toHaveLength(1);
  } finally {
    await f.close();
  }
});
test("receipt input is strict", async () => {
  const f = setup();
  const valid = {
    kind: "spider",
    scanId: "0",
    sessionKey: session,
    target,
    confirmedOperatorReceipt: true,
  };
  try {
    for (const change of [
      { confirmedOperatorReceipt: false },
      { target: "http://127.0.0.1:3001/" },
      { sessionKey: "short" },
      { scanId: "-1" },
      { kind: "ajax" },
      { extra: 1 },
    ])
      expect(
        (await f.call("zap-association", { ...valid, ...change })).statusCode,
      ).not.toBe(200);
    expect(f.state.runs).toHaveLength(0);
    expect(f.stamp).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
test("closed assessments reject new receipts before provider access", async () => {
  const f = setup();
  try {
    for (const status of ["COMPLETED", "FAILED", "CANCELLED"]) {
      f.state.status = status;
      expect((await f.bind("spider")).json().code).toBe("ASSESSMENT_INELIGIBLE");
    }
    expect(f.stamp).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
test("provider session changing during observation stores nothing", async () => {
  const f = setup();
  try {
    f.stamp.mockResolvedValueOnce(session).mockResolvedValueOnce("b".repeat(64));
    expect((await f.bind("spider")).json().code).toBe("ZAP_SESSION_CHANGED");
    expect(f.state.runs).toHaveLength(0);
  } finally {
    await f.close();
  }
});
test("execution endpoint reads saved runs without provider access and reports absence", async () => {
  const f = setup();
  const path = "/api/v1/assessments/" + id + "/execution";
  try {
    expect((await f.get(path)).json()).toEqual({ status: "PENDING", runs: [] });
    await f.bind("spider");
    await f.call("cancel-tracking", { confirmed: true });
    f.zap.inspectRuns.mockClear();
    f.stamp.mockClear();
    f.state.authorized = false;
    const response = await f.get(path);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "CANCELLED",
      runs: [{ kind: "spider", scan_id: "0", state: "RUNNING", progress: 20 }],
    });
    expect(f.zap.inspectRuns).not.toHaveBeenCalled();
    expect(f.stamp).not.toHaveBeenCalled();
    f.state.exists = false;
    expect((await f.get(path)).statusCode).toBe(404);
  } finally {
    await f.close();
  }
});
test("startedAt records the first observed RUNNING state and nothing else", async () => {
  const f = setup();
  try {
    f.row.state = "FINISHED";
    f.row.outcome = "UNKNOWN";
    await f.bind("spider");
    await f.call("zap-sync");
    expect(f.state.startedAt).toBeNull();
    f.row.state = "RUNNING";
    f.row.outcome = "RUNNING";
    await f.call("zap-sync");
    const first = f.state.startedAt;
    expect(first).toBeInstanceOf(Date);
    await f.bind("active");
    await f.call("zap-sync");
    expect(f.state.startedAt).toEqual(first);
  } finally {
    await f.close();
  }
});
test("a run that stops being listed as RUNNING keeps an unknown outcome and stays open", async () => {
  const f = setup();
  try {
    await f.bind("spider");
    await f.bind("active");
    f.row.state = "FINISHED";
    f.row.outcome = "UNKNOWN";
    f.row.progress = 100;
    expect((await f.call("zap-sync")).json()).toMatchObject({
      status: "ACTIVE_SCAN_RUNNING",
      runs: [{ state: "FINISHED" }, { state: "FINISHED" }],
    });
    expect((await f.call("zap-import")).json().code).toBe(
      "ZAP_SUCCESS_OR_SCOPE_UNVERIFIED",
    );
  } finally {
    await f.close();
  }
});
test("import stays blocked without a reported origin, even with a supplied success", async () => {
  const f = setup();
  try {
    await f.bind("spider");
    await f.bind("active");
    f.row.state = "FINISHED";
    f.row.outcome = "SUCCEEDED"; // Fixture attestation.
    f.row.progress = 100;
    f.row.reportedOrigin = null as unknown as string;
    expect((await f.call("zap-import")).json().code).toBe(
      "ZAP_SUCCESS_OR_SCOPE_UNVERIFIED",
    );
    expect(f.zap.readAttributedFindings).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
test("demo scope disabled is reported distinctly and blocks provider access", async () => {
  vi.stubEnv("SENTINELSCAN_DEMO_TARGET", "");
  const f = setup();
  try {
    const response = await f.bind("spider");
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("DEMO_SCOPE_DISABLED");
    expect(f.stamp).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
