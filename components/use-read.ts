"use client";
import { useCallback, useEffect, useState } from "react";
import { describeError, request } from "../lib/api";

// Reads one path and validates the answer. Earlier data of the same path stays visible while it reloads.
export function useRead<T>(path: string | null, parse: (body: unknown) => T) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ path: string; revision: number; data?: T; error?: string }>();
  useEffect(() => {
    if (!path) return;
    const control = new AbortController();
    request(path, control.signal)
      .then(parse)
      .then((data) => {
        if (!control.signal.aborted) setResult({ path, revision, data });
      })
      .catch((cause: unknown) => {
        if (!control.signal.aborted)
          setResult((old) => ({
            path,
            revision,
            data: old?.path === path ? old.data : undefined,
            error: describeError(cause),
          }));
      });
    return () => control.abort();
  }, [path, parse, revision]);
  const own = result?.path === path ? result : undefined;
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  return { data: own?.data, error: own?.revision === revision ? own.error : undefined, reload };
}
