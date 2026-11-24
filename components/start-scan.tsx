"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { describeError, fetchWebsite, request, RequestFailure, RequestTimeout, type WebsiteDetail } from "../lib/api";
import { launched, readiness, readinessMessage, type scanPolicy } from "../lib/scans";

export function StartScanDialog({
  targetId,
  policy,
  safety,
  close,
  started,
}: {
  targetId: string;
  policy: z.infer<typeof scanPolicy>;
  safety: string[];
  close: () => void;
  started: (assessmentId: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    submitting = useRef(false),
    requestKey = useRef("");
  const [site, setSite] = useState<WebsiteDetail>();
  const [check, setCheck] = useState<z.infer<typeof readiness>>();
  const [agreed, setAgreed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [revision, retry] = useState(0);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => {
    const control = new AbortController();
    Promise.all([
      fetchWebsite(targetId, control.signal),
      request(`/api/v1/targets/${encodeURIComponent(targetId)}/readiness`, control.signal).then((body) => readiness.parse(body)),
    ])
      .then(([detail, value]) => {
        if (control.signal.aborted) return;
        setSite(detail);
        setCheck(value);
      })
      .catch((cause: unknown) => {
        if (!control.signal.aborted) setError(describeError(cause));
      });
    return () => control.abort();
  }, [targetId, revision]);
  async function submit() {
    if (!site || !check?.ready || !agreed || submitting.current) return;
    submitting.current = true;
    // One key per dialog, so a repeated request can never start a second scan.
    requestKey.current ||= crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      const result = launched.parse(
        await request("/api/v1/scans", new AbortController().signal, {
          targetId: site.id,
          url: site.canonicalUrl,
          authorized: true,
          authorizationTextVersion: site.confirmation.version,
          confirmationToken: site.confirmation.token,
          configuration: policy.configuration.id,
          requestKey: requestKey.current,
        }),
      );
      started(result.assessmentId);
    } catch (cause) {
      submitting.current = false;
      setBusy(false);
      if (cause instanceof TypeError || cause instanceof RequestTimeout) {
        setUncertain(true);
        setError("No answer arrived. The scan may have started. Check Security Scans before trying again.");
      } else {
        setError(describeError(cause));
        if (cause instanceof RequestFailure && cause.reasons.length)
          setCheck({ ready: false, reasons: cause.reasons });
      }
    }
  }
  const loading = !error && (!site || !check);
  return (
    <dialog
      ref={ref}
      className="start-dialog"
      aria-labelledby="start-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <h2 id="start-title">Start New Security Scan</h2>
      {loading && <p role="status">Checking the scanner and the website…</p>}
      {site && (
        <>
          <p>SentinelScan will scan exactly this address:</p>
          <code className="scope-url">{site.canonicalUrl}</code>
        </>
      )}
      {check && !check.ready && (
        <div role="alert" className="not-ready">
          <p>The scan cannot start yet. Nothing was changed.</p>
          <ul>
            {check.reasons.map((reason) => (
              <li key={reason}>{readinessMessage(reason)}</li>
            ))}
          </ul>
        </div>
      )}
      {site && check?.ready && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy || uncertain}>
            <legend>Scan configuration</legend>
            <label className="consent-check">
              <input type="radio" name="configuration" checked readOnly />
              <span>
                <strong>{policy.configuration.name}</strong> (the approved configuration)
              </span>
            </label>
            <ul className="config-list">
              {[...policy.configuration.details, ...safety].map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </fieldset>
          <p>
            After you start: SentinelScan finds pages, tests them, verifies the evidence and imports the
            results. This usually takes about six minutes, and you can stop it. Starting ends the
            scanner&apos;s previous session.
          </p>
          <p>
            Your confirmation covers every page and endpoint of this exact address that the scan discovers.
            Other domains and subdomains are out of scope. Testing sends many unusual requests, so use a
            quiet time, keep a backup, and make sure that the hosting provider allows it.
          </p>
          <label className="consent-check">
            <input
              type="checkbox"
              required
              checked={agreed}
              disabled={busy || uncertain}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>{site.confirmation.wording}</span>
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="refresh" disabled={busy} onClick={close}>
              {uncertain ? "Close" : "Cancel"}
            </button>
            <button className="primary" disabled={!agreed || busy || uncertain}>
              {busy ? "Starting…" : "Start scan"}
            </button>
          </div>
        </form>
      )}
      {(!site || !check?.ready) && (
        <>
          {error && !check && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="refresh" onClick={close}>
              Close
            </button>
            {!loading && (
              <button
                type="button"
                className="refresh"
                onClick={() => {
                  setError("");
                  setCheck(undefined);
                  retry((n) => n + 1);
                }}
              >
                Check again
              </button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
