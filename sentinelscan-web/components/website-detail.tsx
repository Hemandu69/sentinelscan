"use client";
import { useEffect, useRef, useState } from "react";
import {
  createAssessment,
  describeError,
  fetchWebsite,
  RequestTimeout,
  type WebsiteDetail,
} from "../lib/api";

function Authorize({
  site,
  close,
  created,
}: {
  site: WebsiteDetail;
  close: () => void;
  created: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    submitting = useRef(false);
  const [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="authorize-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <h2 id="authorize-title">Create an assessment record</h2>
      <p>Review the exact website address before creating this assessment.</p>
      <code className="scope-url">{site.canonicalUrl}</code>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!checked || submitting.current || error) return;
          submitting.current = true;
          setBusy(true);
          try {
            const receipt = await createAssessment(
              site,
              checked,
              new AbortController().signal,
            );
            created(receipt.id);
          } catch (err) {
            setError(
              err instanceof TypeError || err instanceof RequestTimeout
                ? "No creation receipt was received. The request may have been saved."
                : describeError(err),
            );
            setBusy(false);
          }
        }}
      >
        <label className="consent-check">
          <input
            type="checkbox"
            required
            checked={checked}
            disabled={busy || !!error}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>{site.confirmation.wording}</span>
        </label>
        <p>
          Confirmation creates a pending assessment record. Scanning is a
          separate operator action.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            className="refresh"
            type="button"
            disabled={busy}
            onClick={close}
          >
            {error ? "Close" : "Cancel"}
          </button>
          <button className="primary" disabled={!checked || busy || !!error}>
            {busy ? "Creating…" : "Create record"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// Loads a fresh, single-use confirmation for the exact address before showing it.
export function RecordDialog({
  targetId,
  close,
  created,
}: {
  targetId: string;
  close: () => void;
  created: (id: string) => void;
}) {
  const [site, setSite] = useState<WebsiteDetail>(),
    [error, setError] = useState("");
  useEffect(() => {
    const control = new AbortController();
    fetchWebsite(targetId, control.signal)
      .then((value) => {
        if (!control.signal.aborted) setSite(value);
      })
      .catch((cause: unknown) => {
        if (!control.signal.aborted) setError(describeError(cause));
      });
    return () => control.abort();
  }, [targetId]);
  if (site) return <Authorize site={site} close={close} created={created} />;
  return (
    <p role={error ? "alert" : "status"}>
      {error || "Preparing the confirmation…"}{" "}
      {error && (
        <button className="refresh" onClick={close}>
          Close
        </button>
      )}
    </p>
  );
}
