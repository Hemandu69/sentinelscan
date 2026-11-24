"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { z } from "zod";
import { describeError, request } from "../lib/api";
import { execution } from "../lib/records";
export function RunReceipts({
  id,
  canAssociate,
  onUpdated,
}: {
  id: string;
  canAssociate: boolean;
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
  async function submit(action: string, body: object) {
    const signal = control.current?.signal;
    if (!signal || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await request(base + "/" + action, signal, body);
      if (!signal.aborted) {
        setReload((count) => count + 1);
        onUpdated();
      }
    } catch (e) {
      if (!signal.aborted) {
        setError(describeError(e));
        // The server may have saved the change even when its reply was lost.
        setReload((count) => count + 1);
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function bind(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = new FormData(e.currentTarget);
    void submit("zap-association", {
      kind: input.get("kind"),
      scanId: input.get("scanId"),
      sessionKey: input.get("sessionKey"),
      confirmedOperatorReceipt: input.get("receipt") === "on",
      target: "http://juice-shop:3000/",
    });
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
          Observed {new Date(r.observed_at).toLocaleString()}
        </p>
      ))}
      {data && !data.runs.length && (
        <p>No scan receipts saved for this assessment.</p>
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
          {canAssociate && <details>
            <summary>Record an existing operator run</summary>
            <form onSubmit={bind}>
              <p>
                Use the ID and session fingerprint you recorded while your run of
                http://juice-shop:3000/ was in the current ZAP session.
              </p>
              <p>
                To record them, run <code>npm.cmd run zap:session</code> in the
                API checkout during the run. The command only reads. A
                fingerprint captured later cannot prove an earlier run.
              </p>
              <div className="ledger-filters">
                <label>
                  Scan type{" "}
                  <select name="kind">
                    <option value="spider">Spider</option>
                    <option value="active">Active</option>
                  </select>
                </label>
                <label>
                  Run ID{" "}
                  <input
                    required
                    name="scanId"
                    pattern="[0-9]{1,12}"
                    maxLength={12}
                  />
                </label>
                <label>
                  Session fingerprint{" "}
                  <input
                    required
                    name="sessionKey"
                    pattern="[0-9a-f]{64}"
                    maxLength={64}
                  />
                </label>
              </div>
              <label>
                <input required type="checkbox" name="receipt" /> I recorded
                this run for this assessment and exact target.
              </label>
              <button disabled={busy} className="primary">
                Save run receipt
              </button>
            </form>
          </details>}
          {canAssociate && data.runs.length > 0 && (
            <button
              className="refresh"
              disabled={busy}
              onClick={() => void submit("zap-sync", {})}
            >
              Update saved progress
            </button>
          )}
          {canAssociate && data.runs.length === 2 && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void submit("zap-import", {})}
            >
              Verify and import results
            </button>
          )}
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
                void submit("cancel-tracking", { confirmed: true });
            }}
          >
            Cancel local tracking
          </button>
          {busy && <p role="status">Working… Provider checks can take a minute.</p>}
        </>
      )}
    </section>
  );
}
