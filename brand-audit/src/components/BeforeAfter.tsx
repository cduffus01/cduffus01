"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/client-analytics";

/**
 * Draggable before/after comparison (spec section 14).
 *
 * Both images are the user's own homepage: the same page, re-rendered with the
 * remediation CSS applied. Nothing here is AI-generated imagery.
 */
export function BeforeAfter({
  beforeUrl,
  afterUrl,
  auditId,
}: {
  beforeUrl: string;
  afterUrl: string;
  auditId: string;
}) {
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  const moveTo = useCallback((clientX: number) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return;
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.max(2, Math.min(98, next)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => moveTo(event.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, moveTo]);

  return (
    <div
      ref={frame}
      className="compare-handle relative w-full select-none overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--line)", background: "var(--paper)" }}
      onPointerDown={(event) => {
        setDragging(true);
        moveTo(event.clientX);
        trackEvent("before_after_interacted", auditId);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={afterUrl} alt="Your page with the suggested fixes applied" className="block w-full" />

      {/*
        The "before" image is laid out at the full frame width and revealed by
        clipping, so both screenshots stay pixel-aligned at every handle
        position — sizing the overlay itself would scale one of them.
      */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={beforeUrl} alt="Your page today" className="block w-full" />
      </div>

      <div
        className="pointer-events-none absolute inset-y-0"
        style={{ left: `${position}%`, width: 2, background: "var(--accent)" }}
      >
        <div
          className="absolute top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[12px] font-semibold text-white"
          style={{ background: "var(--accent)", boxShadow: "var(--shadow)" }}
          aria-hidden
        >
          ↔
        </div>
      </div>

      <span
        className="pointer-events-none absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em]"
        style={{ background: "rgb(12 12 13 / 0.72)", color: "#fff" }}
      >
        Now
      </span>
      <span
        className="pointer-events-none absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em]"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        Fixed
      </span>

      <label className="sr-only" htmlFor="compare-range">
        Compare before and after
      </label>
      <input
        id="compare-range"
        type="range"
        min={2}
        max={98}
        value={Math.round(position)}
        onChange={(event) => setPosition(Number(event.target.value))}
        className="absolute bottom-3 left-1/2 w-1/2 -translate-x-1/2 opacity-0 focus:opacity-100"
      />
    </div>
  );
}
