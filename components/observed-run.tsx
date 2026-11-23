"use client";
import { useEffect, useState } from "react";
import { request } from "../lib/api";
import {
  readObservation,
  continueObserving,
  type RunObservation,
} from "../lib/observation";

export function ObservedRun({
  assessmentId,
  kind,
  scanId,
}: {
  assessmentId: string;
  kind: "spider" | "active";
  scanId: string;
}) {
  const [row, setRow] = useState<RunObservation>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    async function poll() {
      try {
        const value = readObservation(
          await request(
            "/api/v1/assessments/" +
              encodeURIComponent(assessmentId) +
              "/zap-observations/" +
              kind +
              "/" +
              scanId,
            controller.signal,
          ),
          assessmentId,
          kind,
          scanId,
        );
        if (controller.signal.aborted) return;
        failures = 0;
        setRow(value);
        setError("");
        if (continueObserving(value.providerState))
          timer = setTimeout(poll, 5000);
      } catch (e) {
        if (controller.signal.aborted) return;
        failures++;
        const retry =
          failures < 3 &&
          (e instanceof TypeError ||
            (e instanceof Error && e.name === "TimeoutError"));
        setError(
          retry
            ? "Connection interrupted. Retrying."
            : "Observation stopped. Refresh the inventory before selecting this run again.",
        );
        if (retry) timer = setTimeout(poll, 5000 * 2 ** (failures - 1));
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [assessmentId, kind, scanId]);
  return (
    <section className="ledger-entry" aria-label="Selected provider run">
      <h4>
        {kind === "active" ? "Active check" : "Spider"} · Run {scanId}
      </h4>
      {error && <p role="alert">{error}</p>}
      {row ? (
        <>
          <p>
            Last observation:{" "}
            <time dateTime={row.observedAt}>
              {new Date(row.observedAt).toLocaleString()}
            </time>
          </p>
          <p>
            Provider state: {row.providerState ?? "Unknown"} · {row.progress}%
          </p>
          <p>
            Reported origin: {row.reportedOrigin ?? "Unavailable"}. Assessment
            association is unverified.
          </p>
        </>
      ) : (
        !error && <p role="status">Reading the selected run…</p>
      )}
    </section>
  );
}
