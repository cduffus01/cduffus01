import { CATEGORY_LABELS, config } from "@/lib/config";
import type { AuditCategory, AuditType, CategoryScore, Deviation } from "@/lib/types";
import { penaltyOf } from "./deviations";

/**
 * Scoring engine (spec section 10). Deterministic and pure: the same
 * deviations always produce the same score, and no model opinion enters here.
 */

export interface ScoreResult {
  overall: number;
  categories: CategoryScore[];
}

export function categoryWeights(auditType: AuditType): Record<string, number> {
  return auditType === "compliance"
    ? { ...config.scoring.complianceWeights }
    : { ...config.scoring.weights };
}

export function scoreDeviations(
  deviations: Deviation[],
  auditType: AuditType,
): ScoreResult {
  const weights = categoryWeights(auditType);
  const categories: CategoryScore[] = [];

  for (const [category, weight] of Object.entries(weights)) {
    const relevant = deviations.filter((d) => d.category === category);
    const penalty = combinePenalties(relevant.map(penaltyOf));
    categories.push({
      category: category as AuditCategory,
      label: CATEGORY_LABELS[category] ?? category,
      score: clamp(Math.round(100 - penalty)),
      weight,
      deviationCount: relevant.length,
    });
  }

  const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0) || 1;
  const overall = clamp(
    Math.round(
      categories.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight,
    ),
  );

  return { overall, categories };
}

/**
 * Combines penalties with diminishing returns rather than summing them.
 *
 * One drifted page typically trips several detectors at once — button sprawl,
 * radius, weight and fill colour are four readings of the same mistake. Summing
 * them would drive a category to near-zero for a single underlying problem,
 * which reads as broken rather than as informative. The largest penalty applies
 * in full and each subsequent one counts for less.
 */
export function combinePenalties(penalties: number[]): number {
  return [...penalties]
    .sort((a, b) => b - a)
    .reduce((total, penalty, index) => total + penalty * DECAY ** index, 0);
}

const DECAY = 0.6;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function strongestArea(categories: CategoryScore[]): CategoryScore | null {
  return [...categories].sort((a, b) => b.score - a.score)[0] ?? null;
}

/**
 * The largest opportunity is the category where fixing drift buys the most
 * overall score — weight matters, not just the raw category score.
 */
export function largestOpportunity(categories: CategoryScore[]): CategoryScore | null {
  return [...categories]
    .filter((c) => c.score < 100)
    .sort((a, b) => (100 - b.score) * b.weight - (100 - a.score) * a.weight)[0] ?? null;
}
