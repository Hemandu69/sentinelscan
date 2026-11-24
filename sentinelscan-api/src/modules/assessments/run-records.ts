import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { ZapClient } from "../../integrations/zap/client.ts";
import { providerSession } from "../../integrations/zap/session.ts";
import {
  canonical,
  collectEvidence,
  contractVersion,
  digest,
  judge,
} from "../../integrations/zap/evidence.ts";
import { readContainerLog } from "../../integrations/zap/run-log.ts";
import { demoTarget as demo, registeredScope } from "../../lib/security/destination.ts";
import { ApiError } from "../../lib/errors.ts";
import { version as consentVersion } from "./consent.ts";
import { persistFinalFindingsTx } from "./persist-findings.ts";

type Kind = "spider" | "active";
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
type Receipt = { kind: Kind; scanId: string; sessionKey: string };
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
  try {
    await registeredScope(demo);
  } catch {
    throw new ApiError(403, "DEMO_SCOPE_DISABLED");
  }
  return row.status;
}
// Cancelling is local bookkeeping. It needs no provider access and stays available
// when the target is archived or outside the demo scope.
async function lockedStatus(tx: Tx, id: string) {
  const [row] = await tx.$queryRaw<
    { status: string }[]
  >`SELECT status FROM assessments WHERE id=${id}::uuid FOR UPDATE`;
  if (!row) throw new ApiError(404, "ASSESSMENT_NOT_FOUND");
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
  // The scans ended, but only contract evidence can establish how. Not a success, failure
  // or cancellation. Import may still complete it, and the operator may still cancel it.
  if (kind === "active" && state === "FINISHED") return "OUTCOME_UNKNOWN";
  return state === "NOT_STARTED" && current === "PENDING"
    ? "INITIALIZING"
    : current;
}
function isClosed(status: string) {
  return ["FAILED", "CANCELLED", "COMPLETED"].includes(status);
}
const publicRun = (row: Run) => ({
  kind: row.kind,
  scan_id: row.scan_id,
  state: row.state,
  progress: row.progress,
  associated_at: row.associated_at,
  observed_at: row.observed_at,
});
export type RunRecords = ReturnType<typeof createRunRecords>;
// The verified operations, shared by the routes and the scan orchestrator.
export function createRunRecords(
  db: PrismaClient,
  zap: ZapClient,
  getSession = () => providerSession(zap),
  readLog = readContainerLog,
) {
  async function associate(
    id: string,
    input: Receipt,
  ): Promise<Run> {
    const { status: initial, existing } = await db.$transaction(
      async (tx) => ({
        status: await eligible(tx, id),
        existing: (await runs(tx, id)).find((r) => r.kind === input.kind),
      }),
    );
    if (existing) {
      if (
        existing.scan_id === input.scanId &&
        existing.session_key === input.sessionKey
      )
        return existing;
      throw new ApiError(409, "ZAP_RUN_ALREADY_BOUND");
    }
    if (isClosed(initial)) throw new ApiError(409, "ASSESSMENT_INELIGIBLE");
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
      await tx.$executeRaw`UPDATE assessments SET status=${terminal ?? trackingStatus(input.kind, sample.state, status)},started_at=CASE WHEN ${sample.outcome === "RUNNING"} THEN COALESCE(started_at,CURRENT_TIMESTAMP) ELSE started_at END,finished_at=CASE WHEN ${!!terminal} THEN CURRENT_TIMESTAMP ELSE finished_at END,error_code=CASE WHEN ${!!terminal} THEN ${terminal ? "ZAP_RUN_" + terminal : null}::text ELSE error_code END WHERE id=${id}::uuid`;
      return (await runs(tx, id)).find((r) => r.kind === input.kind)!;
    });
  }
  async function sync(id: string) {
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
          // A finished active run says nothing while another saved run is still running.
          if (latest.state === "RUNNING" || !samples.some((r) => r.state === "RUNNING"))
            status = trackingStatus(latest.kind, latest.state, status);
          await tx.assessment.update({ where: { id }, data: { status } });
          // startedAt is the first time an associated run was observed RUNNING.
          if (samples.some((r) => r.outcome === "RUNNING"))
            await tx.assessment.updateMany({
              where: { id, startedAt: null },
              data: { startedAt: new Date() },
            });
        }
      }
      return { status, runs: await runs(tx, id) };
    });
  }
  async function cancelTracking(id: string) {
    return db.$transaction(async (tx) => {
      const status = await lockedStatus(tx, id);
      // The provider run has its own lifecycle and is never contacted here.
      const result = { status: "CANCELLED", providerScanStopped: false };
      if (status === "CANCELLED") return result;
      if (isClosed(status)) throw new ApiError(409, "ASSESSMENT_INELIGIBLE");
      await tx.assessment.update({
        where: { id },
        data: {
          status: "CANCELLED",
          errorCode: "OPERATOR_CANCELLED_TRACKING",
          finishedAt: new Date(),
        },
      });
      return result;
    });
  }
  const importing = new Set<string>();
  async function importRun(id: string) {
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
        "OUTCOME_UNKNOWN",
      ].includes(snapshot.status)
    )
      throw new ApiError(409, "ASSESSMENT_INELIGIBLE");
    if (importing.has(id) || importing.size >= 2)
      throw new ApiError(429, "IMPORT_BUSY");
    importing.add(id);
    try {
      const [storage] = await db.$queryRaw<
        { ready: boolean }[]
      >`SELECT to_regclass('run_evidence') IS NOT NULL AS ready`;
      if (!storage?.ready)
        throw new ApiError(503, "EVIDENCE_STORAGE_UNAVAILABLE");
      const find = (kind: Kind) => {
        const run = snapshot.runs.find((r) => r.kind === kind)!;
        return { scanId: run.scan_id, associatedAt: run.associated_at };
      };
      const receipts = { spider: find("spider"), active: find("active") };
      async function collect() {
        const facts = await collectEvidence(
          zap,
          getSession,
          readLog,
          receipts,
          demo,
        );
        if (snapshot.runs.some((run) => run.session_key !== facts.sessionKey))
          throw new ApiError(409, "ZAP_SESSION_CHANGED");
        return { facts, verdict: judge(facts, receipts) };
      }
      const initial = await collect();
      const ended = (["active", "spider"] as const)
        .map((kind) => initial.verdict[kind].outcome)
        .find((outcome) => outcome === "FAILED" || outcome === "CANCELLED");
      const unverified = [
        ...new Set([
          ...initial.verdict.spider.reasons,
          ...initial.verdict.active.reasons,
        ]),
      ].sort();
      if (
        !ended &&
        (initial.verdict.spider.outcome !== "SUCCEEDED" ||
          initial.verdict.active.outcome !== "SUCCEEDED")
      )
        throw new ApiError(409, "ZAP_SUCCESS_OR_SCOPE_UNVERIFIED", unverified);
      const findings = ended
        ? []
        : await zap.readAttributedFindings(receipts.active.scanId, demo);
      if (!ended && findings.length !== initial.facts.attributedAlerts)
        throw new ApiError(409, "ZAP_ALERT_SET_CHANGED");
      const confirmed = await collect();
      if (canonical(confirmed.facts) !== canonical(initial.facts))
        throw new ApiError(409, "ZAP_EVIDENCE_CHANGED");
      const observedAt = new Date();
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
            "OUTCOME_UNKNOWN",
          ].includes(status)
        )
          throw new ApiError(409, "ASSESSMENT_INELIGIBLE");
        // Receipts must still be the rows that the evidence was collected for.
        for (const run of snapshot.runs) {
          const progress = confirmed.facts.listing[run.kind]!;
          const updated =
            await tx.$executeRaw`UPDATE assessment_runs SET state=${progress.state}, progress=${progress.progress}, observed_at=GREATEST(observed_at,${observedAt}) WHERE kind=${run.kind} AND assessment_id=${id}::uuid AND session_key=${run.session_key} AND scan_id=${run.scan_id}`;
          if (updated !== 1) throw new ApiError(409, "OBSERVATION_CHANGED");
          const { outcome, reasons } = confirmed.verdict[run.kind];
          const inserted =
            await tx.$executeRaw`INSERT INTO run_evidence(assessment_id,kind,contract_version,session_key,outcome,reasons,facts,facts_digest,collected_at) VALUES (${id}::uuid,${run.kind},${contractVersion},${run.session_key},${outcome},${reasons}::text[],${canonical(confirmed.facts)}::jsonb,${digest(confirmed.facts)},${observedAt}) ON CONFLICT DO NOTHING`;
          if (inserted !== 1) throw new ApiError(409, "OBSERVATION_CHANGED");
        }
        if (ended) {
          await tx.assessment.update({
            where: { id },
            data: {
              status: ended,
              finishedAt: observedAt,
              errorCode: "ZAP_RUN_" + ended,
            },
          });
          return { status: ended, findingCount: null };
        }
        await tx.assessment.update({
          where: { id },
          data: { status: "PROCESSING_RESULTS" },
        });
        const findingCount = await persistFinalFindingsTx(tx, id, findings);
        return { status: "COMPLETED", findingCount };
      });
    } finally {
      importing.delete(id);
    }
  }
  async function execution(id: string) {
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
  }
  return { associate, sync, cancelTracking, importRun, execution };
}

// Receipts are created by the scan orchestrator only. Session fingerprints stay on the server.
export function registerRunRecords(
  app: FastifyInstance,
  db: PrismaClient,
  zap: ZapClient,
  getSession = () => providerSession(zap),
  readLog = readContainerLog,
  records = createRunRecords(db, zap, getSession, readLog),
  // An orchestrated scan owns its records until it ends.
  inProgress: (id: string) => boolean = () => false,
) {
  const base = "/api/v1/assessments/:id";
  const own = (value: unknown) => {
    const { id } = params.parse(value);
    if (inProgress(id)) throw new ApiError(409, "SCAN_IN_PROGRESS");
    return id;
  };
  app.get(base + "/execution", async (req) => {
    const result = await records.execution(params.parse(req.params).id);
    return { ...result, runs: result.runs.map(publicRun) };
  });
  app.post(base + "/zap-sync", async (req) => {
    const result = await records.sync(own(req.params));
    return { ...result, runs: result.runs.map(publicRun) };
  });
  app.post(base + "/cancel-tracking", async (req) => {
    const id = own(req.params);
    z.strictObject({ confirmed: z.literal(true) }).parse(req.body);
    return records.cancelTracking(id);
  });
  app.post(base + "/zap-import", async (req) => records.importRun(own(req.params)));
  return records;
}
