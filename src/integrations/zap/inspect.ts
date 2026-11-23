import { configuredZapClient } from "./client.ts";
import { collectEvidence, judge } from "./evidence.ts";
import { readContainerLog } from "./run-log.ts";
import { providerSession } from "./session.ts";
import { ApiError } from "../../lib/errors.ts";

const zap = configuredZapClient();
async function inspect() {
  console.log("Configured ZAP version", await zap.version());
  const [mode, kind, id, ...extra] = process.argv.slice(2);
  if (mode === "--evidence") {
    // Read-only rehearsal of contract v1. Nothing is stored, and no receipt is checked.
    if (![kind, id].every((v) => /^\d{1,12}$/.test(v ?? "")) || extra.length)
      throw new ApiError(400, "EXPECTED_SPIDER_AND_ACTIVE_ID");
    const associatedAt = new Date();
    const receipts = {
      spider: { scanId: kind, associatedAt },
      active: { scanId: id, associatedAt },
    };
    const facts = await collectEvidence(
      zap,
      () => providerSession(zap),
      readContainerLog,
      receipts,
      "http://juice-shop:3000/",
    );
    console.log(JSON.stringify({ facts, judgement: judge(facts, receipts) }));
    return;
  }
  if (mode) {
    if (
      mode !== "--scope" ||
      (kind !== "spider" && kind !== "active") ||
      !/^\d{1,12}$/.test(id ?? "") ||
      extra.length
    )
      throw new ApiError(400, "EXPECTED_SCOPE_KIND_AND_ID");
    const matches = (await zap.inspectRuns(kind)).filter(
      (run) => run.id === id,
    );
    if (matches.length !== 1)
      throw new ApiError(409, "EXPECTED_ONE_MATCHING_RUN");
    console.log(
      JSON.stringify({
        kind,
        id,
        outcome: matches[0].outcome,
        ...(await zap.inspectDemoScope(kind, id)),
        ...(kind === "active" ? await zap.scanProgress(id) : {}),
      }),
    );
    return;
  }
  for (const kind of ["spider", "active"] as const) {
    const runs = await zap.inspectRuns(kind);
    console.log(kind, "listed runs", runs.length);
    for (const run of runs.slice(-10)) {
      console.log(
        JSON.stringify({
          kind,
          id: run.id,
          state: run.state,
          outcome: run.outcome,
          reportedOrigin: run.reportedOrigin,
          fields: run.fields,
        }),
      );
      if (!run.id) continue;
      console.log("progress", await zap.progress(kind, run.id));
      if (kind === "active")
        console.log(
          "attributed alert ID count",
          await zap.inspectAlertIds(run.id),
        );
    }
  }
}
inspect().catch((error) => {
  console.error(
    error instanceof ApiError ? error.message : "ZAP_INSPECTION_FAILED",
  );
  process.exitCode = 1;
});
