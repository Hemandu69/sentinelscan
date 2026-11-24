"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { describeError, readSites, request, type Site } from "../lib/api";
import { dateTime as date } from "../lib/format";
import { assessments, statusLabel } from "../lib/records";
import { summarize } from "../lib/issues";
import { scanPolicy } from "../lib/scans";
import { Navigation } from "./navigation";
import { AnalysisView, TechnicalView, useIssues } from "./issues";
import { AssessmentComparison } from "./comparison";
import { ReportActions } from "./report-actions";
import { ScanProgress } from "./scan-progress";
import { StartScanDialog } from "./start-scan";
import { RecordDialog } from "./website-detail";
import "./workspace.css";

export type Section = "overview" | "scans" | "analysis" | "findings" | "reports";
export const sections: [Section, string, string][] = [
  ["overview", "Overview", ""],
  ["scans", "Security Scans", "/scans"],
  ["analysis", "AI Analysis", "/analysis"],
  ["findings", "Findings", "/findings"],
  ["reports", "Reports", "/reports"],
];
type Row = z.infer<typeof assessments>["items"][number];
type Data = { sites: Site[]; rows: Row[]; more: boolean; policy: z.infer<typeof scanPolicy> };

function HistoryTable({ rows, targetId }: { rows: Row[]; targetId: string }) {
  if (!rows.length) return <p>No assessments yet. Start a security scan to create the first one.</p>;
  return (
    <div className="table-wrap" role="region" aria-label="Assessment history" tabIndex={0}>
      <table className="history">
        <thead>
          <tr>
            <th scope="col">Requested</th>
            <th scope="col">Status</th>
            <th scope="col">Findings</th>
            <th scope="col">Results</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={"/assessments/" + row.id}>{date(row.requestedAt)}</Link>
              </td>
              <td>{statusLabel(row.status)}</td>
              <td>{row.findingCount ?? "Not available"}</td>
              <td>
                {row.status === "COMPLETED" ? (
                  <span className="row-links">
                    <Link href={`/targets/${targetId}/analysis?assessment=${row.id}`}>AI Analysis</Link>
                    <Link href={`/targets/${targetId}/findings?assessment=${row.id}`}>Findings</Link>
                    <Link href={`/targets/${targetId}/reports?assessment=${row.id}`}>Report</Link>
                  </span>
                ) : (
                  <Link href={"/assessments/" + row.id}>Details</Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function LatestSummary({ row, targetId }: { row: Row; targetId: string }) {
  const { data, error, reload } = useIssues(row.id);
  if (error)
    return (
      <p role="alert">
        {error}{" "}
        <button className="refresh" onClick={reload}>
          Retry
        </button>
      </p>
    );
  if (!data) return <p role="status">Reading the latest results…</p>;
  return (
    <>
      <p>
        <strong>{summarize(data).headline}</strong>
      </p>
      <p>
        {data.counts.issues} {data.counts.issues === 1 ? "issue" : "issues"} at {data.counts.endpoints}{" "}
        {data.counts.endpoints === 1 ? "location" : "locations"}. AI analysis: {data.coverage.analysed} of{" "}
        {data.counts.issues}.
      </p>
      <p className="row-links">
        <Link href={`/targets/${targetId}/analysis?assessment=${row.id}`}>Read the AI Analysis</Link>
        <Link href={`/targets/${targetId}/reports?assessment=${row.id}`}>Get the report</Link>
      </p>
    </>
  );
}
export function Workspace({ id, section, assessment }: { id: string; section: Section; assessment?: string }) {
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ data?: Data; error?: string }>();
  const [watched, watch] = useState<string>();
  const [dialog, setDialog] = useState<"scan" | "record" | null>(null);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const control = new AbortController();
    Promise.all([
      request("/api/v1/targets", control.signal).then(readSites),
      request("/api/v1/assessments?offset=0&targetId=" + encodeURIComponent(id), control.signal).then((body) =>
        assessments.parse(body),
      ),
      request("/api/v1/scans/policy", control.signal).then((body) => scanPolicy.parse(body)),
    ])
      .then(([sites, list, policy]) => {
        if (!control.signal.aborted)
          setResult({ data: { sites, rows: list.items, more: list.hasMore, policy } });
      })
      .catch((cause: unknown) => {
        if (!control.signal.aborted) setResult((old) => ({ data: old?.data, error: describeError(cause) }));
      });
    return () => control.abort();
  }, [id, revision]);
  const data = result?.data;
  const site = data?.sites.find((row) => row.id === id);
  const rows = data?.rows ?? [];
  const completed = rows.filter((row) => row.status === "COMPLETED");
  const requested = assessment ? rows.find((row) => row.id === assessment) : undefined;
  const selected = assessment ? completed.find((row) => row.id === assessment) : completed[0];
  const latest = rows[0];
  const approved = Boolean(site && data?.policy.approvedTargets.includes(site.canonicalUrl));
  const label = sections.find(([key]) => key === section)![1];
  const open = (row?: Row) => row && !["COMPLETED", "FAILED", "CANCELLED", "PENDING"].includes(row.status);
  const followed = section === "scans" ? (requested ?? rows.find((row) => row.id === watched) ?? (open(latest) ? latest : undefined)) : undefined;
  const start = approved && (
    <button className="primary" onClick={() => setDialog("scan")}>
      Start New Security Scan
    </button>
  );
  const unavailable = site && !approved && (
    <p className="not-ready">
      This website is registered for reference only. SentinelScan scans the local Juice Shop demo,{" "}
      {data!.policy.approvedTargets.join(", ")}.
    </p>
  );
  const picker = completed.length > 0 && (
    <label className="picker">
      Assessment{" "}
      <select
        value={selected?.id ?? ""}
        onChange={(e) => router.push(`/targets/${id}/${section}?assessment=${e.target.value}`)}
      >
        {!selected && <option value="">Choose an assessment</option>}
        {completed.map((row) => (
          <option key={row.id} value={row.id}>
            {date(row.requestedAt)} · {row.findingCount} {row.findingCount === 1 ? "finding" : "findings"}
          </option>
        ))}
      </select>
    </label>
  );
  const needsAssessment = (content: (row: Row) => React.ReactNode) => (
    <>
      {picker}
      {assessment && !selected && (
        <p role="status">
          {requested
            ? "This assessment has no verified results yet."
            : "This assessment does not belong to this website or is not among its latest 25."}
        </p>
      )}
      {selected ? (
        content(selected)
      ) : (
        !assessment && <p>No completed assessment yet. {approved && "Start a security scan to get results."}</p>
      )}
    </>
  );
  return (
    <>
      <Navigation section="websites" />
      <main id="main" className="workspace">
        <nav className="mast" aria-label="Breadcrumb">
          <span>
            <Link href="/websites">Websites</Link> <b aria-hidden="true">/</b>{" "}
            {section === "overview" ? (
              <strong>{site?.displayName ?? "Website"}</strong>
            ) : (
              <>
                <Link href={"/targets/" + id}>{site?.displayName ?? "Website"}</Link> <b aria-hidden="true">/</b>{" "}
                <strong>{label}</strong>
              </>
            )}
          </span>
        </nav>
        <header className="workspace-head">
          <div>
            <h1>{site?.displayName ?? "Website"}</h1>
            {site && <code>{site.canonicalUrl}</code>}
          </div>
          {section === "overview" && start}
        </header>
        <nav className="tabs" aria-label="Website sections">
          {sections.map(([key, name, path]) => (
            <Link
              key={key}
              href={"/targets/" + id + path + (assessment && key !== "overview" && key !== "scans" ? "?assessment=" + assessment : "")}
              aria-current={key === section ? "page" : undefined}
            >
              {name}
            </Link>
          ))}
        </nav>
        {result?.error && (
          <p role="alert">
            This website could not be loaded. {result.error}{" "}
            <button className="refresh" onClick={reload}>
              Retry
            </button>
          </p>
        )}
        {!result && <p role="status">Loading the website…</p>}
        {data && !site && <p role="alert">This website is not registered or has been archived.</p>}
        {data && site && (
          <>
            {section === "overview" && (
              <>
                {unavailable}
                <div className="record">
                  <section aria-labelledby="latest-title">
                    <h2 id="latest-title">Latest result</h2>
                    {completed[0] ? (
                      <LatestSummary row={completed[0]} targetId={id} />
                    ) : (
                      <p>No completed assessment yet.</p>
                    )}
                  </section>
                  <section aria-labelledby="about-title">
                    <h2 id="about-title">About this website</h2>
                    <dl>
                      <dt>Address</dt>
                      <dd>
                        <code>{site.canonicalUrl}</code>
                      </dd>
                      <dt>Registered</dt>
                      <dd>{date(site.createdAt)}</dd>
                      <dt>Last assessment</dt>
                      <dd>{latest ? `${statusLabel(latest.status)}, requested ${date(latest.requestedAt)}` : "None yet"}</dd>
                      <dt>Last scan observed</dt>
                      <dd>
                        {(() => {
                          const seen = rows.find((row) => row.startedAt);
                          return seen ? date(seen.startedAt!) : "None yet";
                        })()}
                      </dd>
                    </dl>
                  </section>
                </div>
                <section className="registry" aria-labelledby="history-title">
                  <h2 id="history-title">Recent assessments</h2>
                  <HistoryTable rows={rows.slice(0, 5)} targetId={id} />
                  {rows.length > 5 && <Link className="detail-link" href={`/targets/${id}/scans`}>See all assessments</Link>}
                </section>
              </>
            )}
            {section === "scans" && (
              <>
                <h2>Security Scans</h2>
                {unavailable}
                {start && <p>{start}</p>}
                {assessment && !requested && <p role="status">That assessment is not among the latest 25 of this website.</p>}
                {followed && (
                  <ScanProgress
                    key={followed.id}
                    id={followed.id}
                    onChanged={() => {
                      // Keep the panel after the scan ends, so its outcome stays visible.
                      watch(followed.id);
                      reload();
                    }}
                  />
                )}
                <section className="registry" aria-labelledby="all-title">
                  <h2 id="all-title">Assessment history</h2>
                  <HistoryTable rows={rows} targetId={id} />
                  {data.more && <p className="hint">Showing the latest 25. <Link href="/assessments">All assessments</Link></p>}
                </section>
                <section className="registry" aria-labelledby="compare-title">
                  <h2 id="compare-title">Compare assessments</h2>
                  <AssessmentComparison completed={completed} />
                </section>
                <details className="disclosure">
                  <summary>Advanced: record an assessment without scanning</summary>
                  <p>For operators who run ZAP themselves. This records your authorization only.</p>
                  <button className="refresh" onClick={() => setDialog("record")}>
                    Create assessment record
                  </button>
                </details>
              </>
            )}
            {section === "analysis" && (
              <>
                <h2>AI Analysis</h2>
                <p className="lead">What the scan found, in plain language, and what to do about it.</p>
                {needsAssessment((row) => (
                  <AnalysisView assessmentId={row.id} targetId={id} />
                ))}
              </>
            )}
            {section === "findings" && (
              <>
                <h2>Findings</h2>
                <p className="lead">
                  Original scanner records for advanced use. For explanations, see{" "}
                  <Link href={`/targets/${id}/analysis${selected ? "?assessment=" + selected.id : ""}`}>AI Analysis</Link>.
                </p>
                {needsAssessment((row) => (
                  <TechnicalView assessmentId={row.id} />
                ))}
              </>
            )}
            {section === "reports" && (
              <>
                <h2>Reports</h2>
                <p className="lead">PDF reports of completed assessments.</p>
                {needsAssessment((row) => (
                  <ReportActions key={row.id} id={row.id} status={row.status} heading={"Assessment of " + date(row.requestedAt)} />
                ))}
              </>
            )}
          </>
        )}
        {dialog === "scan" && data && (
          <StartScanDialog
            targetId={id}
            policy={data.policy}
            close={() => setDialog(null)}
            started={(newId) => {
              setDialog(null);
              reload();
              router.push(`/targets/${id}/scans?assessment=${newId}`);
            }}
          />
        )}
        {dialog === "record" && (
          <RecordDialog
            targetId={id}
            close={() => setDialog(null)}
            created={(newId) => {
              setDialog(null);
              router.push("/assessments/" + newId);
            }}
          />
        )}
      </main>
    </>
  );
}
