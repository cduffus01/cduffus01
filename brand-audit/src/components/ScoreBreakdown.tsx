import type { CategoryScore } from "@/lib/types";

function tone(score: number): string {
  if (score >= 80) return "var(--good)";
  if (score >= 65) return "var(--accent)";
  return "var(--warn)";
}

export function ScoreBreakdown({
  categories,
  projected,
}: {
  categories: CategoryScore[];
  projected?: CategoryScore[] | null;
}) {
  const projectedFor = (category: string) =>
    projected?.find((p) => p.category === category)?.score ?? null;

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {categories.map((category, index) => {
        const after = projectedFor(category.category);
        const improves = after !== null && after > category.score;
        return (
          <li key={category.category} className="rise" style={{ animationDelay: `${index * 60}ms` }}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-medium tracking-tight">{category.label}</span>
              <span className="tabular text-[14px]" style={{ color: "var(--muted)" }}>
                {improves ? (
                  <>
                    {category.score}
                    <span className="mx-1.5 opacity-60">→</span>
                    <span style={{ color: "var(--good)" }}>{after}</span>
                  </>
                ) : (
                  category.score
                )}
              </span>
            </div>
            <div
              className="relative h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--line)" }}
              role="img"
              aria-label={`${category.label}: ${category.score} out of 100`}
            >
              {improves ? (
                <div
                  className="absolute inset-y-0 left-0 rounded-full opacity-30"
                  style={{ width: `${after}%`, background: "var(--good)" }}
                />
              ) : null}
              <div
                className="bar-in absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${category.score}%`,
                  background: tone(category.score),
                  animationDelay: `${index * 60}ms`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
