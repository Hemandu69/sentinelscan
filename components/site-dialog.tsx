"use client";
import { useEffect, useRef, useState } from "react";
import { describeError, request } from "../lib/api";
import { Icon } from "./icons";
export function SiteDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="add-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id="add-title">Add a website</h2>
        <button
          className="icon-btn"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <p>
        Register a website in your workspace. You can authorize a security check
        separately.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const data = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await request("/api/v1/targets", new AbortController().signal, {
              displayName: String(data.get("name")).trim(),
              url: String(data.get("url")).trim(),
            });
            onSaved();
          } catch (err) {
            setError(describeError(err));
            setBusy(false);
          }
        }}
      >
        <label>
          Website name
          <input
            autoFocus
            name="name"
            required
            maxLength={160}
            pattern=".*\S.*"
            placeholder="My website"
          />
        </label>
        <label>
          Website URL
          <input
            name="url"
            required
            type="url"
            maxLength={2048}
            placeholder="https://example.org"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Register website"}
          <Icon name="arrow" />
        </button>
      </form>
    </dialog>
  );
}
