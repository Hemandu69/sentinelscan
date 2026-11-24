"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { describeError } from "../lib/api";
import { loadReport } from "../lib/report";
import "./assessment-report.css";

const time = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "long",
  });

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
            describeError(cause),
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
            Status {report.assessment.status}
            <br />
            Requested {time(report.assessment.requestedAt)}
            <br />
            First observed running{" "}
            {report.assessment.startedAt
              ? time(report.assessment.startedAt)
              : "unrecorded"}
            <br />
            Results verified and imported {time(report.assessment.finishedAt!)}
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
          {report.assessment.evidence ? (
            <section aria-labelledby="evidence">
              <h2 id="evidence">Verified run evidence</h2>
              <p>
                Spider {report.assessment.evidence.spider.scanId} completed
                naturally: {time(report.assessment.evidence.spider.startedAt)} to{" "}
                {time(report.assessment.evidence.spider.endedAt)},{" "}
                {report.assessment.evidence.spider.results} addresses, all on the
                authorized origin.
              </p>
              <p>
                Active scan {report.assessment.evidence.active.scanId} completed
                naturally: {time(report.assessment.evidence.active.startedAt)} to{" "}
                {time(report.assessment.evidence.active.endedAt)}.{" "}
                {report.assessment.evidence.active.completedRules} rules
                completed, {report.assessment.evidence.active.skippedRules.length}{" "}
                skipped
                {report.assessment.evidence.active.skippedRules.length > 0 &&
                  " (" +
                    report.assessment.evidence.active.skippedRules.join("; ") +
                    ")"}
                , {report.assessment.evidence.active.stoppedRules} stopped.
              </p>
              <p>
                ZAP attributed {report.assessment.evidence.active.alerts} alerts to
                this scan. After removing duplicates, {report.items.length}{" "}
                {report.items.length === 1 ? "finding is" : "findings are"}{" "}
                recorded.
              </p>
              <p>
                {report.assessment.evidence.active.requests} requests reported,{" "}
                {report.assessment.evidence.active.messages} stored messages, every
                message address on the authorized origin.
              </p>
              {report.assessment.evidence.reconciliations.map((item) => (
                <p key={item.ruleId}>
                  Approved exception, rule {item.ruleId} ({item.ruleName}):{" "}
                  {item.kind === "HOST_HEADER" ? (
                    <>
                      {item.acceptedDiscrepancy} requests to {item.targetOrigin}{" "}
                      carried a Host header forged by this rule, equal to its{" "}
                      {item.observedRequests} reported requests. Values:{" "}
                      {item.hostValues.join(", ")}. The header alone does not show
                      where a connection went; acceptance relies on the request
                      address, scan host, rule timing and exact count together.
                    </>
                  ) : (
                    <>
                      {item.acceptedDiscrepancy} raw-socket probes have no stored
                      message, equal to its {item.observedRequests} reported
                      requests. Their destination is supported only by the scan
                      host {item.targetOrigin} and the rule record.
                    </>
                  )}
                </p>
              ))}
              <p>
                Evidence contract {report.assessment.evidence.contract}, collected{" "}
                {time(report.assessment.evidence.collectedAt)}. Session{" "}
                {report.assessment.evidence.sessionKey}. Evidence SHA-256{" "}
                {report.assessment.evidence.digest}.
              </p>
            </section>
          ) : (
            <p role="alert">Verified run evidence is unavailable.</p>
          )}
          <section aria-labelledby="coverage">
            <h2 id="coverage">Coverage limits</h2>
            <ul>
              <li>
                DOM-based XSS testing (ZAP rule 40026) is excluded from the
                approved scanner configuration.
              </li>
              <li>
                Findings come only from alerts that ZAP attributed to this
                active scan. Passive alerts are not included. ZAP records at
                most 10 passive alerts per rule in this configuration.
              </li>
              <li>
                Duplicate alerts for the same rule, address, method and
                parameter are recorded once.
              </li>
              <li>
                This is not full OWASP coverage. Skipped rules and areas that the
                spider did not reach were not tested.
              </li>
              <li>
                The absence of a finding does not show that the website is
                secure.
              </li>
            </ul>
          </section>
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
