import Link from "next/link";
import type { AuditError } from "@/lib/types";

/**
 * Failure states are explicit and honest (spec section 34): we would rather
 * show nothing than fabricate a Brand Score.
 */
export function AuditFailure({ error, url }: { error: AuditError; url: string }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[540px] flex-col justify-center py-16">
      <p className="text-[13px]" style={{ color: "var(--muted)" }}>
        {url}
      </p>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">
        We couldn&apos;t complete this audit.
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
        {error.userMessage}
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-xl px-5 py-3 text-[15px] font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          Try another site
        </Link>
      </div>

      <p className="mt-8 text-[13px]" style={{ color: "var(--muted)" }}>
        We don&apos;t generate a Brand Score when we can&apos;t see enough of a site — a
        made-up number would be worse than none.
      </p>
    </div>
  );
}
