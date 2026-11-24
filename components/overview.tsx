"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icons";
import { SiteDialog } from "./site-dialog";
import { services, useOverview } from "./use-overview";

import { Navigation } from "./navigation";
const levels = [
  ["CRITICAL", "Critical", "Requires immediate attention."],
  ["HIGH", "High", "Address soon."],
  ["MEDIUM", "Medium", "Review and plan a fix."],
  ["LOW", "Low", "Minor security concern."],
  ["INFO", "Informational", "Useful security observation."],
] as const;
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="metric">
      <h2>{label}</h2>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
export function Overview() {
  const [revision, reload] = useState(0),
    [open, setOpen] = useState(false),
    [showAll, setShowAll] = useState(false),
    [notice, setNotice] = useState("");
  const { sites, health, dashboard } = useOverview(revision);
  const summary = dashboard.state === "ready" ? dashboard.value : null;
  const waiting =
    dashboard.state === "loading"
      ? "Reading assessments."
      : "Assessment totals unavailable.";
  const results = summary && summary.completedChecks > 0 ? summary : null;
  const resultNote = !summary
    ? waiting
    : !summary.totalChecks
      ? "No assessments yet."
      : !results
        ? "Awaiting a completed assessment."
        : "Across completed assessments.";
  const isReady = sites.state === "ready";
  return (
    <>
      <Navigation section="overview" />
      <main id="main">
        <div id="overview" className="mast">
          <span>
            SentinelScan <b aria-hidden="true">/</b> <strong>Overview</strong>
          </span>
          <button
            className="refresh"
            onClick={() => {
              reload((n) => n + 1);
              setNotice("");
            }}
          >
            <Icon name="refresh" size={15} />
            Refresh
          </button>
        </div>
        <header className="hero">
          <div className="art" aria-hidden="true" />
          <div className="hero-copy">
            <h1>The Watchtower</h1>
            <p>
              Monitor your websites and identify potential security weaknesses.
            </p>
            <button className="primary" onClick={() => setOpen(true)}>
              <Icon name="plus" size={16} /> Add website
            </button>
          </div>
        </header>
        <p className="notice" role="status">
          {notice}
        </p>
        <section aria-label="Workspace totals" className="metrics">
          <Metric
            label="Registered websites"
            value={isReady ? String(sites.value.length) : "—"}
            note={
              isReady
                ? "In your workspace"
                : sites.state === "loading"
                  ? "Checking registry…"
                  : "Registry unavailable"
            }
          />
          <Metric
            label="Completed assessments"
            value={summary ? String(summary.completedChecks) : "—"}
            note={
              summary ? `Of ${summary.totalChecks} assessments created` : waiting
            }
          />
          <Metric
            label="Recorded findings"
            value={results ? String(results.findingCount) : "—"}
            note={resultNote}
          />
        </section>
        <div className="columns">
          <section id="issues">
            <div className="section-head">
              <Icon name="shield" />
              <h2>Issue guide</h2>
            </div>
            <p className="lead">
              {results
                ? "What each severity means, with findings from completed assessments. A finding recorded in two assessments counts twice."
                : resultNote}
            </p>
            <dl className="severity">
              {levels.map(([key, level, desc]) => (
                <div key={level}>
                  <dt>
                    <i className={"marker " + level.toLowerCase()} />
                    {level}{" "}
                    {results && <strong>{results.severityCounts[key]}</strong>}
                  </dt>
                  <dd>{desc}</dd>
                </div>
              ))}
              {results && results.severityCounts.OTHER > 0 && (
                <div>
                  <dt>Other severity {results.severityCounts.OTHER}</dt>
                  <dd>Unrecognized severity in stored results.</dd>
                </div>
              )}
            </dl>
          </section>
          <section id="system">
            <div className="section-head">
              <Icon name="activity" />
              <h2>System health</h2>
            </div>
            <p className="lead">The local services your workspace relies on.</p>
            <ul className="health">
              {services.map(({ name, path }) => {
                const state = health[path]?.state || "loading";
                return (
                  <li key={path}>
                    <span>{name}</span>
                    <span className={"status " + state}>
                      <i />
                      {state === "ready"
                        ? "Operational"
                        : state === "error"
                          ? "Unavailable"
                          : "Checking…"}
                    </span>
                  </li>
                );
              })}
            </ul>
            {Object.values(health).some((r) => r.state === "error") && (
              <p className="hint">
                A service check failed. Use Refresh to check again.
              </p>
            )}
          </section>
        </div>
        <section id="websites" className="registry">
          <div className="section-head">
            <Icon name="web" />
            <h2>
              {showAll ? "Registered websites" : "Recently registered websites"}
            </h2>
          </div>
          <p className="lead">The latest additions to your website register.</p>
          {sites.state === "ready" && sites.value.length > 5 && (
            <button className="refresh" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show recent websites" : "Show all websites"}
            </button>
          )}
          {sites.state === "ready" && sites.value.length > 0 ? (
            <ul className="sites">
              {(showAll ? sites.value : sites.value.slice(0, 5)).map((s) => (
                <li key={s.id}>
                  <span>
                    <strong>{s.displayName}</strong>
                    <small>{s.canonicalUrl}</small>
                  </span>
                  <div className="site-actions">
                    <time dateTime={s.createdAt}>
                      {new Intl.DateTimeFormat("en", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      }).format(new Date(s.createdAt))}
                    </time>
                    <Link
                      className="detail-link"
                      href={"/targets/" + encodeURIComponent(s.id)}
                      aria-label={"Open " + s.displayName}
                    >
                      Open <Icon name="arrow" size={14} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="registry-state">
              {sites.state === "loading"
                ? "Reading the website register…"
                : sites.state === "error"
                  ? "The website register could not be loaded."
                  : "Your website register is empty."}
              {sites.state === "error" ? (
                <button onClick={() => reload((n) => n + 1)}>
                  Try again <Icon name="arrow" size={14} />
                </button>
              ) : sites.state === "ready" ? (
                <button onClick={() => setOpen(true)}>
                  Add your first website <Icon name="arrow" size={14} />
                </button>
              ) : null}
            </div>
          )}
        </section>
      </main>
      {open && (
        <SiteDialog
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setNotice("Website registered.");
            reload((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
