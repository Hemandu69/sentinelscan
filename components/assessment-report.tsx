"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadReport } from "../lib/report";
import "./assessment-report.css";

export function AssessmentReport({ id }: { id: string }) {
  const [revision, refresh] = useState(0);
  const [report, setReport] =
    useState<Awaited<ReturnType<typeof loadReport>>>();
  const [error, setError] = useState("");
  useEffect(() => {
    const control = new AbortController();
    loadReport(id, control.signal)
      .then((value) => {
        if (!control.signal.aborted) setReport(value);
      })
      .catch((cause: unknown) => {
        if (!control.signal.aborted)
          setError(
            cause instanceof Error && cause.name !== "ZodError"
              ? cause.message
              : "The API returned an incomplete report.",
          );
      });
    return () => control.abort();
  }, [id, revision]);
  const groups = new Map(
    (report?.assessment.severities ?? []).map((group) => [
      group.severity,
      group.count,
    ]),
  );
  const labels = [
    ...new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", ...groups.keys()]),
  ];
  return (
    <main className="assessment-report">
      <nav aria-label="Report actions">
        <Link href={"/assessments/" + encodeURIComponent(id)}>
          Back to assessment
        </Link>
        {report && (
          <button className="primary" onClick={() => window.print()}>
            Print or save PDF
          </button>
        )}
      </nav>
      <header>
        <p>SentinelScan · The Watchtower</p>
        <h1>Security assessment report</h1>
      </header>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setError("");
              refresh((n) => n + 1);
            }}
          >
            Retry
          </button>
        </p>
      ) : !report ? (
        <p role="status">Collecting all recorded findings…</p>
      ) : (
        <>
          <h2>{report.assessment.website}</h2>
          <p>{report.assessment.targetUrlSnapshot}</p>
          <p>
            Assessment {id}
            <br />
            Completed {new Date(report.assessment.finishedAt!).toLocaleString()}
          </p>
          <h2>
            {report.items.length} recorded{" "}
            {report.items.length === 1 ? "finding" : "findings"}
          </h2>
          <dl>
            {labels.map((label) => (
              <div key={label}>
                <dt>{label === "INFO" ? "Informational" : label}</dt>
                <dd>{groups.get(label) ?? 0}</dd>
              </div>
            ))}
          </dl>
          {report.items.map((row) => (
            <article key={row.id}>
              <h3>{row.name}</h3>
              <p>
                {row.normalizedSeverity} · {row.confidence} confidence
              </p>
              <p>
                {row.method} {row.url}
                {row.parameter && <> · Parameter {row.parameter}</>}
              </p>
              <p>{row.description}</p>
              <h4>Recommended fix</h4>
              <p>
                {row.remediation || "The provider supplied no remediation."}
              </p>
              {(row.cweId !== null || row.wascId !== null) && (
                <p>
                  {row.cweId !== null && "CWE-" + row.cweId}{" "}
                  {row.wascId !== null && "WASC-" + row.wascId}
                </p>
              )}
            </article>
          ))}
        </>
      )}
    </main>
  );
}
