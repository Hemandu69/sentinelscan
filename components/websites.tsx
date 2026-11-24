"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { describeError, readSites, request, type Site } from "../lib/api";
import { Icon } from "./icons";
import { Navigation } from "./navigation";
import { SiteDialog } from "./site-dialog";
import "./workspace.css";

export function WebsitesPage() {
  const [revision, reload] = useState(0),
    [open, setOpen] = useState(false),
    [notice, setNotice] = useState("");
  const [result, setResult] = useState<{ sites?: Site[]; error?: string }>();
  useEffect(() => {
    const control = new AbortController();
    request("/api/v1/targets", control.signal)
      .then(readSites)
      .then((sites) => {
        if (!control.signal.aborted) setResult({ sites });
      })
      .catch((cause: unknown) => {
        if (!control.signal.aborted) setResult((old) => ({ sites: old?.sites, error: describeError(cause) }));
      });
    return () => control.abort();
  }, [revision]);
  return (
    <>
      <Navigation section="websites" />
      <main id="main" className="workspace">
        <header className="workspace-head">
          <div>
            <h1>Websites</h1>
            <p>Open a website to scan it, read its AI Analysis and get its reports.</p>
          </div>
          <button className="primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={16} /> Add website
          </button>
        </header>
        {notice && <p role="status" className="notice">{notice}</p>}
        {result?.error && (
          <p role="alert">
            The websites could not be loaded. {result.error}{" "}
            <button className="refresh" onClick={() => reload((n) => n + 1)}>
              Retry
            </button>
          </p>
        )}
        {!result && <p role="status">Loading websites…</p>}
        {result?.sites?.length === 0 && <p>No websites yet. Add the first one to begin.</p>}
        {result?.sites && result.sites.length > 0 && (
          <ul className="sites">
            {result.sites.map((site) => (
              <li key={site.id}>
                <span>
                  <strong>{site.displayName}</strong>
                  <small>{site.canonicalUrl}</small>
                </span>
                <Link className="detail-link" href={"/targets/" + site.id} aria-label={"Open " + site.displayName}>
                  Open <Icon name="arrow" size={14} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      {open && (
        <SiteDialog
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setNotice("Website registered. Open it to start a security scan.");
            reload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
