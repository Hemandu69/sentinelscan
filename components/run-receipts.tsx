"use client";
import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { describeError, request } from "../lib/api";
import { dateTime } from "../lib/format";
import { execution } from "../lib/records";
export function RunReceipts({
  id,
  onUpdated,
}: {
  id: string;
  onUpdated: () => void;
}) {
  const base = "/api/v1/assessments/" + encodeURIComponent(id);
  const [data, setData] = useState<z.infer<typeof execution>>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const locked = useRef(false),
    control = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    control.current = ctrl;
    request(base + "/execution", ctrl.signal)
      .then((x) => execution.parse(x))
      .then((x) => {
        if (!ctrl.signal.aborted) setData(x);
      })
      .catch((cause: unknown) => {
        if (!ctrl.signal.aborted)
          setError(
            "Saved scan records could not be loaded. " + describeError(cause),
          );
      });
    return () => ctrl.abort();
  }, [base, reload]);
  async function cancelTracking() {
    const signal = control.current?.signal;
    if (!signal || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await request(base + "/cancel-tracking", signal, { confirmed: true });
      if (!signal.aborted) onUpdated();
    } catch (cause) {
      if (!signal.aborted) setError(describeError(cause));
    }
    locked.current = false;
    if (!signal.aborted) {
      setBusy(false);
      // The server may have saved the change even when its reply was lost.
      setReload((count) => count + 1);
    }
  }
  const unknownOutcome = data?.runs.some((run) => run.state !== "RUNNING");
  const closed =
    data && ["COMPLETED", "FAILED", "CANCELLED"].includes(data.status);
  return (
    <section className="registry">
      <h2>Saved scan records</h2>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading saved scan records…</p>}
      {!data && error && (
        <button
          className="refresh"
          onClick={() => {
            setError("");
            setReload((n) => n + 1);
          }}
        >
          Reload records
        </button>
      )}
      {data?.runs.map((r) => (
        <p key={r.kind}>
          {r.kind === "active" ? "Active scan" : "Spider"} · ID {r.scan_id} ·{" "}
          {r.state ?? "Unknown state"} ·{" "}
          {r.progress === null ? "Progress unavailable" : r.progress + "%"} ·
          Observed {dateTime(r.observed_at)}
        </p>
      ))}
      {data && !data.runs.length && (
        <p>No scan was started for this assessment.</p>
      )}
      {data && !closed && unknownOutcome && (
        <p>
          ZAP did not report every saved run as running at the last check. That
          does not show how a run ended, so its outcome is unknown and the
          assessment stays open.
        </p>
      )}
      {data && !closed && (
        <>
          <p>
            Cancelling tracking closes this record in SentinelScan only. It does
            not stop a scan. Stop a running scan in ZAP.
          </p>
          <button
            className="refresh"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Cancel tracking in SentinelScan? This cannot be undone and prevents import. It does not stop any ZAP scan.",
                )
              )
                void cancelTracking();
            }}
          >
            Cancel local tracking
          </button>
          {busy && <p role="status">Cancelling…</p>}
        </>
      )}
    </section>
  );
}
