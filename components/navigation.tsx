"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icons";
const pages = [
  ["overview", "Overview", "/", "overview"],
  ["websites", "Websites", "/websites", "web"],
  ["assessments", "Assessments", "/assessments", "activity"],
  ["findings", "Findings", "/findings", "shield"],
] as const;
const help = [
  ["issues", "Issue guide", "/#issues", "shield"],
  ["system", "System health", "/#system", "activity"],
] as const;
export function Navigation({
  section,
}: {
  section?: "overview" | "websites" | "assessments" | "findings";
}) {
  const [menu, setMenu] = useState(false);
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
        <Link className="brand" href="/">
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
          <nav aria-label="Main">
            {pages.map(([id, label, href, icon]) => (
              <Link
                key={id}
                href={href}
                aria-current={section === id ? "page" : undefined}
                onClick={() => setMenu(false)}
              >
                <Icon name={icon} />
                {label}
              </Link>
            ))}
          </nav>
          <nav aria-label="Help and status" className="secondary-nav">
            {help.map(([id, label, href, icon]) => (
              <Link key={id} href={href} onClick={() => setMenu(false)}>
                <Icon name={icon} />
                {label}
              </Link>
            ))}
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
