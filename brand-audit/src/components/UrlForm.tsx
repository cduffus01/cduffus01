"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * The whole product surface: one input, one button (spec section 5).
 * The brand guide is a quiet secondary control — never a required step.
 */
export function UrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [guide, setGuide] = useState<File | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const trimmed = url.trim();
    if (!trimmed) {
      setError("Enter your website address to start.");
      return;
    }

    setBusy(true);
    try {
      let response: Response;
      if (guide) {
        const form = new FormData();
        form.set("url", trimmed);
        form.set("guide", guide);
        response = await fetch("/api/audits", { method: "POST", body: form });
      } else {
        response = await fetch("/api/audits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });
      }

      const data = (await response.json().catch(() => ({}))) as {
        audit_id?: string;
        error?: string;
      };
      if (!response.ok || !data.audit_id) {
        setError(data.error ?? "We couldn't start that audit. Try again.");
        setBusy(false);
        return;
      }
      router.push(`/a/${data.audit_id}`);
    } catch {
      setError("We couldn't reach the audit service. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div
        className="flex flex-col gap-2 rounded-2xl p-2 sm:flex-row sm:items-center"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)",
        }}
      >
        <label htmlFor="site-url" className="sr-only">
          Your website address
        </label>
        <input
          id="site-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent px-4 py-3.5 text-[17px] outline-none placeholder:text-[var(--muted)] disabled:opacity-60"
          style={{ color: "var(--ink)" }}
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold tracking-tight text-white transition-transform active:scale-[0.99] disabled:opacity-70"
          style={{ background: "var(--accent)" }}
        >
          {busy ? "Starting…" : "Audit my brand"}
        </button>
      </div>

      <div className="mt-3 flex min-h-6 flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        {!showGuide ? (
          <button
            type="button"
            onClick={() => {
              setShowGuide(true);
              queueMicrotask(() => fileRef.current?.click());
            }}
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--muted)" }}
          >
            + Add brand guide <span className="opacity-70">(optional)</span>
          </button>
        ) : (
          <span className="flex items-center gap-2" style={{ color: "var(--muted)" }}>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setGuide(e.target.files?.[0] ?? null)}
              className="max-w-[260px] text-[12px] file:mr-2 file:rounded-lg file:border-0 file:bg-[var(--accent-soft)] file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-[var(--accent)]"
            />
            {guide ? (
              <span style={{ color: "var(--good)" }}>
                Compliance mode — we&apos;ll check against your guide.
              </span>
            ) : (
              <span>PDF. Without one we check internal consistency.</span>
            )}
          </span>
        )}
        <span className="ml-auto" style={{ color: "var(--muted)" }}>
          Free · no signup
        </span>
      </div>

      {error ? (
        <p className="mt-3 text-[14px]" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
