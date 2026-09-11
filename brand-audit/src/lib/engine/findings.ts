import { getRightsResolver } from "@/lib/licensing";
import type {
  AuditType, Deviation, DeviationKind, Finding,
} from "@/lib/types";
import { penaltyOf } from "./deviations";

/**
 * Turns deviations into the handful of findings a user actually reads
 * (spec section 12: top 5-10, not 100 tiny issues).
 *
 * Wording is load-bearing. Without a brand guide we never claim a violation —
 * only a difference from the site's own dominant pattern (spec section 3D).
 */

interface Copy {
  title: string;
  /** Overrides `title` when the headline should name the specific property. */
  titleFor?: (d: Deviation) => string;
  describe: (d: Deviation, auditType: AuditType) => string;
  recommend: (d: Deviation) => string;
}

const COPY: Record<DeviationKind, Copy> = {
  heading_font_family: {
    title: "Headings use more than one typeface",
    describe: (d) =>
      `Most headings are set in ${d.dominant}. ${d.elements} heading${plural(d.elements)} ${verb(d.elements)} ${d.observed} instead.`,
    recommend: (d) => `Set the affected headings in ${firstToken(d.dominant)}.`,
  },
  heading_font_weight: {
    title: "Heading weight varies",
    describe: (d) =>
      `The dominant heading treatment is ${d.dominant}, but ${d.elements} heading${plural(d.elements)} ${d.elements === 1 ? "renders" : "render"} as ${d.observed}.`,
    recommend: (d) => `Normalise these headings to ${d.dominant}.`,
  },
  body_font_family: {
    title: "Body text uses more than one typeface",
    describe: (d) =>
      `Body copy is mostly ${d.dominant}. ${d.elements} element${plural(d.elements)} ${verb(d.elements)} ${d.observed}.`,
    recommend: (d) => `Set body copy in ${firstToken(d.dominant)} throughout.`,
  },
  font_family_count: {
    title: "Several typefaces in use",
    describe: (d) => `We found ${d.observed}. Most brand systems settle on two or three.`,
    recommend: () => "Consolidate to a display face, a text face, and (optionally) a mono face.",
  },
  type_scale_noise: {
    title: "Type sizes don't follow a scale",
    describe: (d) => `${capitalize(d.observed)} appear where a repeating scale would be expected.`,
    recommend: () => "Define a type scale and map each role to one step on it.",
  },
  near_duplicate_color: {
    title: "Near-identical colours in use",
    describe: (d) =>
      `${d.observed} ${d.observed.includes(",") ? "are" : "is"} visually the same colour as ` +
      `${d.dominant}, but ${d.observed.includes(",") ? "are" : "is"} defined separately.`,
    recommend: (d) => `Standardise on ${d.dominant} everywhere these appear.`,
  },
  palette_sprawl: {
    title: "The palette has grown wide",
    describe: (d) => `${capitalize(d.observed)} carry identity across the pages we analyzed.`,
    recommend: () => "Reduce to a primary, a secondary, an accent, and a neutral ramp.",
  },
  link_color_inconsistent: {
    title: "Links aren't one colour",
    describe: (d) =>
      `Most links use ${d.dominant}; ${d.elements} use ${d.observed}.`,
    recommend: (d) => `Use ${d.dominant} for links site-wide.`,
  },
  button_variant_sprawl: {
    title: "Several different button treatments",
    describe: (d) =>
      `We counted ${d.observed} across ${d.pages.length} page${plural(d.pages.length)}, varying in fill, radius and weight.`,
    recommend: () => "Collapse to a primary, secondary and tertiary button.",
  },
  button_radius: {
    title: "Button corner radius varies",
    describe: (d) =>
      `The dominant treatment is ${d.dominant}. ${d.elements} button${plural(d.elements)} ${verb(d.elements)} ${d.observed}.`,
    recommend: (d) => `Apply ${firstToken(d.dominant)} to every primary button.`,
  },
  button_font_weight: {
    title: "Button label weight varies",
    describe: (d) =>
      `Most buttons use weight ${d.dominant}; ${d.elements} ${verb(d.elements)} weight ${d.observed}.`,
    recommend: (d) => `Normalise button labels to weight ${d.dominant}.`,
  },
  button_color: {
    title: "Call-to-action colour has drifted",
    describe: (d) =>
      `Primary buttons are mostly ${d.dominant}, but ${d.elements} use ${d.observed} — close enough to look like a mistake rather than a second style.`,
    recommend: (d) => `Use ${d.dominant} for every primary call to action.`,
  },
  radius_sprawl: {
    title: "Corner radii vary across components",
    describe: (d) => `${capitalize(d.observed)} are in use.`,
    recommend: (d) => `Standardise on ${d.dominant} with one alternate for large surfaces.`,
  },
  spacing_off_scale: {
    title: "Spacing doesn't follow one scale",
    describe: (d) => `${capitalize(d.observed)}, where ${d.dominant} would be expected.`,
    recommend: () => "Adopt a single spacing scale and use its steps for padding.",
  },
  icon_family_mix: {
    title: "Icons come from more than one set",
    describe: (d) => `${capitalize(d.observed)} appear together, which reads as two different icon systems.`,
    recommend: (d) => `Standardise on ${d.dominant}.`,
  },
  emoji_icons: {
    title: "Emoji used as iconography",
    describe: (d) => `${capitalize(d.observed)}. Emoji render differently on every platform.`,
    recommend: () => "Replace emoji with icons from your icon set.",
  },
  imagery_style_mix: {
    title: "Image treatment varies",
    describe: (d) => `${capitalize(d.observed)}`,
    recommend: () => "Agree one photographic or illustrative treatment and apply it consistently.",
  },
  logo_variants: {
    title: "Multiple logo files in use",
    describe: (d) =>
      `${capitalize(d.observed)}. Some of these may be legitimate variants (inverse, compact), which is worth confirming.`,
    recommend: () => "Confirm which logo files are approved and retire the rest.",
  },
  contrast_fail: {
    title: "Some text may be hard to read",
    describe: (d) => `${capitalize(d.observed)} against the background behind them.`,
    recommend: () => "Darken or lighten the affected text until it clears AA contrast.",
  },
  missing_alt: {
    title: "Images without alt text",
    describe: (d) => `${capitalize(d.observed)}. Screen readers announce these as unlabelled.`,
    recommend: () => "Add descriptive alt text, or mark decorative images with an empty alt.",
  },
  tiny_text: {
    title: "Very small text",
    describe: (d) => `${capitalize(d.observed)}, which is below the usual readable minimum.`,
    recommend: () => "Raise small copy to at least 12px.",
  },
  rule_violation: {
    title: "Differs from your brand guide",
    titleFor: (d) => {
      const property = d.evidence[0]?.property ?? "";
      if (property === "font-family") return "Typeface differs from your brand guide";
      if (property === "border-radius") return "Corner radius differs from your brand guide";
      if (property.includes("color")) return "Colour differs from your brand guide";
      return "Differs from your brand guide";
    },
    describe: (d) =>
      `Your brand guide specifies ${firstToken(d.dominant)}. ` +
      `${d.elements} element${plural(d.elements)} ${verb(d.elements)} ${d.observed}.`,
    recommend: (d) => `Apply ${firstToken(d.dominant)} to the affected elements.`,
  },
};

export async function buildFindings(
  auditId: string,
  deviations: Deviation[],
  auditType: AuditType,
  limit: number,
): Promise<Finding[]> {
  // Merge deviations that describe the same issue so the user sees one card per
  // problem, not one per offending value.
  const groups = new Map<string, Deviation[]>();
  for (const d of deviations) {
    const key = `${d.kind}|${d.dominant}`;
    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }

  const merged = [...groups.values()].map(mergeGroup);
  merged.sort((a, b) => penaltyOf(b) - penaltyOf(a));

  const resolver = getRightsResolver();
  const findings: Finding[] = [];

  for (const d of merged.slice(0, limit)) {
    const copy = COPY[d.kind];
    const classification =
      auditType === "consistency" && d.classification === "violation"
        ? "probable_drift"
        : d.classification;

    let assetRequirement: Finding["assetRequirement"] = null;
    const isTypefaceRule =
      d.kind === "rule_violation" && d.evidence[0]?.property === "font-family";
    if (d.kind === "heading_font_family" || d.kind === "body_font_family" || isTypefaceRule) {
      const target = firstToken(d.dominant);
      const resolved = await resolver.resolveFont(target);
      // Only surface licensing when it actually gates the fix.
      if (resolved.status !== "open_source") assetRequirement = resolved;
    }

    findings.push({
      id: `${auditId}-${d.id}`,
      auditId,
      category: d.category,
      classification,
      severity: d.severity,
      confidence: Math.round(d.confidence * 100) / 100,
      title: copy.titleFor?.(d) ?? copy.title,
      description: copy.describe(d, auditType),
      currentState: d.observed,
      recommendedState: d.dominant,
      evidence: d.evidence,
      recommendation: copy.recommend(d),
      autoRemediable: d.autoRemediable && assetRequirement === null,
      pagesAffected: d.pages,
      elementsAffected: d.elements,
      assetRequirement,
    });
  }

  return findings;
}

function mergeGroup(group: Deviation[]): Deviation {
  if (group.length === 1) return group[0]!;
  const primary = [...group].sort((a, b) => penaltyOf(b) - penaltyOf(a))[0]!;
  return {
    ...primary,
    observed: [...new Set(group.map((d) => d.observed))].join(", "),
    elements: group.reduce((n, d) => n + d.elements, 0),
    pages: [...new Set(group.flatMap((d) => d.pages))],
    evidence: group.flatMap((d) => d.evidence).slice(0, 4),
    minorityShare: Math.min(0.9, group.reduce((n, d) => n + d.minorityShare, 0)),
    fix: primary.fix,
  };
}

/** Spec section 12's counts: auto-fixable / needs review / needs asset review. */
export function summarizeFindings(findings: Finding[]) {
  return {
    total: findings.length,
    autoFixable: findings.filter((f) => f.autoRemediable).length,
    needsReview: findings.filter((f) => !f.autoRemediable && !f.assetRequirement).length,
    needsAssetReview: findings.filter((f) => Boolean(f.assetRequirement)).length,
  };
}

function plural(n: number): string { return n === 1 ? "" : "s"; }
function verb(n: number): string { return n === 1 ? "uses" : "use"; }
function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
/** "Inter (12 of 18 H1 headings)" -> "Inter"; "8px radius (...)" -> "8px radius". */
function firstToken(s: string): string { return s.split(" (")[0]!.trim(); }
