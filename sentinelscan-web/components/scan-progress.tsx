"use client";
import { useEffect, useRef, useState } from "react";
import { describeError, request } from "../lib/api";
import { statusLabel } from "../lib/records";
import { isEnded, reasonText, measured, outcomeText, scanState, stepState, steps, type ScanState } from "../lib/scans";

export function ScanProgress({ id, onChanged }: { id: string; onChanged: () => void }) {
  const base = "/api/v1/assessments/" + encodeURIComponent(id);
  const [state, setState] = useState<ScanState>(),
    [error, setError] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false),
    [revision, poll] = useState(0);
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  useEffect(() => {
    const control = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasLive = false;
    async function read() {
      try {
        const value = scanState.parse(await request(base + "/scan", control.signal));
        if (control.signal.aborted) return;
        setState(value);
        setError("");
        const live = value.tracked && !isEnded(value.stage);
        if (live) timer = setTimeout(read, 2500);
        else if (wasLive) changed.current();
        wasLive = live;
      } catch (cause) {
        if (control.signal.aborted) return;
        setError("Progress could not be read. " + describeError(cause) + " Trying again.");
        timer = setTimeout(read, 5000);
      }
    }
    void read();
    return () => {
      control.abort();
      clearTimeout(timer);
    };
  }, [base, revision]);
  async function act(work: () => Promise<unknown>, refresh: boolean) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await work();
    } catch (cause) {
      setActionError(describeError(cause));
    }
    setBusy(false);
    poll((n) => n + 1);
    if (refresh) changed.current();
  }
  if (!state) return <p role={error ? "alert" : "status"}>{error || "Reading scan progress…"}</p>;
  const live = state.tracked && !isEnded(state.stage);
  const percent = measured(state);
  const current = steps.find((step) => step.stage === state.stage);
  const counted = state.stage === "ACTIVE_RUNNING" ? state.active : state.stage === "SPIDER_RUNNING" ? state.spider : null;
  return (
    <section className="scan-progress" aria-labelledby={"progress-" + id}>
      <h2 id={"progress-" + id}>Scan progress</h2>
      {error && <p role="alert">{error}</p>}
      <p role="status" className="stage-line">
        {live ? (
          <>
            <strong>{current?.label}.</strong> {current?.detail}
            {state.cancelRequested && " A stop was requested and is being confirmed."}
          </>
        ) : state.tracked ? (
          outcomeText[state.stage!]
        ) : (
          <>
            SentinelScan is not following a scan for this assessment right now. Its last recorded status is{" "}
            <strong>{statusLabel(state.status)}</strong>.
          </>
        )}
      </p>
      {state.tracked && (
        <ol className="steps">
          {steps.map((step, i) => {
            const value = stepState(i, state.stage);
            return (
              <li key={step.stage} className={value} aria-current={value === "current" ? "step" : undefined}>
                {step.label}
                <span className="visually-hidden">
                  {value === "done" ? ", done" : value === "current" ? ", in progress" : ", not started"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {live && (percent !== null ? (
        <p>
          <progress max={100} value={percent} aria-label="Progress reported by the scanner" /> {percent}% reported by
          the scanner for this step
          {counted?.requests != null && ` · ${counted.requests} requests`}
          {counted?.alerts != null && ` · ${counted.alerts} alerts so far`}
        </p>
      ) : (
        <p>Exact progress is not available for this step.</p>
      ))}
      {live && state.memoryPercent !== null && (
        <p className="hint">
          Scanner memory {state.memoryPercent}% of its limit. The scan stops above 90%.
        </p>
      )}
      {!live && state.reasons.length > 0 && (
        <p>Details: {state.reasons.map(reasonText).join(" ")}</p>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      {live &&
        !state.cancelRequested &&
        state.stage !== "COLLECTING_EVIDENCE" &&
        (confirming ? (
          <div className="confirm-row">
            <p>Stop this scan? Results so far will not be imported, and it cannot be resumed.</p>
            <div className="dialog-actions">
              <button autoFocus className="refresh" disabled={busy} onClick={() => setConfirming(false)}>
                Keep scanning
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  void act(
                    () => request(base + "/scan/cancel", new AbortController().signal, { confirmed: true }),
                    false,
                  );
                }}
              >
                Stop the scan
              </button>
            </div>
          </div>
        ) : (
          <button className="refresh" disabled={busy} onClick={() => setConfirming(true)}>
            Stop scan
          </button>
        ))}
      {!state.tracked &&
        ["INITIALIZING", "SPIDER_RUNNING", "ACTIVE_SCAN_RUNNING", "OUTCOME_UNKNOWN"].includes(state.status) && (
          <>
            <button
              className="refresh"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const signal = new AbortController().signal;
                  await request(base + "/zap-sync", signal, {});
                  await request(base + "/zap-import", signal, {});
                }, true)
              }
            >
              {busy ? "Checking…" : "Check outcome"}
            </button>
            <p className="hint">
              Reads the scanner again. Results are imported only if all evidence passes verification.
            </p>
          </>
        )}
    </section>
  );
}
