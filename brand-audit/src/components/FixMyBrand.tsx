"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/client-analytics";

/**
 * The single most important behavioural metric in V0 (spec sections 16 and 36):
 * of the users who see a result, how many want it remediated?
 */
export function FixMyBrand({ auditId }: { auditId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "saving") return;
    setState("saving");
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, auditId, source: "fix_my_brand" }),
      });
      setState(response.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div
        className="card p-6 text-center"
        style={{ borderColor: "var(--good)" }}
      >
        <p className="text-[15px] font-semibold tracking-tight">You&apos;re on the list.</p>
        <p className="mt-1.5 text-[14px]" style={{ color: "var(--muted)" }}>
          We&apos;ll email you when automatic remediation opens up.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      {!open ? (
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-[16px] font-semibold tracking-tight">Fix my brand</p>
            <p className="mt-1 text-[14px]" style={{ color: "var(--muted)" }}>
              Apply these fixes to your real site. Remediation beta.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              trackEvent("fix_click", auditId);
            }}
            className="shrink-0 rounded-xl px-5 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.99]"
            style={{ background: "var(--accent)" }}
          >
            Fix my brand
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <p className="text-[16px] font-semibold tracking-tight">Join the remediation beta</p>
          <p className="mt-1 text-[14px]" style={{ color: "var(--muted)" }}>
            We&apos;ll send you the fix bundle for this site when it&apos;s ready.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="lead-email">Email address</label>
            <input
              id="lead-email"
              type="email"
              required
              autoFocus
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-w-0 flex-1 rounded-xl px-4 py-3 text-[15px] outline-none"
              style={{ background: "var(--paper)", border: "1px solid var(--line)", color: "var(--ink)" }}
            />
            <button
              type="submit"
              disabled={state === "saving"}
              className="rounded-xl px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-70"
              style={{ background: "var(--accent)" }}
            >
              {state === "saving" ? "Saving…" : "Join beta"}
            </button>
          </div>
          {state === "error" ? (
            <p className="mt-2 text-[13px]" style={{ color: "var(--bad)" }} role="alert">
              That didn&apos;t save. Check the address and try again.
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
