"use client";
import Link from "next/link";
import { useState } from "react";
import { readSites } from "../lib/api";
import { Icon } from "./icons";
import { Navigation } from "./navigation";
import { SiteDialog } from "./site-dialog";
import { useRead } from "./use-read";
import "./workspace.css";

export function WebsitesPage() {
  const [open, setOpen] = useState(false),
    [notice, setNotice] = useState("");
  const { data: sites, error, reload } = useRead("/api/v1/targets", readSites);
  return (
    <>
      <Navigation section="websites" />
      <main id="main" className="workspace">
        <header className="workspace-head">
          <div>
            <h1>Websites</h1>
            <p>Open a website to see its scans, AI Analysis and reports. Scans are limited to the Juice Shop demo.</p>
          </div>
          <button className="primary" onClick={() => setOpen(true)}>
            <Icon name="plus" size={16} /> Add website
          </button>
        </header>
        {notice && <p role="status" className="notice">{notice}</p>}
        {error && (
          <p role="alert">
            The websites could not be loaded. {error}{" "}
            <button className="refresh" onClick={reload}>
              Retry
            </button>
          </p>
        )}
        {!sites && !error && <p role="status">Loading websites…</p>}
        {sites?.length === 0 && <p>No websites yet. Add the first one to begin.</p>}
        {sites && sites.length > 0 && (
          <ul className="sites">
            {sites.map((site) => (
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
            reload();
          }}
        />
      )}
    </>
  );
}
