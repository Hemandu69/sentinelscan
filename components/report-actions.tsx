"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { describeError, request, requestPdf } from "../lib/api";
import { dateTime as date } from "../lib/format";
import { reportsFor, unavailableReason, type ReportState } from "../lib/reports";
import "./report-actions.css";

type Action = "generate" | "download" | "preview";

export function ReportActions({
  id,
  status,
  heading = "Report",
}: {
  id: string;
  status: string;
  heading?: string;
}) {
  const base = "/api/v1/assessments/" + encodeURIComponent(id) + "/reports";
  const schema = useMemo(() => reportsFor(id), [id]);
  const done = status === "COMPLETED";
  const [state, setState] = useState<ReportState>();
  const [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState<Action>(),
    [revision, reload] = useState(0);
  const [preview, setPreview] = useState<{ url: string; title: string }>();
  const control = useRef<AbortController | null>(null),
    locked = useRef(false);
  useEffect(() => {
    if (!done) return;
    const ctrl = new AbortController();
    request(base, ctrl.signal)
      .then((body) => schema.parse(body))
      .then((value) => {
        if (!ctrl.signal.aborted) {
          setState(value);
          setLoadError("");
        }
      })
      .catch((cause: unknown) => {
        if (!ctrl.signal.aborted) setLoadError("Report information could not be loaded. " + describeError(cause));
      });
    return () => ctrl.abort();
  }, [base, schema, done, revision]);
  useEffect(() => {
    const ctrl = new AbortController();
    control.current = ctrl;
    return () => ctrl.abort();
  }, []);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  async function run(action: Action, work: (signal: AbortSignal) => Promise<void>) {
    const signal = control.current?.signal;
    if (!signal || locked.current) return;
    locked.current = true;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await work(signal);
    } catch (cause) {
      if (!signal.aborted) {
        setError(describeError(cause));
        // Availability may have changed, for example when a file went missing.
        if (action !== "generate") reload((n) => n + 1);
      }
    } finally {
      locked.current = false;
      if (!signal.aborted) setBusy(undefined);
    }
  }
  const generate = () =>
    run("generate", async (signal) => {
      const value = schema.parse(await request(base, signal, {}));
      setState(value);
      setPreview(undefined);
      setNotice("A new report is ready.");
    });
  const download = (reportId: string, filename: string) =>
    run("download", async (signal) => {
      const url = URL.createObjectURL(await requestPdf(`${base}/${reportId}/pdf`, signal));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice("Download started: " + filename);
    });
  const show = (reportId: string, generatedAt: string) =>
    run("preview", async (signal) => {
      const url = URL.createObjectURL(await requestPdf(`${base}/${reportId}/pdf?view=preview`, signal));
      setPreview({ url, title: "Report generated " + date(generatedAt) });
    });

  const ready = state?.reports.find((row) => row.available);
  const missing = state && state.reports.length > 0 && !ready;
  const older = state?.reports.filter((row) => row.available && row.id !== ready?.id) ?? [];
  return (
    <section className="registry report-actions" aria-labelledby="report-title">
      <h2 id="report-title">{heading}</h2>
      {!done ? (
        <p>No report is available. {unavailableReason(status)}</p>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          {loadError && (
            <p role="alert">
              {loadError}{" "}
              {!state && (
                <button className="refresh" onClick={() => reload((n) => n + 1)}>
                  Retry
                </button>
              )}
            </p>
          )}
          {!state && !loadError && <p role="status">Checking for reports…</p>}
          {state &&
            (ready ? (
              <p>
                <strong>PDF report available.</strong> Last generated{" "}
                <time dateTime={ready.generatedAt}>{date(ready.generatedAt)}</time>
                {ready.pages !== null && ` · ${ready.pages} ${ready.pages === 1 ? "page" : "pages"}`}
                {ready.size !== null && ` · ${Math.ceil(ready.size / 1024)} KB`}
                {ready.outdated && ". A newer layout or analysis exists. Regenerate it to include the changes"}.
              </p>
            ) : (
              <p>
                {missing
                  ? "The stored report file is missing or damaged. Generate a new report."
                  : "No PDF report has been generated yet."}
              </p>
            ))}
          {state && (
            <div className="dialog-actions">
              {ready && (
                <>
                  <button
                    className="primary"
                    disabled={Boolean(busy)}
                    onClick={() => void download(ready.id, ready.filename)}
                  >
                    {busy === "download" ? "Downloading…" : "Download PDF Report"}
                  </button>
                  <button
                    className="refresh"
                    disabled={Boolean(busy)}
                    onClick={() => void show(ready.id, ready.generatedAt)}
                  >
                    {busy === "preview" ? "Opening…" : "Preview Report"}
                  </button>
                </>
              )}
              <button
                className={ready ? "refresh" : "primary"}
                disabled={Boolean(busy)}
                onClick={() => void generate()}
              >
                {busy === "generate" ? "Generating…" : ready ? "Regenerate Report" : "Generate Report"}
              </button>
              <Link className="detail-link" href={"/assessments/" + id + "/report"}>
                Open report page
              </Link>
            </div>
          )}
          {busy === "generate" && <p role="status">Generating the PDF. This can take up to a minute.</p>}
          {notice && <p role="status">{notice}</p>}
          {preview && (
            <div className="report-preview">
              <div className="dialog-head">
                <h3>{preview.title}</h3>
                <button className="refresh" onClick={() => setPreview(undefined)}>
                  Close preview
                </button>
              </div>
              <iframe src={preview.url} title={preview.title} />
              <p className="hint">If your browser cannot show PDF files here, download the report instead.</p>
            </div>
          )}
          {older.length > 0 && (
            <details className="disclosure">
              <summary>Earlier reports ({older.length})</summary>
              <ul className="plain">
                {older.map((row) => (
                  <li key={row.id}>
                    {date(row.generatedAt)}
                    {row.pages !== null && ` · ${row.pages} ${row.pages === 1 ? "page" : "pages"}`}{" "}
                    <button
                      className="refresh"
                      disabled={Boolean(busy)}
                      onClick={() => void download(row.id, row.filename)}
                      aria-label={"Download report from " + date(row.generatedAt)}
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
