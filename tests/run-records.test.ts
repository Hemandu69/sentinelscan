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
            draft.status = String(args[0]);
          else if (sql.startsWith("UPDATE assessment_runs SET state=")) {
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
      ).toEqual({ status: "CANCELLED" });
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
