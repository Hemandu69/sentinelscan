"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { describeError, request } from "../lib/api";
import {
  analysisLabel,
  analysisStatus,
  disabledReason,
  explain,
  issue as issueSchema,
  issueList,
  originLabel,
  priorityName,
  severityName,
  summarize,
  type Issue,
  type IssueList,
} from "../lib/issues";
import type { runEvidence } from "../lib/records";
import "./issues.css";

const markers: Record<string, string> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "informational",
};
export function SeverityBadge({ value }: { value: string }) {
  return (
    <span className="severity-badge">
      <i className={"marker " + (markers[value] ?? "informational")} aria-hidden="true" />
      {severityName(value)}
    </span>
  );
}
function Origin({ kind }: { kind: keyof typeof originLabel }) {
  return <span className={"origin origin-" + kind}>{originLabel[kind]}</span>;
}
export function useIssues(assessmentId?: string) {
  const [revision, setRevision] = useState(0);
  const key = (assessmentId ?? "") + "#" + revision;
  const [result, setResult] = useState<{ key: string; data?: IssueList; error?: string }>();
  useEffect(() => {
    const control = new AbortController();
    request(
      "/api/v1/issues" + (assessmentId ? "?assessmentId=" + encodeURIComponent(assessmentId) : ""),
      control.signal,
    )
      .then((body) => issueList.parse(body))
      .then((data) => {
        if (!control.signal.aborted) setResult({ key, data });
      })
      .catch((cause: unknown) => {
        if (!control.signal.aborted) setResult({ key, error: describeError(cause) });
      });
    return () => control.abort();
  }, [assessmentId, key]);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  return {
    // The previous list stays visible while a refresh is on its way.
    data: result?.data,
    error: result?.key === key ? result.error : undefined,
    reload,
  };
}
function Facts({ row }: { row: Issue }) {
  const { scanner } = row;
  const facts: [string, string | null][] = [
    ["Original alert", scanner.title],
    ["Scanner severity", scanner.sourceSeverity],
    ["Scanner confidence", scanner.confidence],
    ["Scanner rule", scanner.ruleId],
    ["HTTP method", scanner.method],
    ["Parameter or header", scanner.parameter],
    ["Evidence", scanner.evidence ?? "None supplied by the scanner"],
    ["Weakness", scanner.cweId ? "CWE-" + scanner.cweId : null],
    ["Threat class", scanner.wascId ? "WASC-" + scanner.wascId : null],
  ];
  return (
    <details className="disclosure">
      <summary>Technical evidence</summary>
      <p className="provenance">
        Recorded by OWASP ZAP and unchanged by SentinelScan.
      </p>
      <dl className="facts">
        {facts.map(
          ([label, value]) =>
            value && (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ),
        )}
      </dl>
      <p className="preline">{scanner.description}</p>
      {scanner.references.length > 0 && (
        <ul className="plain">
          {scanner.references.map((url) => (
            <li key={url}>
              <a href={url} rel="noreferrer noopener" target="_blank">
                {url}
              </a>
            </li>
          ))}
        </ul>
      )}
      <ul className="plain">
        {row.findings.map((finding) => (
          <li key={finding.id}>
            <small>
              Finding {finding.id} · {finding.url} · Recorded{" "}
              {new Date(finding.firstObservedAt).toLocaleString()}
            </small>
          </li>
        ))}
      </ul>
    </details>
  );
}
function IssueCard({
  row,
  canAnalyse,
  onUpdated,
}: {
  row: Issue;
  canAnalyse: boolean;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const text = explain(row);
  const ai = row.analysis.result;
  async function analyse() {
    setBusy(true);
    setError("");
    try {
      issueSchema.parse(
        await request(
          `/api/v1/assessments/${row.assessmentId}/issues/${row.key}/analysis`,
          new AbortController().signal,
          {},
        ),
      );
    } catch (cause) {
      setError(describeError(cause));
    }
    setBusy(false);
    onUpdated();
  }
  return (
    <article className="issue" aria-labelledby={"issue-" + row.key}>
      <header>
        <SeverityBadge value={row.scanner.severity} />
        <h2 id={"issue-" + row.key}>{text.title}</h2>
        <p>{text.summary}</p>
        <p className="issue-meta">
          {row.endpoints.length} affected{" "}
          {row.endpoints.length === 1 ? "location" : "locations"} ·{" "}
          {analysisLabel(row.analysis.status)} ·{" "}
          <Link href={"/assessments/" + row.assessmentId}>{row.website}</Link>
        </p>
        <p className="next-action">
          <strong>Next:</strong> {text.action}
        </p>
      </header>
      <details className="disclosure issue-details">
        <summary>Read the explanation</summary>
        <section>
          <h3>What happened</h3> <Origin kind={text.origin} />
          <p className="preline">{text.what}</p>
        </section>
        <section>
          <h3>Why it matters</h3>{" "}
          {text.why ? (
            <>
              <Origin kind={text.origin} />
              <p className="preline">{text.why}</p>
              {ai && <p className="preline">{ai.potentialImpact}</p>}
            </>
          ) : (
            <p>No explanation is available beyond the scanner&apos;s text.</p>
          )}
        </section>
        <section>
          <h3>Affected locations</h3> <Origin kind="scanner" />
          <ul className="plain">
            {row.endpoints.map((url) => (
              <li key={url}>
                <code>
                  {row.scanner.method} {url}
                </code>
              </li>
            ))}
          </ul>
          {row.scanner.parameter && <p>Part of the request: {row.scanner.parameter}</p>}
        </section>
        <section>
          <h3>How to fix it</h3>
          {ai ? (
            <>
              {" "}
              <Origin kind="ai" />
              {ai.remediation.length ? (
                <ol>
                  {ai.remediation.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : (
                <p>The analysis suggests no change for this observation.</p>
              )}
            </>
          ) : null}
          {row.scanner.remediation ? (
            <>
              {" "}
              <Origin kind="scanner" />
              <p className="preline">{row.scanner.remediation}</p>
            </>
          ) : (
            !ai && <p>The scanner supplied no fix for this alert.</p>
          )}
        </section>
        <section>
          <h3>How to verify</h3>{" "}
          {text.verify.length ? (
            <>
              <Origin kind={text.origin} />
              <ol>
                {text.verify.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          ) : (
            <p>Repeat the request described in the technical evidence and compare.</p>
          )}
        </section>
        <section>
          <h3>Confidence and limitations</h3>
          <p>
            The scanner rates this {row.scanner.sourceSeverity} with{" "}
            {row.scanner.confidence} confidence.
          </p>
          {ai ? (
            <>
              <p>
                <Origin kind="ai" /> Practical priority:{" "}
                <strong>{priorityName(ai.practicalPriority)}</strong>. {ai.priorityReason}{" "}
                This is an opinion, not the scanner&apos;s severity.
              </p>
              {!ai.evidenceSufficient && (
                <p>The analysis judged the supplied evidence insufficient for a firm conclusion.</p>
              )}
              <p className="preline">{ai.falsePositiveNotes}</p>
              <p className="preline">{ai.limitations}</p>
              <details className="disclosure">
                <summary>Technical explanation</summary>
                <p className="preline">{ai.technicalExplanation}</p>
              </details>
              <small>
                Generated by {row.analysis.provider} {row.analysis.model} on{" "}
                {row.analysis.analysedAt && new Date(row.analysis.analysedAt).toLocaleString()}.
                It may be wrong.
              </small>
            </>
          ) : (
            <p>No AI interpretation is included.</p>
          )}
        </section>
        <Facts row={row} />
      </details>
      {canAnalyse && row.analysis.status !== "COMPLETED" && (
        <button className="refresh" disabled={busy} onClick={() => void analyse()}>
          {busy ? "Analysing…" : row.analysis.status === "NONE" ? "Analyse with AI" : "Try AI analysis again"}
        </button>
      )}
      {busy && <p role="status">Analysing this issue. This can take a few minutes.</p>}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
export function IssueCounts({ data }: { data: IssueList }) {
  const { counts } = data;
  return (
    <dl className="issue-counts">
      {(
        [
          ["Original alerts", counts.originalAlerts === null ? "Not recorded" : String(counts.originalAlerts)],
          ["Imported findings", String(counts.findings)],
          ["Issues", String(counts.issues)],
          ["Affected locations", String(counts.endpoints)],
        ] as const
      ).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function IssuesView({ assessmentId }: { assessmentId?: string }) {
  const { data, error, reload } = useIssues(assessmentId);
  const [status, setStatus] = useState<z.infer<typeof analysisStatus>>();
  const [q, search] = useState(""),
    [severity, filter] = useState("");
  useEffect(() => {
    const control = new AbortController();
    request("/api/v1/analysis/status", control.signal)
      .then((body) => analysisStatus.parse(body))
      .then((value) => {
        if (!control.signal.aborted) setStatus(value);
      })
      .catch(() => {});
    return () => control.abort();
  }, []);
  if (error)
    return (
      <p role="alert">
        The issues could not be loaded. {error}{" "}
        <button className="refresh" onClick={reload}>
          Retry
        </button>
      </p>
    );
  if (!data) return <p role="status">Loading issues…</p>;
  const unavailable = status ? disabledReason(status.reason, status.storageReady) : null;
  const needle = q.trim().toLowerCase();
  const shown = data.issues.filter(
    (row) =>
      (!severity || row.scanner.severity === severity) &&
      (!needle ||
        [row.scanner.title, explain(row).title, explain(row).summary, ...row.endpoints].some((text) =>
          text.toLowerCase().includes(needle),
        )),
  );
  return (
    <>
      <section className="issue-overview" aria-label="Issue overview">
        <IssueCounts data={data} />
        <p className="lead">
          Alerts that report the same thing are recorded once per location, then shown together as one
          issue. Alerts are not a count of vulnerabilities.
        </p>
        <ul className="severity-line" aria-label="Issues by scanner severity">
          {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((key) => (
            <li key={key}>
              <SeverityBadge value={key} /> <strong>{data.severities[key] ?? 0}</strong>
            </li>
          ))}
          {(data.severities.OTHER ?? 0) > 0 && (
            <li>
              Other <strong>{data.severities.OTHER}</strong>
            </li>
          )}
        </ul>
        <p>
          AI analysis: {data.coverage.analysed} of {data.counts.issues} analysed,{" "}
          {data.coverage.unanalysed} not analysed.{" "}
          {unavailable ??
            (status?.enabled &&
              `Analysing sends the sanitized alert, without page content or credentials, to ${status.provider}.`)}
        </p>
      </section>
      <div className="ledger-filters">
        <label>
          Search issues{" "}
          <input type="search" maxLength={120} value={q} onChange={(e) => search(e.target.value)} />
        </label>
        <label>
          Scanner severity{" "}
          <select value={severity} onChange={(e) => filter(e.target.value)}>
            <option value="">All severities</option>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((key) => (
              <option key={key} value={key}>
                {severityName(key)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!data.issues.length && <p>No imported findings yet. Complete a security check first.</p>}
      {data.issues.length > 0 && !shown.length && <p>No issues match this view.</p>}
      {shown.map((row) => (
        <IssueCard
          key={row.key}
          row={row}
          canAnalyse={Boolean(status?.enabled && status.storageReady)}
          onUpdated={reload}
        />
      ))}
    </>
  );
}
export function SummaryText({
  data,
  evidence,
}: {
  data: IssueList;
  evidence: z.infer<typeof runEvidence> | null | undefined;
}) {
  const { attention, informational, headline } = summarize(data);
  const list = (rows: Issue[]) => (
    <ul>
      {rows.map((row) => (
        <li key={row.key}>
          {explain(row).title} ({row.endpoints.length}{" "}
          {row.endpoints.length === 1 ? "location" : "locations"}). {explain(row).action}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <p>
        <strong>{headline}</strong> This describes what the scanner reported. It does not show that the
        website is secure.
      </p>
      {attention.length > 0 && (
        <>
          <h3>Needs attention</h3>
          {list(attention)}
        </>
      )}
      {informational.length > 0 && (
        <>
          <h3>Informational observations</h3>
          {list(informational)}
        </>
      )}
      <h3>Not covered</h3>
      <ul>
        <li>DOM-based XSS (ZAP rule 40026) is excluded from the approved configuration.</li>
        <li>Passive alerts, such as missing security headers, are not imported.</li>
        {evidence &&
          evidence.active.skippedRules.map((reason) => <li key={reason}>One rule was skipped: {reason}.</li>)}
        <li>Pages that need a login, and areas the spider did not reach, were not tested.</li>
        <li>This is not full OWASP coverage.</li>
      </ul>
    </>
  );
}
export function AssessmentSummary({
  id,
  evidence,
}: {
  id: string;
  evidence: z.infer<typeof runEvidence> | null | undefined;
}) {
  const { data, error, reload } = useIssues(id);
  return (
    <section className="registry assessment-summary" aria-labelledby="summary-title">
      <h2 id="summary-title">Summary</h2>
      {error ? (
        <p role="alert">
          The summary could not be loaded. {error}{" "}
          <button className="refresh" onClick={reload}>
            Retry
          </button>
        </p>
      ) : data ? (
        <>
          <SummaryText data={data} evidence={evidence} />
          <IssueCounts data={data} />
        </>
      ) : (
        <p role="status">Loading the summary…</p>
      )}
    </section>
  );
}
