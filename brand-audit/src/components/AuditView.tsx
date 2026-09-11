"use client";

import { useEffect, useRef, useState } from "react";
import type { Audit } from "@/lib/types";
import { AuditFailure } from "./AuditFailure";
import { AuditProgress } from "./AuditProgress";
import { Results, type ResultPayload } from "./Results";
import { Wordmark } from "./Wordmark";

/**
 * Polls one endpoint and renders whichever of the three states applies.
 * The URL never changes between waiting and results, so there is no flash and
 * the result is shareable (spec section 31).
 */
export function AuditView({ id, initial }: { id: string; initial: Audit | null }) {
  const [audit, setAudit] = useState<Audit | null>(initial);
  const [payload, setPayload] = useState<ResultPayload | null>(null);
  const [gone, setGone] = useState(!initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/audits/${id}`, { cache: "no-store" });
        if (response.status === 404) {
          if (!cancelled) setGone(true);
          return;
        }
        const data = (await response.json()) as Partial<ResultPayload> & { audit: Audit };
        if (cancelled) return;

        setGone(false);
        setAudit(data.audit);
        if (data.audit.status === "complete" && data.findings) {
          setPayload(data as ResultPayload);
          return;
        }
        if (data.audit.status === "failed") return;
      } catch {
        // Transient network failure: keep polling.
      }
      if (!cancelled) timer.current = setTimeout(poll, 1400);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id]);

  if (payload) return <Results data={payload} />;

  return (
    <main className="mx-auto w-full max-w-[880px] px-5 sm:px-8">
      <header className="py-7">
        <Wordmark small />
      </header>
      {gone ? (
        <AuditFailure
          url=""
          error={{
            code: "internal",
            message: "not found",
            userMessage: "We couldn't find that audit. It may have expired — run a new one.",
          }}
        />
      ) : audit?.status === "failed" && audit.error ? (
        <AuditFailure error={audit.error} url={audit.url} />
      ) : (
        <AuditProgress
          progress={audit?.progress ?? { stage: "validating", label: "Starting…", completed: 0, total: 8 }}
          url={audit?.url ?? ""}
        />
      )}
    </main>
  );
}
