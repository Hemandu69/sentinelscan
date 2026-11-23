import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { ZapClient } from "../../integrations/zap/client.ts";
import { providerSession } from "../../integrations/zap/session.ts";
import { registeredScope } from "../../lib/security/destination.ts";
import { ApiError } from "../../lib/errors.ts";
import { version as consentVersion } from "./consent.ts";
import { persistFinalFindingsTx } from "./persist-findings.ts";

const demo = "http://juice-shop:3000/";
const kinds = z.enum(["spider", "active"]);
type Kind = z.infer<typeof kinds>;
type Run = {
  kind: Kind;
  scan_id: string;
  session_key: string;
  state: string | null;
  progress: number | null;
  associated_at: Date;
  observed_at: Date;
};
type Tx = Prisma.TransactionClient;
const params = z.strictObject({ id: z.uuid() });
const binding = z.strictObject({
  kind: kinds,
  scanId: z.string().regex(/^\d{1,12}$/),
  sessionKey: z.string().regex(/^[a-f0-9]{64}$/),
  confirmedOperatorReceipt: z.literal(true),
  target: z.literal(demo),
});
async function runs(tx: Tx, id: string) {
  return tx.$queryRaw<
    Run[]
  >`SELECT kind,scan_id,session_key,state,progress,associated_at,observed_at FROM assessment_runs WHERE assessment_id=${id}::uuid ORDER BY associated_at,kind`;
}
async function eligible(tx: Tx, id: string) {
  const [row] = await tx.$queryRaw<
    { status: string; eligible: boolean }[]
  >`SELECT a.status, (a.target_url_snapshot=${demo} AND t.canonical_url=${demo} AND t.archived_at IS NULL AND a.authorization_confirmed_at IS NOT NULL AND a.authorization_text_version=${consentVersion}) AS eligible FROM assessments a JOIN targets t ON a.target_id=t.id WHERE a.id=${id}::uuid FOR UPDATE OF a,t`;
  if (!row) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
  if (!row.eligible) throw new ApiError(403, "ASSESSMENT_SCOPE_NOT_AUTHORIZED");
  await registeredScope(demo);
  return row.status;
}
async function observe(zap: ZapClient, kind: Kind, id: string) {
  const matches = (await zap.inspectRuns(kind)).filter((row) => row.id === id);
  if (matches.length !== 1)
    throw new ApiError(
      matches.length ? 409 : 404,
      matches.length ? "ZAP_RUN_AMBIGUOUS" : "ZAP_RUN_NOT_FOUND",
    );
  const row = matches[0];
  if (row.reportedOrigin && row.reportedOrigin !== new URL(demo).origin)
    throw new ApiError(409, "ZAP_RUN_OUTSIDE_TARGET");
  if (row.reportedOrigin && !row.exactDemoUrl)
    throw new ApiError(409, "ZAP_SCOPE_NOT_EXACT");
  return {
    state: row.state,
    outcome: row.outcome,
    progress: row.progress ?? (await zap.progress(kind, id)),
    origin: row.reportedOrigin,
  };
}
function trackingStatus(kind: Kind, state: string | null, current: string) {
  if (state === "RUNNING")
    return kind === "active" ? "ACTIVE_SCAN_RUNNING" : "SPIDER_RUNNING";
  return state === "NOT_STARTED" && current === "PENDING"
    ? "INITIALIZING"
    : current;
}
function isClosed(status: string) {
  return ["FAILED", "CANCELLED", "COMPLETED"].includes(status);
}
export function registerRunRecords(
  app: FastifyInstance,
  db: PrismaClient,
  zap: ZapClient,
  getSession = () => providerSession(zap),
) {
  const base = "/api/v1/assessments/:id";
  app.get(base + "/execution", async (req) => {
    const { id } = params.parse(req.params);
    return db.$transaction(
      async (tx) => {
        const assessment = await tx.assessment.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!assessment) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
        return { ...assessment, runs: await runs(tx, id) };
      },
      { isolationLevel: "RepeatableRead" },
    );
  });
  app.get("/api/v1/integrations/zap/session-fingerprint", async (_req, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .send({ sessionKey: await getSession() }),
  );
  app.post(base + "/zap-association", async (req) => {
    const { id } = params.parse(req.params),
      input = binding.parse(req.body);
    const existing = await db.$transaction(async (tx) => {
      await eligible(tx, id);
      return (await runs(tx, id)).find((r) => r.kind === input.kind);
    });
    if (existing) {
      if (
        existing.scan_id === input.scanId &&
        existing.session_key === input.sessionKey
      )
        return existing;
      throw new ApiError(409, "ZAP_RUN_ALREADY_BOUND");
    }
    const verify = async () => {
      if ((await getSession()) !== input.sessionKey)
        throw new ApiError(409, "ZAP_SESSION_CHANGED");
    };
    await verify();
    const sample = await observe(zap, input.kind, input.scanId);
    await verify();
    return db.$transaction(async (tx) => {
      const status = await eligible(tx, id),
        current = await runs(tx, id);
      const old = current.find((r) => r.kind === input.kind);
      if (
        old &&
        old.scan_id === input.scanId &&
        old.session_key === input.sessionKey
      )
        return old;
      if (isClosed(status) || old)
        throw new ApiError(409, "ASSESSMENT_INELIGIBLE");
      if (
        input.kind === "active" &&
        !current.some(
          (r) => r.kind === "spider" && r.session_key === input.sessionKey,
        )
      )
        throw new ApiError(409, "SPIDER_RECEIPT_REQUIRED");
      const count =
        await tx.$executeRaw`INSERT INTO assessment_runs(assessment_id,kind,scan_id,session_key,state,progress,observed_at) VALUES (${id}::uuid,${input.kind},${input.scanId},${input.sessionKey},${sample.state},${sample.progress},CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
      if (count !== 1) throw new ApiError(409, "ZAP_RUN_ALREADY_BOUND");
      const terminal =
        sample.outcome === "FAILED" || sample.outcome === "CANCELLED"
          ? sample.outcome
          : null;
      await tx.$executeRaw`UPDATE assessments SET status=${terminal ?? trackingStatus(input.kind, sample.state, status)},finished_at=CASE WHEN ${!!terminal} THEN CURRENT_TIMESTAMP ELSE finished_at END,error_code=CASE WHEN ${!!terminal} THEN ${terminal ? "ZAP_RUN_" + terminal : null}::text ELSE error_code END WHERE id=${id}::uuid`;
      return (await runs(tx, id)).find((r) => r.kind === input.kind);
    });
  });
  app.post(base + "/zap-sync", async (req) => {
    const { id } = params.parse(req.params);
    const snapshot = await db.$transaction(async (tx) => ({
      status: await eligible(tx, id),
      runs: await runs(tx, id),
    }));
    if (!snapshot.runs.length || isClosed(snapshot.status)) return snapshot;
    const session = await getSession();
    if (snapshot.runs.some((r) => r.session_key !== session))
      throw new ApiError(409, "ZAP_SESSION_CHANGED");
    const samples = await Promise.all(
      snapshot.runs.map(async (r) => ({
        ...r,
        ...(await observe(zap, r.kind, r.scan_id)),
      })),
    );
    if ((await getSession()) !== session)
      throw new ApiError(409, "ZAP_SESSION_CHANGED");
    return db.$transaction(async (tx) => {
      let status = await eligible(tx, id);
      if (!isClosed(status)) {
        const liveRuns = await runs(tx, id);
        if (liveRuns.length !== samples.length)
          throw new ApiError(409, "OBSERVATION_CHANGED");
        for (const sample of samples) {
          const n =
            await tx.$executeRaw`UPDATE assessment_runs SET state=${sample.state},progress=${sample.progress},observed_at=GREATEST(clock_timestamp()::timestamptz(3),observed_at + interval '1 millisecond') WHERE assessment_id=${id}::uuid AND kind=${sample.kind} AND observed_at=${sample.observed_at}`;
          if (n !== 1) throw new ApiError(409, "OBSERVATION_CHANGED");
          const terminal =
            sample.outcome === "FAILED" || sample.outcome === "CANCELLED"
              ? sample.outcome
              : null;
          if (terminal) {
            status = terminal;
            await tx.assessment.update({
              where: { id },
              data: {
                status,
                finishedAt: new Date(),
                errorCode: "ZAP_RUN_" + terminal,
              },
            });
            break;
          }
        }
        if (!isClosed(status)) {
          const latest = samples.find((r) => r.kind === "active") ?? samples[0];
          status = trackingStatus(latest.kind, latest.state, status);
          await tx.assessment.update({ where: { id }, data: { status } });
        }
      }
      return { status, runs: await runs(tx, id) };
    });
  });
  app.post(base + "/cancel-tracking", async (req) => {
    const { id } = params.parse(req.params);
    z.strictObject({ confirmed: z.literal(true) }).parse(req.body);
    return db.$transaction(async (tx) => {
      const status = await eligible(tx, id);
      if (status === "CANCELLED") return { status };
      if (isClosed(status)) throw new ApiError(409, "ASSESSMENT_INELIGIBLE");
      await tx.assessment.update({
        where: { id },
        data: {
          status: "CANCELLED",
          errorCode: "OPERATOR_CANCELLED_TRACKING",
          finishedAt: new Date(),
        },
      });
      return { status: "CANCELLED" };
    });
  });
  const importing = new Set<string>();
  app.post(base + "/zap-import", async (req) => {
    const { id } = params.parse(req.params);
    const snapshot = await db.$transaction(async (tx) => ({
      status: await eligible(tx, id),
      runs: await runs(tx, id),
    }));
    if (snapshot.runs.length !== 2)
      throw new ApiError(409, "BOTH_RUN_RECEIPTS_REQUIRED");
    if (snapshot.status === "COMPLETED")
      return {
        status: "COMPLETED",
        findingCount: await db.finding.count({ where: { assessmentId: id } }),
      };
    if (
      ![
        "PENDING",
        "ACTIVE_SCAN_RUNNING",
        "INITIALIZING",
        "SPIDER_RUNNING",
      ].includes(snapshot.status)
    )
      throw new ApiError(409, "ASSESSMENT_INELIGIBLE");
    if (importing.has(id) || importing.size >= 2)
      throw new ApiError(429, "IMPORT_BUSY");
    importing.add(id);
    try {
      async function verify() {
        const session = await getSession();
        const observations = [];
        for (const run of snapshot.runs) {
          if (run.session_key !== session)
            throw new ApiError(409, "ZAP_SESSION_CHANGED");
          const sample = await observe(zap, run.kind, run.scan_id);
          if (
            sample.outcome !== "SUCCEEDED" ||
            sample.progress !== 100 ||
            sample.origin !== new URL(demo).origin
          )
            throw new ApiError(409, "ZAP_SUCCESS_OR_SCOPE_UNVERIFIED");
          observations.push({ run, sample, observedAt: new Date() });
        }
        if ((await getSession()) !== session)
          throw new ApiError(409, "ZAP_SESSION_CHANGED");
        return observations;
      }
      await verify();
      const active = snapshot.runs.find((r) => r.kind === "active")!;
      const findings = await zap.readAttributedFindings(active.scan_id, demo);
      const finalObservations = await verify();
      return await db.$transaction(async (tx) => {
        const status = await eligible(tx, id);
        if (status === "COMPLETED")
          return {
            status,
            findingCount: await tx.finding.count({
              where: { assessmentId: id },
            }),
          };
        if (
          ![
            "PENDING",
            "ACTIVE_SCAN_RUNNING",
            "INITIALIZING",
            "SPIDER_RUNNING",
          ].includes(status)
        )
          throw new ApiError(409, "ASSESSMENT_INELIGIBLE");
        await tx.assessment.update({
          where: { id },
          data: { status: "PROCESSING_RESULTS" },
        });
        const findingCount = await persistFinalFindingsTx(tx, id, findings);
        for (const { run, sample, observedAt } of finalObservations) {
          const updated = await tx.$executeRaw`UPDATE assessment_runs SET state=${sample.state}, progress=${sample.progress}, observed_at=${observedAt} WHERE kind=${run.kind} AND assessment_id=${id}::uuid AND session_key=${run.session_key} AND scan_id=${run.scan_id}`;
          if (updated !== 1) throw new ApiError(409, "OBSERVATION_CHANGED");
        }
        return { status: "COMPLETED", findingCount };
      });
    } finally {
      importing.delete(id);
    }
  });
}
