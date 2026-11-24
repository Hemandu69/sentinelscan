"use client";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { describeError, request } from "../lib/api";
import { dateTime } from "../lib/format";
import {
  analysisLabel,
  analysisStatus,
  disabledReason,
  explain,
  issue as issueSchema,
  issueList,
  actionGroup,
  actionGroups,
  originLabel,
  priorityName,
  severityName,
  summarize,
  type Issue,
  type IssueList,
} from "../lib/issues";
import { detailFor, type runEvidence } from "../lib/records";
import { useRead } from "./use-read";
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
const parseIssues = (body: unknown) => issueList.parse(body);
export const useIssues = (assessmentId?: string) =>
  useRead(
    "/api/v1/issues" + (assessmentId ? "?assessmentId=" + encodeURIComponent(assessmentId) : ""),
    parseIssues,
  );
function Facts({ row, open = false }: { row: Issue; open?: boolean }) {
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
    <details className="disclosure" open={open}>
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
              {dateTime(finding.firstObservedAt)}
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
        <p className="badges">
          <span className="badge-label">Scanner severity</span>{" "}
          <SeverityBadge value={row.scanner.severity} />
          {ai && (
            <>
              {" "}
              <span className="badge-label">AI priority</span>{" "}
              <span className="origin origin-ai">{priorityName(ai.practicalPriority)}</span>
            </>
          )}
        </p>
        <h4 className="issue-title" id={"issue-" + row.key}>{text.title}</h4>
        <p>{text.summary}</p>
        <p className="issue-meta">
          {row.endpoints.length} affected{" "}
          {row.endpoints.length === 1 ? "location" : "locations"} ·{" "}
          {analysisLabel(row.analysis.status)}
        </p>
        <p className="next-action">
          <strong>Next:</strong> {text.action}
        </p>
      </header>
      <details className="disclosure issue-details">
        <summary>Read the explanation</summary>
        <section>
          <h5>What happened</h5> <Origin kind={text.origin} />
          <p className="preline">{text.what}</p>
        </section>
        <section>
          <h5>Why it matters</h5>{" "}
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
          <h5>Affected locations</h5> <Origin kind="scanner" />
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
          <h5>How to fix it</h5>
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
          <h5>How to verify</h5>{" "}
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
          <h5>Confidence and limitations</h5>
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
                {row.analysis.analysedAt && dateTime(row.analysis.analysedAt)}.
                It may be wrong.
              </small>
            </>
          ) : (
            <p>No AI interpretation is included.</p>
          )}
        </section>
        <p>
          <Link
            className="detail-link"
            href={`/targets/${row.targetId}/findings?assessment=${row.assessmentId}`}
          >
            See the original scanner record
          </Link>
        </p>
      </details>
      {canAnalyse && row.analysis.status !== "COMPLETED" && (
        <button className="refresh" disabled={busy} onClick={() => void analyse()}>
          {busy
            ? "Analysing…"
            : row.analysis.status === "NONE"
              ? "Analyse with AI"
              : row.analysis.status === "STALE"
                ? "Update AI analysis"
                : "Try AI analysis again"}
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
const parseStatus = (body: unknown) => analysisStatus.parse(body);
const useAiStatus = () => useRead("/api/v1/analysis/status", parseStatus).data;
function LoadError({ error, reload }: { error: string; reload: () => void }) {
  return (
    <p role="alert">
      The results could not be loaded. {error}{" "}
      <button className="refresh" onClick={reload}>
        Retry
      </button>
    </p>
  );
}
function SeverityLine({ data }: { data: IssueList }) {
  return (
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
  );
}
// Plain-language analysis of one assessment. Raw scanner records are a separate page.
export function AnalysisView({ assessmentId, targetId }: { assessmentId: string; targetId: string }) {
  const { data, error, reload } = useIssues(assessmentId);
  const status = useAiStatus();
  const schema = useMemo(() => detailFor(assessmentId), [assessmentId]);
  const parseDetail = useCallback((body: unknown) => schema.parse(body), [schema]);
  const evidence = useRead("/api/v1/assessments/" + encodeURIComponent(assessmentId), parseDetail).data?.evidence;
  if (error) return <LoadError error={error} reload={reload} />;
  if (!data) return <p role="status">Loading the analysis…</p>;
  const unavailable = status ? disabledReason(status.reason, status.storageReady) : null;
  return (
    <>
      <section className="issue-overview assessment-summary" aria-labelledby="analysis-summary">
        <h3 id="analysis-summary">Assessment summary</h3>
        <SummaryText data={data} evidence={evidence} level="h4" />
        <IssueCounts data={data} />
        <SeverityLine data={data} />
        <p className="lead">
          Alerts that report the same thing are recorded once per location, then shown together as one
          issue. Alerts are not a count of vulnerabilities.
        </p>
      </section>
      <section className="ai-state" aria-labelledby="ai-state-title">
        <h3 id="ai-state-title">AI coverage</h3>
        <p>
          {data.coverage.analysed} of {data.counts.issues} analysed, {data.coverage.unanalysed} not analysed.
        </p>
        <p>
          {unavailable ? (
            <>
              <strong>Not configured.</strong> {unavailable} Explanations below come from SentinelScan guides
              or the scanner, as labelled.
            </>
          ) : (
            status?.enabled &&
            `Analysis runs only when you ask for it. It sends the sanitized alert, without page content or credentials, to ${status.provider}, which bills each request.`
          )}
        </p>
      </section>
      <h3>What to do, in order</h3>
      <p className="hint">
        Ordered by AI priority where an issue is analysed, otherwise by scanner severity. This is not a
        security score.
      </p>
      {!data.issues.length && (
        <p>The scan recorded no findings. That does not show that the website is secure.</p>
      )}
      {actionGroups.map(([key, title]) => {
        const rows = data.issues.filter((row) => actionGroup(row) === key);
        return (
          rows.length > 0 && (
            <section key={key} aria-label={title} className="action-group">
              <p className="group-title">
                {title} ({rows.length})
              </p>
              {rows.map((row) => (
                <IssueCard
                  key={row.key}
                  row={row}
                  canAnalyse={Boolean(status?.enabled && status.storageReady)}
                  onUpdated={reload}
                />
              ))}
            </section>
          )
        );
      })}
      <p>
        <Link className="detail-link" href={`/targets/${targetId}/findings?assessment=${assessmentId}`}>
          Open technical findings
        </Link>
      </p>
    </>
  );
}
// Original scanner records for advanced use. No AI text appears here.
export function TechnicalView({ assessmentId }: { assessmentId?: string }) {
  const { data, error, reload } = useIssues(assessmentId);
  const [q, search] = useState(""),
    [severity, filter] = useState("");
  if (error) return <LoadError error={error} reload={reload} />;
  if (!data) return <p role="status">Loading findings…</p>;
  const needle = q.trim().toLowerCase();
  const shown = data.issues.filter(
    (row) =>
      (!severity || row.scanner.severity === severity) &&
      (!needle ||
        [row.scanner.title, row.scanner.description, row.scanner.ruleId ?? "", ...row.endpoints].some((text) =>
          text.toLowerCase().includes(needle),
        )),
  );
  return (
    <>
      <IssueCounts data={data} />
      <SeverityLine data={data} />
      <div className="ledger-filters">
        <label>
          Search findings{" "}
          <input type="search" maxLength={120} value={q} onChange={(e) => search(e.target.value)} />
        </label>
        <label>
          Filter by severity{" "}
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
      {!data.issues.length && <p>No imported findings yet. Complete a security scan first.</p>}
      {data.issues.length > 0 && !shown.length && <p>No findings match this view.</p>}
      {shown.map((row) => (
        <article className="issue" key={row.key} aria-labelledby={"finding-" + row.key}>
          <SeverityBadge value={row.scanner.severity} />
          <h3 className="issue-title" id={"finding-" + row.key}>
            {row.scanner.title}
          </h3>
          <p className="issue-meta">
            Scanner severity {row.scanner.sourceSeverity} · {row.scanner.confidence} confidence ·{" "}
            {row.findings.length} {row.findings.length === 1 ? "record" : "records"} · {row.website}
          </p>
          <ul className="plain">
            {row.endpoints.map((url) => (
              <li key={url}>
                <code>
                  {row.scanner.method} {url}
                </code>
              </li>
            ))}
          </ul>
          <Facts row={row} open={shown.length === 1} />
          <p className="row-links">
            <Link href={`/targets/${row.targetId}/analysis?assessment=${row.assessmentId}`}>
              Read the explanation in AI Analysis
            </Link>
            <Link href={"/assessments/" + row.assessmentId}>Open the assessment</Link>
          </p>
        </article>
      ))}
    </>
  );
}
export function SummaryText({
  data,
  evidence,
  level: Heading = "h3",
}: {
  data: IssueList;
  evidence: z.infer<typeof runEvidence> | null | undefined;
  level?: "h3" | "h4";
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
          <Heading>Needs attention</Heading>
          {list(attention)}
        </>
      )}
      {informational.length > 0 && (
        <>
          <Heading>Informational observations</Heading>
          {list(informational)}
        </>
      )}
      <Heading>Not covered</Heading>
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
