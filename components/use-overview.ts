"use client";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { readSites, request, serviceReady, type Site } from "../lib/api";
import { assessments } from "../lib/records";
import { readDashboard, type Dashboard } from "../lib/dashboard";
type Latest = z.infer<typeof assessments>["items"][number];
export type Reading<T> =
  { state: "loading" } | { state: "error" } | { state: "ready"; value: T };
export const services = [
  { name: "Application API", path: "/health" },
  { name: "Database", path: "/health/database" },
  { name: "ZAP security service", path: "/health/zap" },
];
export function useOverview(revision: number) {
  const [sites, setSites] = useState<Reading<Site[]>>({ state: "loading" });
  const [dashboard, setDashboard] = useState<Reading<Dashboard>>({
    state: "loading",
  });
  const [latest, setLatest] = useState<Reading<Latest | null>>({ state: "loading" });
  const [health, setHealth] = useState<Record<string, Reading<boolean>>>({});
  useEffect(() => {
    const ctrl = new AbortController();
    // Each read settles independently; an unavailable dependency cannot block the page.
    const load = async () => {
      setSites({ state: "loading" });
      setHealth({});
      setDashboard({ state: "loading" });
      setLatest({ state: "loading" });
      void request("/api/v1/assessments?offset=0", ctrl.signal)
        .then((body) => assessments.parse(body).items[0] ?? null)
        .then((value) => {
          if (!ctrl.signal.aborted) setLatest({ state: "ready", value });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setLatest({ state: "error" });
        });
      void request("/api/v1/dashboard", ctrl.signal)
        .then(readDashboard)
        .then((value) => {
          if (!ctrl.signal.aborted) setDashboard({ state: "ready", value });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setDashboard({ state: "error" });
        });
      void request("/api/v1/targets", ctrl.signal)
        .then(readSites)
        .then((value) => {
          if (!ctrl.signal.aborted) setSites({ state: "ready", value });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setSites({ state: "error" });
        });
      await Promise.all(
        services.map(async (s) => {
          let reading: Reading<boolean>;
          try {
            const body = await request(s.path, ctrl.signal);
            reading = serviceReady(s.path, body)
              ? { state: "ready", value: true }
              : { state: "error" };
          } catch {
            reading = { state: "error" };
          }
          if (!ctrl.signal.aborted)
            setHealth((prev) => ({ ...prev, [s.path]: reading }));
        }),
      );
    };
    void load();
    return () => ctrl.abort();
  }, [revision]);
  return { sites, health, dashboard, latest };
}
