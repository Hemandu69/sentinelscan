"use client";
import Link from "next/link";
import { useState, useEffect, useMemo, type ReactNode } from "react";
import { z } from "zod";
import { describeError, request } from "../lib/api";
import {
  detailFor,
  assessments,
  scans,
  statusLabel,
} from "../lib/records";
import { Navigation } from "./navigation";
import { AssessmentSummary, TechnicalView } from "./issues";
import { ScanProgress } from "./scan-progress";
import "./workspace.css";
import { ReportActions } from "./report-actions";
import { RunReceipts } from "./run-receipts";
import { ObservedRun } from "./observed-run";

function Read<T>({
  path,
  schema,
  children,
}: {
  path: string;
  schema: z.ZodType<T>;
  children: (value: T) => ReactNode;
}) {
  const [revision, retry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    value?: T;
    error?: string;
  }>();
  const key = path + "#" + revision;
  useEffect(() => {
    const control = new AbortController();
    request(path, control.signal)
      .then((body) => schema.parse(body))
      .then((value) => {
        if (!control.signal.aborted) setResult({ key, value });
      })
      .catch((cause: unknown) => {
        if (!control.signal.aborted)
          setResult({ key, error: describeError(cause) });
      });
    return () => control.abort();
  }, [path, schema, key]);
  if (result?.key !== key) return <p role="status">Loading records…</p>;
  if (result.error || result.value === undefined)
    return (
      <p role="alert">
        These records could not be loaded. {result.error}{" "}
        <button className="refresh" onClick={() => retry((n) => n + 1)}>
          Retry
        </button>
      </p>
    );
  return children(result.value);
}
function Pager({
  offset,
  set,
  more,
}: {
  offset: number;
  set: (n: number) => void;
  more: boolean;
}) {
  return (
    (offset > 0 || more) && (
      <div className="dialog-actions">
        <button
          className="refresh"
          disabled={!offset}
          onClick={() => set(offset - 25)}
        >
          Previous
        </button>
        <button
          className="refresh"
          disabled={!more}
          onClick={() => set(offset + 25)}
        >
          Next
        </button>
      </div>
    )
  );
}
const date = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
export function AssessmentHistory() {
  const [offset, set] = useState(0);
  return (
    <Read
      path={
        "/api/v1/assessments?offset=" + offset
      }
      schema={assessments}
    >
      {(data) => (
        <>
          {data.items.length === 0 && (
            <p>
              No assessments yet. Open a website to start a security scan.
            </p>
          )}
          {data.items.map((row) => (
            <article className="ledger-entry" key={row.id}>
              <Link className="entry-title" href={"/assessments/" + row.id}>
                {row.website}, {date(row.requestedAt)}
              </Link>
              <p>
                <strong>{statusLabel(row.status)}</strong>
                {row.findingCount !== null &&
                  ` · ${row.findingCount} ${row.findingCount === 1 ? "finding" : "findings"}`}
              </p>
              <p className="facts-line">{row.targetUrlSnapshot}</p>
              {row.status === "COMPLETED" && row.targetId && (
                <p className="row-links">
                  <Link href={`/targets/${row.targetId}/analysis?assessment=${row.id}`}>AI Analysis</Link>
                  <Link href={`/targets/${row.targetId}/reports?assessment=${row.id}`}>Report</Link>
                </p>
              )}
            </article>
          ))}
          <Pager offset={offset} set={set} more={data.hasMore} />
        </>
      )}
    </Read>
  );
}
function Runs({
  kind,
  assessmentId,
}: {
  kind: "spider" | "active";
  assessmentId?: string;
}) {
  const [revision, refresh] = useState(0);
  const [selected, select] = useState<string | null>(null);
  return (
    <section className="registry">
      <h3>{kind === "spider" ? "Spider discovery" : "Active scans"}</h3>
      <button
        className="refresh"
        onClick={() => {
          select(null);
          refresh((n) => n + 1);
        }}
      >
        Refresh runs
      </button>
      <Read
        key={revision}
        path={"/api/v1/integrations/zap/scans?kind=" + kind}
        schema={scans}
      >
        {(data) => (
          <>
            <p>
              ZAP {data.provider.version} · {data.provider.endpoint}
            </p>
            {!data.runs.length && <p>No current runs listed.</p>}
            {data.runs.map((run, i) => (
              <p key={i}>
                ID {run.id ?? "unavailable"} · {run.state ?? "State unknown"} ·{" "}
                {run.progress === null
                  ? "Progress unavailable"
                  : run.progress + "%"}{" "}
                · {run.reportedOrigin ?? "Scope unavailable"}
                {assessmentId && run.id && (
                  <button className="refresh" onClick={() => select(run.id)}>
                    Observe run {run.id}
                  </button>
                )}
              </p>
            ))}
          </>
        )}
      </Read>
      {assessmentId && selected && (
        <>
          <ObservedRun
            key={selected}
            kind={kind}
            assessmentId={assessmentId}
            scanId={selected}
          />
          <button className="refresh" onClick={() => select(null)}>
            Stop observing
          </button>
        </>
      )}
    </section>
  );
}
export function RecordsPage({
  view,
  id,
}: {
  view: "assessments" | "findings";
  id?: string;
}) {
  const [revision, refreshDetail] = useState(0);
  const detailSchema = useMemo(() => detailFor(id ?? ""), [id]);
  const title = id
    ? "Assessment details"
    : view === "findings"
      ? "Findings"
      : "Assessments";
  return (
    <>
      <Navigation section={view} />
      <main id="main" className="assessment-page">
        {id && (
          <nav className="mast" aria-label="Breadcrumb">
            <span>
              <Link href="/assessments">Assessments</Link> <b aria-hidden="true">/</b>{" "}
              <strong>Assessment details</strong>
            </span>
          </nav>
        )}
        <header className="workspace-head">
          <div>
            <h1>{title}</h1>
            <p>
              {id
                ? "What happened in this assessment, and where its results are."
                : view === "assessments"
                  ? "Every assessment of your websites, newest first."
                  : "Original scanner records from completed assessments. For explanations, open a website's AI Analysis."}
            </p>
          </div>
        </header>
        {id ? (
          <Read
            path={"/api/v1/assessments/" + encodeURIComponent(id)}
            key={revision}
            schema={detailSchema}
          >
            {(row) => {
              const closed = ["COMPLETED", "FAILED", "CANCELLED"].includes(row.status);
              const demo = row.targetUrlSnapshot === "http://juice-shop:3000/";
              return (
                <>
                  <section className="registry" aria-labelledby="assessment-title">
                    <h2 id="assessment-title">{row.website}</h2>
                    <p>
                      <strong>{statusLabel(row.status)}</strong>
                      {row.findingCount !== null &&
                        ` · ${row.findingCount} ${row.findingCount === 1 ? "finding" : "findings"} recorded`}
                    </p>
                    {row.outcomeExplanation && <p>{row.outcomeExplanation}</p>}
                    {row.findingCount === null && (
                      <p>Final results are unavailable for this assessment.</p>
                    )}
                    <p className="facts-line">
                      {row.targetUrlSnapshot} · Requested {date(row.requestedAt)} · First observed running:{" "}
                      {row.startedAt ? date(row.startedAt) : "unrecorded"} · Finished:{" "}
                      {row.finishedAt ? date(row.finishedAt) : "unrecorded"}
                    </p>
                    <p className="facts-line">Assessment {row.id}</p>
                    {row.targetId && (
                      <p className="row-links">
                        <Link href={"/targets/" + row.targetId}>Open the website</Link>
                        {row.status === "COMPLETED" && (
                          <>
                            <Link href={`/targets/${row.targetId}/analysis?assessment=${row.id}`}>
                              Read the AI Analysis
                            </Link>
                            <Link href={`/targets/${row.targetId}/findings?assessment=${row.id}`}>
                              Technical findings
                            </Link>
                          </>
                        )}
                      </p>
                    )}
                  </section>
                  {!closed && row.status !== "PENDING" && (
                    <ScanProgress id={id} onChanged={() => refreshDetail((n) => n + 1)} />
                  )}
                  <ReportActions id={id} status={row.status} />
                  {row.findingCount !== null && <AssessmentSummary id={id} evidence={row.evidence} />}
                  <details className="disclosure" open={!closed}>
                    <summary>Advanced: scanner records and manual operation</summary>
                    <RunReceipts
                      id={id}
                      canAssociate={demo}
                      onUpdated={() => refreshDetail((n) => n + 1)}
                    />
                    <h2>Scanner runs</h2>
                    <p>
                      These runs belong to the configured scanner. They are linked only after their identity
                      and scope are verified.
                    </p>
                    <Runs kind="spider" assessmentId={demo ? id : undefined} />
                    <Runs kind="active" assessmentId={demo ? id : undefined} />
                  </details>
                </>
              );
            }}
          </Read>
        ) : view === "assessments" ? (
          <AssessmentHistory />
        ) : (
          <>
            <h2 className="visually-hidden">Technical findings</h2>
            <TechnicalView />
          </>
        )}
      </main>
    </>
  );
}
