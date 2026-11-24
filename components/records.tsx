"use client";
import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { z } from "zod";
import { dateTime as date } from "../lib/format";
import { severityName } from "../lib/issues";
import {
  detailFor,
  assessments,
  statusLabel,
} from "../lib/records";
import { Navigation } from "./navigation";
import { TechnicalView } from "./issues";
import { ScanProgress } from "./scan-progress";
import "./workspace.css";
import { ReportActions } from "./report-actions";
import { RunReceipts } from "./run-receipts";
import { useRead } from "./use-read";

function Read<T>({
  path,
  schema,
  children,
}: {
  path: string;
  schema: z.ZodType<T>;
  children: (value: T, reload: () => void) => ReactNode;
}) {
  const parse = useCallback((body: unknown) => schema.parse(body), [schema]);
  const { data, error, reload } = useRead(path, parse);
  if (error && data === undefined)
    return (
      <p role="alert">
        These records could not be loaded. {error}{" "}
        <button className="refresh" onClick={reload}>
          Retry
        </button>
      </p>
    );
  if (data === undefined) return <p role="status">Loading records…</p>;
  return (
    <>
      {error && <p role="alert">These records could not be refreshed. {error}</p>}
      {children(data, reload)}
    </>
  );
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
function AssessmentHistory() {
  const [offset, set] = useState(0);
  return (
    <Read
      path={"/api/v1/assessments?offset=" + offset}
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
export function RecordsPage({
  view,
  id,
}: {
  view: "assessments" | "findings";
  id?: string;
}) {
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
            schema={detailSchema}
          >
            {(row, reload) => {
              const closed = ["COMPLETED", "FAILED", "CANCELLED"].includes(row.status);
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
                    {row.severities && row.severities.length > 0 && (
                      <p>
                        {row.severities.map(({ severity, count }) => `${severityName(severity)} ${count}`).join(" · ")}
                      </p>
                    )}
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
                    <ScanProgress id={id} onChanged={reload} />
                  )}
                  <ReportActions id={id} status={row.status} />
                  <details className="disclosure" open={!closed}>
                    <summary>Advanced: saved scan records</summary>
                    <RunReceipts id={id} onUpdated={reload} />
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
