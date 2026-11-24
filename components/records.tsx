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
import { AssessmentSummary, IssuesView } from "./issues";
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
const date = (s: string) => new Date(s).toLocaleString();
export function AssessmentHistory({ targetId }: { targetId?: string }) {
  const [offset, set] = useState(0);
  return (
    <Read
      path={
        "/api/v1/assessments?offset=" +
        offset +
        (targetId ? "&targetId=" + encodeURIComponent(targetId) : "")
      }
      schema={assessments}
    >
      {(data) => (
        <>
          {data.items.length === 0 && (
            <p>
              No security checks on this page. Create a check from Website
              Details.
            </p>
          )}
          {data.items.map((row) => (
            <article className="ledger-entry" key={row.id}>
              <Link href={"/assessments/" + row.id}>{row.website}</Link>
              <p>{row.targetUrlSnapshot}</p>
              <small>{row.id}</small>
              <p>
                {statusLabel(row.status)} · Requested {date(row.requestedAt)}
                {row.findingCount !== null &&
                  " · Findings: " + row.findingCount}
              </p>
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
      <h3>{kind === "spider" ? "Spider discovery" : "Active checks"}</h3>
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
      <main id="main">
        <header className="hero detail-hero">
          <div className="art" aria-hidden="true" />
          <div className="hero-copy">
            <h1>{title}</h1>
            <p>
              {id
                ? "Review this check and its recorded results."
                : view === "assessments"
                  ? "Security checks requested for your websites."
                  : "What your completed checks found, and what to do next."}
            </p>
          </div>
        </header>
        {id ? (
          <Read
            path={"/api/v1/assessments/" + encodeURIComponent(id)}
            key={revision}
            schema={detailSchema}
          >
            {(row) => (
              <>
                <section className="registry">
                  <h2>{row.website}</h2>
                  {row.outcomeExplanation && <p>{row.outcomeExplanation}</p>}
                  <p>{row.targetUrlSnapshot}</p>
                  <small>{row.id}</small>
                  <p>
                    {statusLabel(row.status)} · Requested{" "}
                    {date(row.requestedAt)}
                  </p>
                  <p>
                    First observed running:{" "}
                    {row.startedAt ? date(row.startedAt) : "Unrecorded"} ·
                    Finished:{" "}
                    {row.finishedAt ? date(row.finishedAt) : "Unrecorded"}
                  </p>
                </section>
                {row.findingCount !== null && (
                  <AssessmentSummary id={id} evidence={row.evidence} />
                )}
                <RunReceipts
                  id={id}
                  canAssociate={
                    row.targetUrlSnapshot === "http://juice-shop:3000/"
                  }
                  onUpdated={() => refreshDetail((n) => n + 1)}
                />
                <h2>Provider runs</h2>
                <p>
                  These runs belong to the configured daemon. Linking requires
                  verified run identity and authorized scope.
                </p>
                <Runs
                  kind="spider"
                  assessmentId={
                    row.targetUrlSnapshot === "http://juice-shop:3000/"
                      ? id
                      : undefined
                  }
                />
                <Runs
                  kind="active"
                  assessmentId={
                    row.targetUrlSnapshot === "http://juice-shop:3000/"
                      ? id
                      : undefined
                  }
                />
                <h2>Recorded findings</h2>
                {row.findingCount === null ? (
                  <p>Final results are unavailable for this check.</p>
                ) : (
                  <>
                    <p>
                      {row.findingCount} recorded. Raw scanner records stay available
                      under each issue.
                    </p>
                    <Link href={"/assessments/" + row.id + "/report"}>Open printable assessment report</Link>
                    {row.severities?.map((group) => (
                      <p key={group.severity}>
                        {group.severity} · {group.count}
                      </p>
                    ))}
                    <IssuesView assessmentId={id} />
                  </>
                )}
              </>
            )}
          </Read>
        ) : view === "assessments" ? (
          <AssessmentHistory />
        ) : (
          <IssuesView />
        )}
      </main>
    </>
  );
}
