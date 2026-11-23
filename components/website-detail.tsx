"use client";
import Link from "next/link";
import { AssessmentHistory } from "./records";
import { useEffect, useRef, useState } from "react";
import {
  createAssessment,
  describeError,
  fetchWebsite,
  RequestTimeout,
  type WebsiteDetail,
} from "../lib/api";
import { Navigation } from "./navigation";
import { Icon } from "./icons";

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
      <h2 id="authorize-title">Authorize security check</h2>
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
            {busy ? "Creating…" : "Create security check"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function WebsiteDetailPage({ id }: { id: string }) {
  const [site, setSite] = useState<WebsiteDetail | null>(null),
    [error, setError] = useState(""),
    [revision, refresh] = useState(0);
  const [confirm, setConfirm] = useState<WebsiteDetail | null>(null),
    [reviewing, setReviewing] = useState(false),
    [receipt, setReceipt] = useState("");
  const opening = useRef(false);
  useEffect(() => {
    const control = new AbortController();
    fetchWebsite(id, control.signal)
      .then((data) => {
        if (!control.signal.aborted) {
          setSite(data);
          setError("");
        }
      })
      .catch((e) => {
        if (!control.signal.aborted) {
          setError(describeError(e));
          setSite(null);
        }
      });
    return () => control.abort();
  }, [id, revision]);
  async function review() {
    if (opening.current) return;
    opening.current = true;
    setReviewing(true);
    setError("");
    try {
      const fresh = await fetchWebsite(id, new AbortController().signal);
      setSite(fresh);
      setConfirm(fresh);
    } catch (e) {
      setError(describeError(e));
      setSite(null);
    } finally {
      opening.current = false;
      setReviewing(false);
    }
  }
  return (
    <>
      <Navigation websiteDetail />
      <main id="main">
        <div className="mast">
          <span>
            <Link href="/#websites">Websites</Link> <b aria-hidden="true">/</b>{" "}
            <strong>Website details</strong>
          </span>
        </div>
        <header className="hero detail-hero">
          <div className="art" aria-hidden="true" />
          <div className="hero-copy">
            <h1>{site?.displayName || "Website details"}</h1>
            {site && <p>Registration and security checks for this website.</p>}
          </div>
        </header>
        {receipt && (
          <section className="receipt" role="status">
            <h2>Security check created · Pending</h2>
            <p>
              Assessment ID{" "}
              <Link href={"/assessments/" + receipt}>
                <code>{receipt}</code>
              </Link>
            </p>
          </section>
        )}
        {error && (
          <div className="registry-state" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                refresh((n) => n + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}
        {!site && !error && <p role="status">Loading website details…</p>}
        {site && (
          <section className="record">
            <div>
              <div className="section-head">
                <Icon name="web" />
                <h2>Website registration</h2>
              </div>
              <dl>
                <dt>Canonical URL</dt>
                <dd>
                  <code>{site.canonicalUrl}</code>
                </dd>
                <dt>Registered</dt>
                <dd>
                  <time dateTime={site.createdAt}>
                    {new Date(site.createdAt).toLocaleString()}
                  </time>
                </dd>
              </dl>
            </div>
            <div>
              <div className="section-head">
                <Icon name="shield" />
                <h2>Security check</h2>
              </div>
              <p>
                Review the target and confirm your permission to create an
                assessment record. This does not start a scan.
              </p>
              <button className="primary" disabled={reviewing} onClick={review}>
                <Icon name="shield" />
                {reviewing ? "Preparing confirmation…" : "Create Security Check"}
              </button>
            </div>
          </section>
        )}
        <section className="registry">
          <div className="section-head">
            <Icon name="activity" />
            <h2>Assessment history</h2>
          </div>
          <AssessmentHistory key={revision} targetId={id} />
        </section>
        {confirm && (
          <Authorize
            site={confirm}
            close={() => setConfirm(null)}
            created={(newId) => {
              setReceipt(newId);
              setConfirm(null);
              refresh((n) => n + 1);
            }}
          />
        )}
      </main>
    </>
  );
}
