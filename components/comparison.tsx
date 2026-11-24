"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { describeError, request } from "../lib/api";
import { comparison, comparisonReason } from "../lib/scans";
import { SeverityBadge } from "./issues";

type Row = { id: string; finishedAt: string | null };
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function AssessmentComparison({ completed }: { completed: Row[] }) {
  const [choice, choose] = useState<{ later: string; earlier: string }>();
  const later = choice?.later ?? completed[0]?.id,
    earlier = choice?.earlier ?? completed[1]?.id;
  const key = earlier && later && earlier !== later ? later + "#" + earlier : "";
  const [result, setResult] = useState<{ key: string; data?: z.infer<typeof comparison>; error?: string }>();
  useEffect(() => {
    if (!key) return;
    const control = new AbortController();
    request(`/api/v1/assessments/${later}/comparison?earlier=${earlier}`, control.signal)
      .then((body) => comparison.parse(body))
      .then((data) => {
        if (!control.signal.aborted) setResult({ key, data });
      })
      .catch((cause: unknown) => {
        if (!control.signal.aborted) setResult({ key, error: describeError(cause) });
      });
    return () => control.abort();
  }, [key, later, earlier]);
  if (completed.length < 2)
    return <p>A comparison needs two completed assessments of this website. There {completed.length === 1 ? "is one" : "are none"} so far.</p>;
  const select = (label: string, value: string, set: (id: string) => void) => (
    <label>
      {label}{" "}
      <select value={value} onChange={(e) => set(e.target.value)}>
        {completed.map((row) => (
          <option key={row.id} value={row.id}>
            {row.finishedAt ? date(row.finishedAt) : row.id.slice(0, 8)}
          </option>
        ))}
      </select>
    </label>
  );
  const data = result?.key === key ? result.data : undefined;
  return (
    <>
      <div className="ledger-filters">
        {select("Earlier assessment", earlier, (id) => choose({ earlier: id, later }))}
        {select("Later assessment", later, (id) => choose({ earlier, later: id }))}
      </div>
      {!key ? (
        <p>Choose two different assessments.</p>
      ) : result?.key === key && result.error ? (
        <p role="alert">{result.error}</p>
      ) : !data ? (
        <p role="status">Comparing…</p>
      ) : !data.result ? (
        <>
          <p>These assessments cannot be compared fairly:</p>
          <ul className="bullets">
            {data.reasons.map((reason) => (
              <li key={reason}>{comparisonReason(reason)}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {(
            [
              ["New", data.result.new, "Reported only by the later assessment."],
              ["Persistent", data.result.persistent, "Reported by both, unchanged."],
              ["Changed", data.result.changed, "Reported by both, with different severity, confidence or text."],
              ["Not seen again", data.result.notSeenAgain, "Reported only by the earlier assessment. This does not show that it was fixed."],
            ] as const
          ).map(([label, rows, note]) => (
            <section key={label}>
              <h3>
                {label} ({rows.length})
              </h3>
              <p className="hint">{note}</p>
              <ul className="plain">
                {rows.map((row) => (
                  <li key={row.id}>
                    <SeverityBadge value={row.severity} /> {row.name} · <code>{row.url}</code>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!data.result.resolvedSupported && (
            <p className="hint">
              Resolved findings are not listed. Stored evidence does not show that each earlier location was
              tested again in the same way.
            </p>
          )}
        </>
      )}
    </>
  );
}
