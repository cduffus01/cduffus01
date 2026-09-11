import type { ProgressState } from "@/lib/types";

const STEPS = [
  "Checking your website...",
  "Scanning your website...",
  "Finding your visual patterns...",
  "Analyzing typography...",
  "Comparing colors...",
  "Checking components...",
  "Calculating your Brand Score...",
  "Creating your preview...",
];

/**
 * Waiting should feel productive (spec section 24). Every state shown here is
 * a real pipeline stage that has actually completed — no invented percentages.
 */
export function AuditProgress({ progress, url }: { progress: ProgressState; url: string }) {
  const done = Math.min(progress.completed, STEPS.length);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[520px] flex-col justify-center py-16">
      <p className="text-[13px]" style={{ color: "var(--muted)" }}>
        Auditing
      </p>
      <h1 className="mt-1 break-all text-[24px] font-semibold tracking-tight">{url}</h1>

      <ol className="mt-10 space-y-3.5">
        {STEPS.map((step, index) => {
          const state = index < done ? "done" : index === done ? "active" : "todo";
          return (
            <li key={step} className="flex items-center gap-3">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]"
                style={{
                  background:
                    state === "done" ? "var(--good)" : state === "active" ? "var(--accent)" : "var(--line)",
                  color: state === "todo" ? "var(--muted)" : "#fff",
                }}
              >
                {state === "done" ? "✓" : ""}
              </span>
              <span
                className={`text-[15px] ${state === "active" ? "pulse-soft font-medium" : ""}`}
                style={{
                  color:
                    state === "todo" ? "var(--muted)" : state === "active" ? "var(--ink)" : "var(--ink-soft)",
                }}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-10">
        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{
              width: `${Math.round((done / STEPS.length) * 100)}%`,
              background: "var(--accent)",
            }}
          />
        </div>
        <p className="mt-3 text-[13px]" style={{ color: "var(--muted)" }}>
          This usually takes 30–90 seconds. We open your site in a real browser.
        </p>
      </div>
    </div>
  );
}
