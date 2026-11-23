"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Icon } from "./icons";
const navigation = [
  ["overview", "Overview", "overview"],
  ["websites", "Websites", "web"],
  ["issues", "Issue guide", "shield"],
  ["system", "System health", "activity"],
] as const;
export function Navigation({
  websiteDetail = false,
  section,
}: {
  websiteDetail?: boolean;
  section?: "assessments" | "findings";
}) {
  const [menu, setMenu] = useState(false),
    [active, setActive] = useState("overview");
  useEffect(() => {
    const sync = () => setActive(location.hash.slice(1) || "overview");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const toggle = () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("watchtower-theme", next);
    } catch {}
  };
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <Link className="brand" href="/#overview">
          <span className="brand-icon">
            <Icon name="tower" size={32} />
          </span>
          SentinelScan
        </Link>
        <button
          className="mobile-toggle icon-btn"
          onClick={() => setMenu(!menu)}
          aria-label="Toggle navigation"
          aria-expanded={menu}
          aria-controls="rail-links"
        >
          <Icon name={menu ? "close" : "menu"} />
        </button>
        <div
          id="rail-links"
          className={"rail-body " + (menu ? "expanded" : "")}
        >
          <nav aria-label="Dashboard sections">
            {navigation.map(([id, label, icon]) => (
              <a
                key={id}
                href={"/#" + id}
                aria-current={
                  (section ?? (websiteDetail ? "websites" : active)) === id
                    ? "location"
                    : undefined
                }
                onClick={() => {
                  setActive(id);
                  setMenu(false);
                }}
              >
                <Icon name={icon} />
                {label}
              </a>
            ))}
            <Link
              href="/assessments"
              aria-current={section === "assessments" ? "page" : undefined}
            >
              <Icon name="activity" /> Assessments
            </Link>
            <Link
              href="/findings"
              aria-current={section === "findings" ? "page" : undefined}
            >
              <Icon name="shield" /> Findings
            </Link>
          </nav>
          <button className="theme" onClick={toggle}>
            <span className="light-only">
              <Icon name="moon" />
              Dark mode
            </span>
            <span className="dark-only">
              <Icon name="sun" />
              Light mode
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
