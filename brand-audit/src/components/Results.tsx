"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Audit, AuditPage, CategoryScore, Finding, Preview } from "@/lib/types";
import { trackEvent } from "@/lib/client-analytics";
import { BeforeAfter } from "./BeforeAfter";
import { FindingCard } from "./FindingCard";
import { FixMyBrand } from "./FixMyBrand";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { ScoreRing } from "./ScoreRing";
import { Wordmark } from "./Wordmark";

export interface ResultPayload {
  audit: Audit;
  pages: (AuditPage & { screenshotUrl: string | null })[];
  findings: Finding[];
  preview: (Preview & { beforeUrl: string | null; afterUrl: string | null }) | null;
}

export function Results({ data }: { data: ResultPayload }) {
  const { audit, findings, preview, pages } = data;
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewOpened, setPreviewOpened] = useState(false);

  useEffect(() => {
    trackEvent("results_view", audit.id, {
      score: audit.brandScore ?? 0,
      findings: findings.length,
    });
  }, [audit.id, audit.brandScore, findings.length]);

  const categories: CategoryScore[] = audit.categoryScores ?? [];
  const summary = audit.summary;
  const hasComparison = Boolean(preview?.beforeUrl && preview?.afterUrl && preview.changes.length);
  const projected = preview?.projectedScore ?? null;
  const improves = typeof projected === "number" && typeof audit.brandScore === "number"
    && projected > audit.brandScore;

  function openPreview() {
    setPreviewOpened(true);
    trackEvent("preview_click", audit.id, { projected: projected ?? 0 });
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="mx-auto w-full max-w-[880px] px-5 pb-24 sm:px-8">
      <header className="flex items-center justify-between py-7">
        <Link href="/"><Wordmark small /></Link>
        <Link href="/" className="text-[13px] underline-offset-4 hover:underline" style={{ color: "var(--muted)" }}>
          Audit another site
        </Link>
      </header>

      {/* --- score ---------------------------------------------------------- */}
      <section className="pt-6">
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          {audit.domain}
        </p>
        <div className="mt-6 flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <ScoreRing
            score={audit.brandScore ?? 0}
            band={summary?.band ?? ""}
            projected={projected}
          />
          {hasComparison ? (
            <button
              type="button"
              onClick={openPreview}
              className="self-start rounded-xl px-5 py-3.5 text-[15px] font-semibold text-white transition-transform active:scale-[0.99] sm:self-auto"
              style={{ background: "var(--accent)" }}
            >
              Preview improved site
            </button>
          ) : null}
        </div>

        <p className="mt-8 max-w-[62ch] text-[17px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          {summary?.verdict}
        </p>

        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 text-[14px]">
          <div>
            <dt className="text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
              Strongest area
            </dt>
            <dd className="mt-1 font-medium">{summary?.strongestArea}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
              Largest opportunity
            </dt>
            <dd className="mt-1 font-medium">{summary?.largestOpportunity}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
              Pages analyzed
            </dt>
            <dd className="tabular mt-1 font-medium">{pages.length}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
              Audit type
            </dt>
            <dd className="mt-1 font-medium">
              {audit.auditType === "compliance" ? "Brand compliance" : "Brand consistency"}
            </dd>
          </div>
        </dl>
      </section>

      {/* --- breakdown ------------------------------------------------------ */}
      <section className="mt-14">
        <h2 className="text-[12px] uppercase tracking-[0.16em]" style={{ color: "var(--muted)" }}>
          Score breakdown
        </h2>
        <div className="mt-5">
          <ScoreBreakdown
            categories={categories}
            projected={previewOpened ? preview?.projectedCategoryScores : null}
          />
        </div>
      </section>

      {/* --- findings ------------------------------------------------------- */}
      <section className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[12px] uppercase tracking-[0.16em]" style={{ color: "var(--muted)" }}>
            Top issues
          </h2>
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>
            <span className="tabular font-medium" style={{ color: "var(--ink)" }}>
              {summary?.totalFindings ?? findings.length}
            </span>{" "}
            inconsistencies found ·{" "}
            <span style={{ color: "var(--good)" }}>{summary?.autoFixable ?? 0} auto-fixable</span> ·{" "}
            {summary?.needsReview ?? 0} need review
            {summary?.needsAssetReview ? ` · ${summary.needsAssetReview} need asset review` : ""}
          </p>
        </div>

        {findings.length === 0 ? (
          <p className="mt-5 text-[15px]" style={{ color: "var(--ink-soft)" }}>
            We didn&apos;t find meaningful inconsistencies on the pages we analyzed. Your visual
            system is applied consistently.
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {findings.map((finding, index) => (
              <FindingCard key={finding.id} finding={finding} index={index} auditId={audit.id} />
            ))}
          </ul>
        )}
      </section>

      {/* --- preview -------------------------------------------------------- */}
      <section className="mt-16 scroll-mt-8" ref={previewRef}>
        <h2 className="text-[12px] uppercase tracking-[0.16em]" style={{ color: "var(--muted)" }}>
          Estimated after remediation
        </h2>

        {hasComparison && preview ? (
          <>
            <div className="mt-4 flex flex-wrap items-baseline gap-4">
              <p className="tabular text-[34px] font-semibold tracking-[-0.03em]">
                {audit.brandScore}
                <span className="mx-2.5 opacity-40">→</span>
                <span style={{ color: "var(--good)" }}>{projected}</span>
              </p>
              <p className="text-[13px]" style={{ color: "var(--muted)" }}>
                Estimated after fixes — measured by re-scanning your site with the fixes applied.
              </p>
            </div>

            <p className="mt-4 text-[13px]" style={{ color: "var(--muted)" }}>
              Showing{" "}
              <span className="font-medium" style={{ color: "var(--ink)" }}>
                {pathOf(preview.pageUrl)}
              </span>{" "}
              — the page these fixes change the most.
            </p>

            <div className="mt-4">
              <BeforeAfter
                beforeUrl={preview.beforeUrl!}
                afterUrl={preview.afterUrl!}
                auditId={audit.id}
              />
            </div>

            <ul className="mt-5 grid gap-3 sm:grid-cols-3">
              {preview.changes.map((change) => (
                <li
                  key={change.label}
                  className="rounded-xl p-4"
                  style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
                >
                  <p className="text-[14px] font-medium tracking-tight">{change.label}</p>
                  <p className="mt-1.5 font-mono text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
                    <span style={{ color: "var(--bad)" }}>{truncate(change.before)}</span>
                    <span className="mx-1.5">→</span>
                    <span style={{ color: "var(--good)" }}>{truncate(change.after)}</span>
                  </p>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-[12px]" style={{ color: "var(--muted)" }}>
              This preview changes styling only. Your content, structure, imagery and identity are
              untouched, and your live site has not been modified.
            </p>
          </>
        ) : (
          <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
            {improves
              ? `We estimate ${audit.brandScore} → ${projected} after fixes, but couldn't render a visual preview of this site.`
              : "We didn't find enough high-confidence, safely fixable issues to build a preview for this site."}
          </p>
        )}

        <div className="mt-8">
          <FixMyBrand auditId={audit.id} />
        </div>
      </section>

      <footer className="mt-16 border-t pt-6 text-[12px] leading-relaxed" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
        Brand Score measures internal visual consistency across the pages we analyzed — not design
        quality or taste. Accessibility results are signals, not a compliance certification.
      </footer>
    </main>
  );
}

function truncate(value: string, max = 28): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" ? "your homepage" : parsed.pathname;
  } catch {
    return url;
  }
}
