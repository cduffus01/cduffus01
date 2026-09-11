const RADIUS = 78;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function toneFor(score: number): string {
  if (score >= 80) return "var(--good)";
  if (score >= 65) return "var(--accent)";
  return "var(--warn)";
}

/** The one number the whole product is judged on. */
export function ScoreRing({
  score,
  band,
  projected,
}: {
  score: number;
  band: string;
  projected?: number | null;
}) {
  const offset = CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, score)) / 100);
  const tone = toneFor(score);

  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: 180, height: 180 }}>
        <svg width="180" height="180" viewBox="0 0 180 180" aria-hidden>
          <circle
            cx="90" cy="90" r={RADIUS} fill="none" strokeWidth="11"
            stroke="var(--line)"
          />
          <circle
            className="ring-progress"
            cx="90" cy="90" r={RADIUS} fill="none" strokeWidth="11"
            stroke={tone}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 90 90)"
            style={{ ["--circumference" as string]: `${CIRCUMFERENCE}` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-[54px] font-semibold leading-none tracking-[-0.04em]">
            {score}
          </span>
          <span className="mt-1 text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--muted)" }}>
            / 100
          </span>
        </div>
      </div>

      <div>
        <p className="text-[12px] uppercase tracking-[0.16em]" style={{ color: "var(--muted)" }}>
          Brand Score
        </p>
        <p className="mt-1.5 text-[22px] font-semibold tracking-tight" style={{ color: tone }}>
          {band}
        </p>
        {typeof projected === "number" && projected > score ? (
          <p className="tabular mt-3 text-[14px]" style={{ color: "var(--muted)" }}>
            Estimated after fixes:{" "}
            <span className="font-semibold" style={{ color: "var(--good)" }}>
              {projected}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
