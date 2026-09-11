"use client";

import { useState } from "react";
import type { Finding } from "@/lib/types";
import { trackEvent } from "@/lib/client-analytics";

const CLASSIFICATION_COPY: Record<Finding["classification"], { label: string; tone: string }> = {
  violation: { label: "Violation", tone: "var(--bad)" },
  probable_drift: { label: "Probable drift", tone: "var(--warn)" },
  enhancement: { label: "Enhancement", tone: "var(--accent)" },
};

function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" ? parsed.hostname : parsed.pathname;
  } catch {
    return url;
  }
}

export function FindingCard({
  finding,
  index,
  auditId,
}: {
  finding: Finding;
  index: number;
  auditId: string;
}) {
  const [open, setOpen] = useState(false);
  const classification = CLASSIFICATION_COPY[finding.classification];

  return (
    <li className="card overflow-hidden">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) trackEvent("finding_expanded", auditId, { category: finding.category });
        }}
        aria-expanded={open}
        className="flex w-full items-start gap-4 p-5 text-left"
      >
        <span
          className="tabular mt-0.5 shrink-0 text-[13px] font-semibold"
          style={{ color: "var(--muted)" }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">{finding.title}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ background: "var(--accent-soft)", color: classification.tone }}
            >
              {classification.label}
            </span>
          </span>
          <span
            className="mt-1.5 block text-[14px] leading-relaxed"
            style={{ color: "var(--ink-soft)" }}
          >
            {finding.description}
          </span>
          <span
            className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]"
            style={{ color: "var(--muted)" }}
          >
            <span>{finding.pagesAffected.length || 1} page{finding.pagesAffected.length === 1 ? "" : "s"}</span>
            <span>{finding.elementsAffected} element{finding.elementsAffected === 1 ? "" : "s"}</span>
            <span className="tabular">{Math.round(finding.confidence * 100)}% confidence</span>
            {finding.autoRemediable ? (
              <span style={{ color: "var(--good)" }}>Auto-fixable</span>
            ) : finding.assetRequirement ? (
              <span style={{ color: "var(--warn)" }}>Needs asset review</span>
            ) : (
              <span>Needs review</span>
            )}
          </span>
        </span>

        <span
          className="mt-1 shrink-0 text-[13px] transition-transform"
          style={{ color: "var(--muted)", transform: open ? "rotate(180deg)" : undefined }}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open ? (
        <div
          className="border-t px-5 py-5 text-[13px]"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
                Found
              </p>
              <p className="mt-1.5 font-mono text-[13px] leading-relaxed" style={{ color: "var(--ink)" }}>
                {finding.currentState}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
                Dominant pattern
              </p>
              <p className="mt-1.5 font-mono text-[13px] leading-relaxed" style={{ color: "var(--good)" }}>
                {finding.recommendedState}
              </p>
            </div>
          </div>

          {finding.evidence.length > 0 ? (
            <div className="mt-5">
              <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
                Evidence
              </p>
              <ul className="mt-2 space-y-2">
                {finding.evidence.map((item, i) => (
                  <li
                    key={`${item.selector}-${i}`}
                    className="rounded-lg px-3 py-2.5"
                    style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
                  >
                    <p className="font-mono text-[12px] break-all" style={{ color: "var(--ink-soft)" }}>
                      {item.selector}
                    </p>
                    {item.text ? (
                      <p className="mt-1 truncate text-[12px]" style={{ color: "var(--muted)" }}>
                        “{item.text}”
                      </p>
                    ) : null}
                    <p className="tabular mt-1.5 text-[12px]">
                      <span style={{ color: "var(--muted)" }}>{item.property}: </span>
                      <span style={{ color: "var(--bad)" }}>{item.observed}</span>
                      <span style={{ color: "var(--muted)" }}> → </span>
                      <span style={{ color: "var(--good)" }}>{item.expected}</span>
                    </p>
                    <p className="mt-1 truncate text-[11px]" style={{ color: "var(--muted)" }}>
                      {hostOf(item.pageUrl)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5">
            <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
              Recommendation
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              {finding.recommendation}
            </p>
          </div>

          {finding.assetRequirement ? (
            <div
              className="mt-5 rounded-xl p-4"
              style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
            >
              <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
                Asset check
              </p>
              <p className="mt-1.5 text-[13px]" style={{ color: "var(--ink-soft)" }}>
                {finding.assetRequirement.note}
              </p>
              {finding.assetRequirement.freeAlternative ? (
                <p className="mt-2 text-[13px]">
                  <span style={{ color: "var(--muted)" }}>Open alternative: </span>
                  <span className="font-medium" style={{ color: "var(--good)" }}>
                    {finding.assetRequirement.freeAlternative}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
