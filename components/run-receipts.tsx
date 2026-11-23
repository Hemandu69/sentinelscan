"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { z } from "zod";
import { request } from "../lib/api";
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
      .catch(() => {
        if (!ctrl.signal.aborted)
          setError("Saved scan records could not be loaded.");
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
      if (!signal.aborted)
        setError(e instanceof Error ? e.message : "The operation failed.");
    } finally {
      locked.current = false;
      if (!signal.aborted) setBusy(false);
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
  const closed =
    data && ["COMPLETED", "FAILED", "CANCELLED"].includes(data.status);
  return (
    <section className="registry">
      <h2>Saved scan records</h2>
      {error && <p role="alert">{error}</p>}
      {!data && (
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
          {r.kind === "active" ? "Active check" : "Spider"} · ID {r.scan_id} ·{" "}
          {r.state ?? "Unknown state"} ·{" "}
          {r.progress === null ? "Progress unavailable" : r.progress + "%"} ·
          Observed {new Date(r.observed_at).toLocaleString()}
        </p>
      ))}
      {data && !data.runs.length && (
        <p>No scan receipts saved for this assessment.</p>
      )}
      {data && !closed && (
        <>
          <details>
            <summary>Record an existing operator run</summary>
            <form onSubmit={bind}>
              <p>
                Use the ID and session fingerprint recorded with your run of
                http://juice-shop:3000/.
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
          </details>
          {data.runs.length > 0 && (
            <button
              className="refresh"
              disabled={busy}
              onClick={() => void submit("zap-sync", {})}
            >
              Update saved progress
            </button>
          )}
          {data.runs.length === 2 && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void submit("zap-import", {})}
            >
              Verify and import results
            </button>
          )}
          <button
            className="refresh"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Cancel this assessment in SentinelScan? This prevents import. Any operator-run ZAP scan continues independently.",
                )
              )
                void submit("cancel-tracking", { confirmed: true });
            }}
          >
            Cancel assessment tracking
          </button>
          {busy && <p role="status">Checking provider evidence…</p>}
        </>
      )}
    </section>
  );
}
