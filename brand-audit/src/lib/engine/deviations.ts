import type {
  BrandRule, CapturedElement, CapturedPage, Deviation, DeviationKind, Evidence,
  Severity, SiteStyleProfile,
} from "@/lib/types";
import {
  aaThreshold, colorDistance, contrastRatio, isNeutral, parseColor, toHex,
} from "./color";
import { brandColors, normalizeFontFamily, normalizeWeight } from "./style-profile";

/**
 * Deviation detection — the single source of truth for the whole product.
 *
 * Scores are a pure function of these. Findings are a rendering of these.
 * Remediation CSS is a translation of these. Because all three read the same
 * records, the score can never disagree with what the user is shown.
 *
 * A deviation is always expressed relative to a *dominant pattern*, never to an
 * outside opinion about good design. Without a brand guide we say "differs from
 * the dominant pattern on this site"; with one, the guide's rule replaces the
 * inferred dominant pattern (spec sections 3D and 10).
 */

export interface PositionedElement extends CapturedElement {
  pageUrl: string;
  /**
   * 1 / (number of pages this exact selector appears on).
   *
   * Site chrome repeats: one navigation CTA renders on all four pages, and
   * counting each render would let a single design decision outvote the rest of
   * the site. Weighting by repetition makes each decision count once in total
   * while keeping per-page elements at full weight.
   */
  sampleWeight: number;
}

export interface DeviationContext {
  pages: CapturedPage[];
  profile: SiteStyleProfile;
  rules: BrandRule[];
}

/**
 * Areas an explicit brand rule governs.
 *
 * Where the guide speaks, inference must stay quiet: otherwise a site whose
 * headings are consistently the *wrong* typeface gets told to standardise on
 * the wrong one, contradicting the violation raised against the same elements.
 * Canonical rule beats inferred majority (spec section 10).
 */
function governedAreas(rules: BrandRule[]): Set<string> {
  const governed = new Set<string>();
  for (const rule of rules) {
    if (rule.source !== "brand_guide") continue;
    const body = rule.rule;
    if (body.kind === "font-family") governed.add(`font-family:${body.role}`);
    if (body.kind === "radius") governed.add("radius:button");
    if (body.kind === "color") governed.add(`color:${body.role}`);
  }
  return governed;
}

/** Points of category score a deviation can cost at full share and confidence. */
const WEIGHTS: Record<DeviationKind, number> = {
  heading_font_family: 30,
  heading_font_weight: 12,
  body_font_family: 26,
  font_family_count: 15,
  type_scale_noise: 12,
  near_duplicate_color: 26,
  palette_sprawl: 20,
  link_color_inconsistent: 14,
  button_variant_sprawl: 30,
  button_radius: 20,
  button_font_weight: 12,
  button_color: 22,
  radius_sprawl: 14,
  spacing_off_scale: 12,
  icon_family_mix: 25,
  emoji_icons: 18,
  imagery_style_mix: 20,
  logo_variants: 16,
  contrast_fail: 40,
  missing_alt: 22,
  tiny_text: 14,
  rule_violation: 45,
};

/**
 * How much a deviation's population share contributes to its penalty.
 *
 * Rises linearly to a peak at ~35% and then falls: a treatment used by a third
 * of elements is drift, but one used by half is a second design system the site
 * chose on purpose, and a deliberately eclectic site should not be punished for
 * being eclectic (spec section 32).
 */
export function shareFactor(share: number): number {
  const s = Math.max(0, Math.min(1, share));
  if (s <= 0.35) return s / 0.35;
  return Math.max(0.5, 1 - ((s - 0.35) / 0.15) * 0.5);
}

export function penaltyOf(d: Deviation): number {
  return Math.min(d.weight, d.weight * shareFactor(d.minorityShare) * d.confidence);
}

function severityFor(kind: DeviationKind, share: number, confidence: number): Severity {
  const impact = WEIGHTS[kind] * shareFactor(share) * confidence;
  if (impact >= 14) return "high";
  if (impact >= 6) return "medium";
  return "low";
}

let counter = 0;
function makeDeviation(input: Omit<Deviation, "id" | "weight" | "severity"> & {
  weight?: number;
}): Deviation {
  const weight = input.weight ?? WEIGHTS[input.kind];
  return {
    ...input,
    id: `d${(counter = (counter + 1) % 1e6)}-${input.kind}`,
    weight,
    severity: severityFor(input.kind, input.minorityShare, input.confidence),
  };
}

function allElements(pages: CapturedPage[]): PositionedElement[] {
  const repeats = new Map<string, number>();
  for (const page of pages) {
    for (const element of page.elements) {
      repeats.set(element.selector, (repeats.get(element.selector) ?? 0) + 1);
    }
  }
  return pages.flatMap((page) =>
    page.elements.map((element) => ({
      ...element,
      pageUrl: page.url,
      sampleWeight: 1 / (repeats.get(element.selector) ?? 1),
    })),
  );
}

function evidenceFrom(
  elements: PositionedElement[],
  property: string,
  observed: (e: PositionedElement) => string,
  expected: string,
  limit = 3,
): Evidence[] {
  return elements.slice(0, limit).map((e) => ({
    pageUrl: e.pageUrl,
    selector: e.selector,
    text: e.text || undefined,
    property,
    observed: observed(e),
    expected,
  }));
}

const uniquePages = (elements: PositionedElement[]) => [...new Set(elements.map((e) => e.pageUrl))];

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/** Repetition-adjusted size of a group of elements. */
function weightOf(items: PositionedElement[]): number {
  return items.reduce((total, element) => total + element.sampleWeight, 0);
}

/** How much a treatment recurring across pages counts for beyond its size. */
const PAGE_SPREAD_BONUS = 0.5;

/**
 * Picks the site's dominant pattern.
 *
 * Size matters, but so does reach: drift concentrates on one page — that is
 * what makes it drift — while the real system recurs across the site. A
 * treatment on three pages therefore beats a slightly larger cluster confined
 * to one. Lexical order is the final tie-break, purely so results stay
 * reproducible.
 */
function dominantGroup(
  groups: Map<string, PositionedElement[]>,
): { key: string; items: PositionedElement[] } | null {
  let best: { key: string; items: PositionedElement[]; score: number } | null = null;
  for (const [key, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pages = uniquePages(items).length;
    const score = weightOf(items) * (1 + PAGE_SPREAD_BONUS * (pages - 1));
    if (!best || score > best.score) best = { key, items, score };
  }
  return best ? { key: best.key, items: best.items } : null;
}

/** Share of the site's design decisions that deviate, adjusted for repetition. */
function shareOf(items: PositionedElement[], pool: PositionedElement[]): number {
  return weightOf(items) / Math.max(1e-6, weightOf(pool));
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

function typographyDeviations(ctx: DeviationContext): Deviation[] {
  const out: Deviation[] = [];
  const elements = allElements(ctx.pages);
  const governed = governedAreas(ctx.rules);

  for (const role of ["h1", "h2", "h3", "body"] as const) {
    const pool = elements.filter((e) => e.role === role && e.text);
    if (pool.length < 4) continue;
    // The guide already defines this role's typeface; the compliance engine
    // owns it from here.
    const familyGoverned = governed.has(`font-family:${role}`);

    const byFamily = groupBy(pool, (e) => normalizeFontFamily(e.fontFamily));
    const dominant = dominantGroup(byFamily);
    if (!dominant) continue;

    for (const [family, items] of byFamily) {
      if (familyGoverned) break;
      if (family === dominant.key) continue;
      const share = shareOf(items, pool);
      const kind: DeviationKind = role === "body" ? "body_font_family" : "heading_font_family";
      out.push(makeDeviation({
        category: "typography",
        kind,
        dominant: `${dominant.key} (${dominant.items.length} of ${pool.length} ${label(role)})`,
        observed: family,
        minorityShare: share,
        confidence: 0.97,
        classification: share > 0.45 ? "enhancement" : "probable_drift",
        elements: items.length,
        pages: uniquePages(items),
        evidence: evidenceFrom(items, "font-family", (e) => normalizeFontFamily(e.fontFamily), dominant.key),
        autoRemediable: true,
        fix: {
          selectors: items.map((e) => e.selector),
          declarations: { "font-family": quoteFamily(dominant.items[0]!.fontFamily) },
        },
      }));
    }

    // Weight consistency is only meaningful within the dominant family.
    const sameFamily = dominant.items;
    if (sameFamily.length >= 4 && role !== "body") {
      const byWeight = groupBy(sameFamily, (e) => String(normalizeWeight(e.fontWeight)));
      const dominantWeight = dominantGroup(byWeight);
      if (dominantWeight) {
        for (const [weight, items] of byWeight) {
          if (weight === dominantWeight.key) continue;
          if (Math.abs(Number(weight) - Number(dominantWeight.key)) < 100) continue;
          const share = shareOf(items, sameFamily);
          out.push(makeDeviation({
            category: "typography",
            kind: "heading_font_weight",
            dominant: `${dominant.key} ${dominantWeight.key}`,
            observed: `${dominant.key} ${weight}`,
            minorityShare: share,
            confidence: 0.9,
            classification: share > 0.45 ? "enhancement" : "probable_drift",
            elements: items.length,
            pages: uniquePages(items),
            evidence: evidenceFrom(items, "font-weight", (e) => String(normalizeWeight(e.fontWeight)), dominantWeight.key),
            autoRemediable: true,
            fix: {
              selectors: items.map((e) => e.selector),
              declarations: { "font-weight": dominantWeight.key },
            },
          }));
        }
      }
    }
  }

  // Whole-site family count. Three families (display, body, mono) is normal.
  const families = new Map<string, number>();
  for (const e of elements) {
    const f = normalizeFontFamily(e.fontFamily);
    if (f === "unknown") continue;
    families.set(f, (families.get(f) ?? 0) + 1);
  }
  const meaningful = [...families.entries()].filter(([, n]) => n >= 2);
  if (meaningful.length > 3) {
    const excess = meaningful.length - 3;
    out.push(makeDeviation({
      category: "typography",
      kind: "font_family_count",
      dominant: "3 or fewer typefaces",
      observed: `${meaningful.length} typefaces: ${meaningful.slice(0, 6).map(([f]) => f).join(", ")}`,
      minorityShare: Math.min(0.5, excess * 0.12),
      confidence: 0.85,
      classification: "enhancement",
      elements: meaningful.length,
      pages: ctx.pages.map((p) => p.url),
      evidence: [],
      autoRemediable: false,
    }));
  }

  // Type-scale noise: many near-identical sizes inside one role is accidental,
  // not a scale.
  for (const role of ["h2", "body"] as const) {
    const pool = elements.filter((e) => e.role === role && e.text);
    if (pool.length < 8) continue;
    const sizes = new Set(pool.map((e) => Math.round(e.fontSize)));
    if (sizes.size > 4) {
      const excess = sizes.size - 4;
      out.push(makeDeviation({
        category: "typography",
        kind: "type_scale_noise",
        dominant: `a tight size scale for ${label(role)}`,
        observed: `${sizes.size} distinct sizes: ${[...sizes].sort((a, b) => a - b).join(", ")}px`,
        minorityShare: Math.min(0.45, excess * 0.09),
        confidence: 0.7,
        classification: "enhancement",
        elements: pool.length,
        pages: uniquePages(pool),
        evidence: [],
        autoRemediable: false,
      }));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function colorDeviations(ctx: DeviationContext): Deviation[] {
  const out: Deviation[] = [];
  const elements = allElements(ctx.pages);

  // The headline deterministic signal: several hexes that are perceptually one
  // colour (#00B74F / #00B84F / #00B74E).
  for (const cluster of ctx.profile.colors) {
    if (cluster.members.length < 2) continue;
    const canonical = parseColor(cluster.canonical);
    if (!canonical) continue;
    // Any member defined under a different hex is drift: the values are one
    // colour perceptually, but the site maintains them as separate definitions.
    const drifted = cluster.members.filter((m) => m.hex !== cluster.canonical);
    if (drifted.length === 0) continue;
    const neutral = isNeutral(canonical);
    const driftFreq = drifted.reduce((n, m) => n + m.frequency, 0);
    const share = driftFreq / Math.max(1, cluster.frequency);

    const affected = elements.filter((e) =>
      drifted.some((m) => matchesColor(e, m.hex)),
    );

    out.push(makeDeviation({
      category: "colors",
      kind: "near_duplicate_color",
      dominant: cluster.canonical,
      observed: drifted.map((m) => m.hex).join(", "),
      minorityShare: share,
      confidence: neutral ? 0.7 : 0.93,
      // A neutral that drifts is usually a rendering artefact, not brand drift.
      classification: neutral ? "enhancement" : "probable_drift",
      elements: Math.max(affected.length, drifted.length),
      pages: cluster.pages,
      evidence: affected.length
        ? evidenceFrom(affected, "color", (e) => observedColorOf(e, drifted.map((m) => m.hex)), cluster.canonical)
        : drifted.slice(0, 3).map((m) => ({
            pageUrl: cluster.pages[0] ?? "",
            selector: "(computed styles)",
            property: "color",
            observed: m.hex,
            expected: cluster.canonical,
          })),
      // Neutrals are left alone in the preview: nudging near-whites is invisible
      // and risks changing surfaces the site relies on.
      autoRemediable: !neutral && affected.length > 0,
      fix: neutral || affected.length === 0 ? undefined : buildColorFix(affected, drifted.map((m) => m.hex), cluster.canonical),
      weight: neutral ? WEIGHTS.near_duplicate_color * 0.4 : WEIGHTS.near_duplicate_color,
    }));
  }

  // Palette sprawl: how many distinct non-neutral colours carry identity.
  const brand = brandColors(ctx.profile).filter((c) => c.frequency >= 2);
  if (brand.length > 6) {
    const excess = brand.length - 6;
    out.push(makeDeviation({
      category: "colors",
      kind: "palette_sprawl",
      dominant: "a focused palette (up to 6 identity colours)",
      observed: `${brand.length} distinct colours: ${brand.slice(0, 8).map((c) => c.canonical).join(", ")}`,
      minorityShare: Math.min(0.5, excess * 0.07),
      confidence: 0.75,
      classification: "enhancement",
      elements: brand.length,
      pages: ctx.pages.map((p) => p.url),
      evidence: [],
      autoRemediable: false,
    }));
  }

  // Link colour consistency.
  const links = elements.filter((e) => e.role === "link" && e.text);
  if (links.length >= 6) {
    const byColor = groupBy(links, (e) => hexOf(e.color));
    const dominant = dominantGroup(byColor);
    if (dominant) {
      for (const [hex, items] of byColor) {
        if (hex === dominant.key || hex === "none") continue;
        const a = parseColor(hex);
        const b = parseColor(dominant.key);
        // Ignore hover/visited-style micro-differences; those are handled by
        // the near-duplicate detector instead.
        if (a && b && colorDistance(a, b) < 0.05) continue;
        const share = shareOf(items, links);
        if (share < 0.05) continue;
        out.push(makeDeviation({
          category: "colors",
          kind: "link_color_inconsistent",
          dominant: dominant.key,
          observed: hex,
          minorityShare: share,
          confidence: 0.8,
          classification: share > 0.45 ? "enhancement" : "probable_drift",
          elements: items.length,
          pages: uniquePages(items),
          evidence: evidenceFrom(items, "color", (e) => hexOf(e.color), dominant.key),
          autoRemediable: false,
        }));
      }
    }
  }

  return out;
}

function matchesColor(e: CapturedElement, hex: string): boolean {
  return hexOf(e.color) === hex || hexOf(e.backgroundColor) === hex || hexOf(e.borderColor) === hex;
}

function observedColorOf(e: CapturedElement, hexes: string[]): string {
  if (hexes.includes(hexOf(e.color))) return hexOf(e.color);
  if (hexes.includes(hexOf(e.backgroundColor))) return hexOf(e.backgroundColor);
  return hexOf(e.borderColor);
}

function buildColorFix(
  elements: PositionedElement[],
  driftedHexes: string[],
  canonical: string,
): Deviation["fix"] {
  // Fixes are split by which property carries the drifted colour, so we never
  // repaint a background when only the text colour drifted.
  const text = elements.filter((e) => driftedHexes.includes(hexOf(e.color)));
  const background = elements.filter((e) => driftedHexes.includes(hexOf(e.backgroundColor)));
  const border = elements.filter((e) => driftedHexes.includes(hexOf(e.borderColor)));
  if (background.length >= text.length && background.length >= border.length) {
    return { selectors: background.map((e) => e.selector), declarations: { "background-color": canonical } };
  }
  if (text.length >= border.length) {
    return { selectors: text.map((e) => e.selector), declarations: { color: canonical } };
  }
  return { selectors: border.map((e) => e.selector), declarations: { "border-color": canonical } };
}

function hexOf(css: string): string {
  const rgb = parseColor(css);
  return rgb && rgb.a > 0.05 ? toHex(rgb) : "none";
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function componentDeviations(ctx: DeviationContext): Deviation[] {
  const out: Deviation[] = [];
  const elements = allElements(ctx.pages);
  const governed = governedAreas(ctx.rules);
  const buttons = elements.filter((e) => e.role === "button");
  if (buttons.length < 3) return out;

  const variants = ctx.profile.buttons.filter((b) => b.frequency >= 1);
  // Primary + secondary + ghost is a reasonable system; beyond that is sprawl.
  if (variants.length > 3) {
    const excess = variants.length - 3;
    const minorityCount = variants.slice(3).reduce((n, v) => n + v.frequency, 0);
    out.push(makeDeviation({
      category: "components",
      kind: "button_variant_sprawl",
      dominant: `${Math.min(3, variants.length)} button treatments`,
      observed: `${variants.length} distinct button treatments`,
      minorityShare: Math.max(minorityCount / Math.max(1, buttons.length), Math.min(0.45, excess * 0.08)),
      confidence: 0.88,
      classification: "probable_drift",
      elements: buttons.length,
      pages: uniquePages(buttons),
      evidence: variants.slice(0, 4).map((v) => ({
        pageUrl: v.pages[0] ?? "",
        selector: v.selectors[0] ?? "",
        property: "button",
        observed: `${v.backgroundColor} / ${v.borderRadius}px / ${v.fontWeight}`,
        expected: `${variants[0]!.backgroundColor} / ${variants[0]!.borderRadius}px / ${variants[0]!.fontWeight}`,
      })),
      autoRemediable: false,
    }));
  }

  const dominantButton = ctx.profile.buttons[0];
  if (!dominantButton) return out;

  // Radius. Skipped when the guide states one: the violation covers it.
  const byRadius = groupBy(buttons, (e) => String(Math.round(e.borderRadius)));
  const dominantRadius = governed.has("radius:button") ? null : dominantGroup(byRadius);
  if (dominantRadius) {
    for (const [radius, items] of byRadius) {
      if (radius === dominantRadius.key) continue;
      if (Math.abs(Number(radius) - Number(dominantRadius.key)) < 2) continue;
      const share = shareOf(items, buttons);
      out.push(makeDeviation({
        category: "components",
        kind: "button_radius",
        dominant: `${dominantRadius.key}px radius (${dominantRadius.items.length} of ${buttons.length} buttons)`,
        observed: `${radius}px radius`,
        minorityShare: share,
        confidence: 0.95,
        classification: share > 0.45 ? "enhancement" : "probable_drift",
        elements: items.length,
        pages: uniquePages(items),
        evidence: evidenceFrom(items, "border-radius", (e) => `${Math.round(e.borderRadius)}px`, `${dominantRadius.key}px`),
        autoRemediable: true,
        fix: {
          selectors: items.map((e) => e.selector),
          declarations: { "border-radius": `${dominantRadius.key}px` },
        },
      }));
    }
  }

  // Weight.
  const byWeight = groupBy(buttons, (e) => String(normalizeWeight(e.fontWeight)));
  const dominantWeight = dominantGroup(byWeight);
  if (dominantWeight) {
    for (const [weight, items] of byWeight) {
      if (weight === dominantWeight.key) continue;
      if (Math.abs(Number(weight) - Number(dominantWeight.key)) < 100) continue;
      const share = shareOf(items, buttons);
      out.push(makeDeviation({
        category: "components",
        kind: "button_font_weight",
        dominant: dominantWeight.key,
        observed: weight,
        minorityShare: share,
        confidence: 0.9,
        classification: share > 0.45 ? "enhancement" : "probable_drift",
        elements: items.length,
        pages: uniquePages(items),
        evidence: evidenceFrom(items, "font-weight", (e) => String(normalizeWeight(e.fontWeight)), dominantWeight.key),
        autoRemediable: true,
        fix: {
          selectors: items.map((e) => e.selector),
          declarations: { "font-weight": dominantWeight.key },
        },
      }));
    }
  }

  // Fill colour drift among filled buttons (the "#00B74F vs #00A644" case).
  const filled = buttons.filter((e) => hexOf(e.backgroundColor) !== "none");
  if (filled.length >= 3 && !governed.has("color:cta") && !governed.has("color:primary")) {
    const byBg = groupBy(filled, (e) => hexOf(e.backgroundColor));
    const dominantBg = dominantGroup(byBg);
    if (dominantBg) {
      const canonical = parseColor(dominantBg.key);
      for (const [hex, items] of byBg) {
        if (hex === dominantBg.key) continue;
        const rgb = parseColor(hex);
        if (!rgb || !canonical) continue;
        const distance = colorDistance(rgb, canonical);
        // Far-away fills are a different button variant, not drift; the sprawl
        // detector already covers those.
        if (distance > 0.12) continue;
        const share = shareOf(items, filled);
        out.push(makeDeviation({
          category: "components",
          kind: "button_color",
          dominant: dominantBg.key,
          observed: hex,
          minorityShare: share,
          confidence: 0.92,
          classification: "probable_drift",
          elements: items.length,
          pages: uniquePages(items),
          evidence: evidenceFrom(items, "background-color", (e) => hexOf(e.backgroundColor), dominantBg.key),
          autoRemediable: true,
          fix: {
            selectors: items.map((e) => e.selector),
            declarations: { "background-color": dominantBg.key },
          },
        }));
      }
    }
  }

  // Radius sprawl across all rounded surfaces.
  const rounded = ctx.profile.radii.filter((r) => r.value > 0 && r.frequency >= 2);
  if (rounded.length > 3) {
    out.push(makeDeviation({
      category: "components",
      kind: "radius_sprawl",
      dominant: `${rounded[0]!.value}px corner radius`,
      observed: `${rounded.length} distinct radii: ${rounded.slice(0, 6).map((r) => `${r.value}px`).join(", ")}`,
      minorityShare: Math.min(0.4, (rounded.length - 3) * 0.08),
      confidence: 0.72,
      classification: "enhancement",
      elements: rounded.reduce((n, r) => n + r.frequency, 0),
      pages: ctx.pages.map((p) => p.url),
      evidence: [],
      autoRemediable: false,
    }));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Visual style
// ---------------------------------------------------------------------------

function visualDeviations(ctx: DeviationContext): Deviation[] {
  const out: Deviation[] = [];
  const { icons, logos, imagery } = ctx.profile;

  if (icons.families.length > 1) {
    out.push(makeDeviation({
      category: "visual",
      kind: "icon_family_mix",
      dominant: `${icons.families[0]} icons`,
      observed: `${icons.families.length} icon sets: ${icons.families.join(", ")}`,
      minorityShare: Math.min(0.4, (icons.families.length - 1) * 0.15),
      confidence: 0.75,
      classification: "probable_drift",
      elements: icons.filled + icons.outlined,
      pages: ctx.pages.map((p) => p.url),
      evidence: [],
      autoRemediable: false,
    }));
  }

  // Filled and outlined icons side by side read as two different icon sets.
  const svgTotal = icons.filled + icons.outlined;
  if (svgTotal >= 6) {
    const minority = Math.min(icons.filled, icons.outlined);
    const share = minority / svgTotal;
    if (share > 0.15) {
      out.push(makeDeviation({
        category: "visual",
        kind: "icon_family_mix",
        dominant: icons.filled > icons.outlined ? "filled icons" : "outlined icons",
        observed: `${icons.filled} filled and ${icons.outlined} outlined icons`,
        minorityShare: share,
        confidence: 0.65,
        classification: "probable_drift",
        elements: svgTotal,
        pages: ctx.pages.map((p) => p.url),
        evidence: [],
        autoRemediable: false,
      }));
    }
  }

  if (icons.emoji > 0 && svgTotal > 0) {
    out.push(makeDeviation({
      category: "visual",
      kind: "emoji_icons",
      dominant: "a single icon system",
      observed: `${icons.emoji} emoji used alongside ${svgTotal} drawn icons`,
      minorityShare: Math.min(0.4, icons.emoji / Math.max(1, svgTotal + icons.emoji)),
      confidence: 0.8,
      classification: "probable_drift",
      elements: icons.emoji,
      pages: ctx.pages.map((p) => p.url),
      evidence: [],
      autoRemediable: false,
    }));
  }

  if (logos.length > 2) {
    out.push(makeDeviation({
      category: "visual",
      kind: "logo_variants",
      dominant: "one or two logo files",
      observed: `${logos.length} distinct logo images`,
      minorityShare: Math.min(0.35, (logos.length - 2) * 0.1),
      // Inverse and compact marks are legitimate, so confidence stays low and
      // this is surfaced as something to check, never as a violation.
      confidence: 0.5,
      classification: "enhancement",
      elements: logos.length,
      pages: ctx.pages.map((p) => p.url),
      evidence: logos.slice(0, 3).map((l) => ({
        pageUrl: ctx.pages[0]?.url ?? "",
        selector: "img",
        property: "logo",
        observed: l.src,
        expected: "a single primary logo file",
      })),
      autoRemediable: false,
    }));
  }

  // Vision-derived. Confidence is capped at 0.6 by the vision module, so this
  // can never materially move the score (spec section 3F).
  if (imagery.source === "vision" && imagery.notes.length > 0 && imagery.confidence > 0) {
    out.push(makeDeviation({
      category: "visual",
      kind: "imagery_style_mix",
      dominant: imagery.dominantStyle ?? "a consistent image treatment",
      observed: imagery.notes[0]!,
      minorityShare: 0.25,
      confidence: Math.min(0.6, imagery.confidence),
      classification: "enhancement",
      elements: ctx.pages.reduce((n, p) => n + p.images.length, 0),
      pages: ctx.pages.map((p) => p.url),
      evidence: [],
      autoRemediable: false,
    }));
  }

  // Spacing scale adherence: padding values that sit off the site's own base unit.
  const paddings = allElements(ctx.pages)
    .flatMap((e) => [e.padding[0], e.padding[3]])
    .map((v) => Math.round(v))
    .filter((v) => v > 0);
  if (paddings.length >= 30) {
    const base = inferBaseUnit(paddings);
    const offScale = paddings.filter((v) => v % base !== 0);
    const share = offScale.length / paddings.length;
    if (share > 0.2) {
      out.push(makeDeviation({
        category: "visual",
        kind: "spacing_off_scale",
        dominant: `a ${base}px spacing scale`,
        observed: `${Math.round(share * 100)}% of spacing values are off that scale`,
        minorityShare: share,
        confidence: 0.55,
        classification: "enhancement",
        elements: offScale.length,
        pages: ctx.pages.map((p) => p.url),
        evidence: [],
        autoRemediable: false,
      }));
    }
  }

  return out;
}

function inferBaseUnit(values: number[]): number {
  let best = 4;
  let bestHits = -1;
  for (const unit of [8, 6, 4]) {
    const hits = values.filter((v) => v % unit === 0).length;
    if (hits > bestHits) { bestHits = hits; best = unit; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Accessibility signals (spec section 18 — signals, never a certification)
// ---------------------------------------------------------------------------

function accessibilityDeviations(ctx: DeviationContext): Deviation[] {
  const out: Deviation[] = [];
  const elements = allElements(ctx.pages);
  const textual = elements.filter((e) => e.text && e.role !== "input");

  if (textual.length >= 8) {
    const failures: { el: PositionedElement; ratio: number; threshold: number }[] = [];
    for (const el of textual) {
      const fg = parseColor(el.color);
      const bgOwn = parseColor(el.backgroundColor);
      const bg = bgOwn && bgOwn.a > 0.5 ? bgOwn : parseColor(el.effectiveBackground);
      if (!fg || !bg) continue;
      const threshold = aaThreshold(el.fontSize, el.fontWeight);
      const ratio = contrastRatio(fg, bg);
      if (ratio < threshold) failures.push({ el, ratio, threshold });
    }
    if (failures.length > 0) {
      const share = failures.length / textual.length;
      const worst = [...failures].sort((a, b) => a.ratio - b.ratio);
      out.push(makeDeviation({
        category: "accessibility",
        kind: "contrast_fail",
        dominant: "WCAG AA contrast (4.5:1 body, 3:1 large text)",
        observed: `${failures.length} of ${textual.length} text elements fall below AA contrast`,
        minorityShare: share,
        confidence: 0.95,
        classification: "probable_drift",
        elements: failures.length,
        pages: uniquePages(failures.map((f) => f.el)),
        evidence: worst.slice(0, 3).map((f) => ({
          pageUrl: f.el.pageUrl,
          selector: f.el.selector,
          text: f.el.text || undefined,
          property: "contrast",
          observed: `${f.ratio.toFixed(2)}:1`,
          expected: `${f.threshold}:1`,
        })),
        autoRemediable: true,
        fix: buildContrastFix(worst),
      }));
    }
  }

  const images = ctx.pages.flatMap((p) => p.images.map((i) => ({ ...i, pageUrl: p.url })));
  const meaningful = images.filter((i) => i.width >= 24 && i.height >= 24);
  const missingAlt = meaningful.filter((i) => i.alt === null);
  if (meaningful.length >= 3 && missingAlt.length > 0) {
    out.push(makeDeviation({
      category: "accessibility",
      kind: "missing_alt",
      dominant: "every meaningful image has an alt attribute",
      observed: `${missingAlt.length} of ${meaningful.length} images have no alt attribute`,
      minorityShare: missingAlt.length / meaningful.length,
      confidence: 0.98,
      classification: "probable_drift",
      elements: missingAlt.length,
      pages: [...new Set(missingAlt.map((i) => i.pageUrl))],
      evidence: missingAlt.slice(0, 3).map((i) => ({
        pageUrl: i.pageUrl,
        selector: `img[src$="${i.src.split("/").pop()?.slice(0, 40) ?? ""}"]`,
        property: "alt",
        observed: "missing",
        expected: "descriptive alt text",
      })),
      // Alt text is copy, not CSS: a human writes it (spec section 12's
      // "needs review" bucket).
      autoRemediable: false,
    }));
  }

  const body = textual.filter((e) => e.role === "body" || e.role === "caption");
  const tiny = body.filter((e) => e.fontSize > 0 && e.fontSize < 12);
  if (body.length >= 10 && tiny.length > 0) {
    out.push(makeDeviation({
      category: "accessibility",
      kind: "tiny_text",
      dominant: "body text at 12px or larger",
      observed: `${tiny.length} elements below 12px`,
      minorityShare: tiny.length / body.length,
      confidence: 0.85,
      classification: "enhancement",
      elements: tiny.length,
      pages: uniquePages(tiny),
      evidence: evidenceFrom(tiny, "font-size", (e) => `${Math.round(e.fontSize)}px`, "12px or larger"),
      autoRemediable: false,
    }));
  }

  return out;
}

/**
 * Darkens or lightens the failing text colour along its own hue until it clears
 * AA. Hue is preserved, so the fix never changes the brand colour's identity.
 */
function buildContrastFix(
  failures: { el: PositionedElement; ratio: number; threshold: number }[],
): Deviation["fix"] {
  // Group by the replacement colour and fix only the largest group, so one
  // rule never repaints text that needed a different correction.
  const groups = new Map<string, string[]>();
  for (const f of failures) {
    // A button label's colour is bound to its fill: the right correction is
    // usually to the fill, which is a design decision rather than a safe
    // automatic fix. We still report these; we just don't preview them.
    if (f.el.role === "button") continue;
    const fg = parseColor(f.el.color);
    const bgOwn = parseColor(f.el.backgroundColor);
    const bg = bgOwn && bgOwn.a > 0.5 ? bgOwn : parseColor(f.el.effectiveBackground);
    if (!fg || !bg) continue;
    const fixed = adjustForContrast(fg, bg, f.threshold);
    if (!fixed) continue;
    const group = groups.get(fixed);
    if (group) group.push(f.el.selector);
    else groups.set(fixed, [f.el.selector]);
  }

  const largest = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!largest) return undefined;
  return { selectors: largest[1].slice(0, 24), declarations: { color: largest[0] } };
}

export function adjustForContrast(
  fg: { r: number; g: number; b: number; a: number },
  bg: { r: number; g: number; b: number; a: number },
  threshold: number,
): string | null {
  const darkenTowardBlack = contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, bg) >= threshold;
  for (let step = 0.05; step <= 1.0001; step += 0.05) {
    const t = darkenTowardBlack ? 1 - step : 1 - step;
    const candidate = darkenTowardBlack
      ? { r: fg.r * t, g: fg.g * t, b: fg.b * t, a: 1 }
      : { r: fg.r + (255 - fg.r) * step, g: fg.g + (255 - fg.g) * step, b: fg.b + (255 - fg.b) * step, a: 1 };
    if (contrastRatio(candidate, bg) >= threshold) return toHex(candidate);
  }
  return darkenTowardBlack ? "#000000" : "#ffffff";
}

// ---------------------------------------------------------------------------
// Brand-guide compliance (spec sections 10 and 11)
// ---------------------------------------------------------------------------

function complianceDeviations(ctx: DeviationContext): Deviation[] {
  const rules = ctx.rules.filter((r) => r.source === "brand_guide");
  if (rules.length === 0) return [];
  const out: Deviation[] = [];
  const elements = allElements(ctx.pages);

  for (const rule of rules) {
    const body = rule.rule;
    if (body.kind === "undefined-area") continue;

    if (body.kind === "font-family") {
      const pool = elements.filter((e) => e.role === body.role && e.text);
      if (pool.length === 0) continue;
      const offenders = pool.filter(
        (e) => normalizeFontFamily(e.fontFamily).toLowerCase() !== body.value.toLowerCase(),
      );
      if (offenders.length === 0) continue;
      out.push(makeDeviation({
        category: "compliance",
        kind: "rule_violation",
        dominant: `${body.value} (brand guide)`,
        observed: [...new Set(offenders.map((e) => normalizeFontFamily(e.fontFamily)))].join(", "),
        minorityShare: offenders.length / pool.length,
        confidence: Math.min(0.97, rule.confidence),
        // Only an explicit rule licenses the word "violation" (spec section 11).
        classification: "violation",
        elements: offenders.length,
        pages: uniquePages(offenders),
        evidence: evidenceFrom(offenders, "font-family", (e) => normalizeFontFamily(e.fontFamily), body.value),
        autoRemediable: true,
        fix: {
          selectors: offenders.map((e) => e.selector),
          declarations: { "font-family": quoteFamily(body.value) },
        },
      }));
    }

    if (body.kind === "color") {
      const canonical = parseColor(body.value);
      if (!canonical) continue;
      const pool = body.role === "cta"
        ? elements.filter((e) => e.role === "button" && hexOf(e.backgroundColor) !== "none")
        : elements;
      const offenders = pool.filter((e) => {
        const observed = parseColor(body.role === "cta" ? e.backgroundColor : e.color);
        if (!observed) return false;
        const distance = colorDistance(observed, canonical);
        // Near-but-not-equal is the violation we care about: the intent is the
        // brand colour, the execution drifted.
        return distance > 0.01 && distance < 0.1;
      });
      if (offenders.length === 0) continue;
      out.push(makeDeviation({
        category: "compliance",
        kind: "rule_violation",
        dominant: `${body.value} (brand guide)`,
        observed: [...new Set(offenders.map((e) => hexOf(body.role === "cta" ? e.backgroundColor : e.color)))].join(", "),
        minorityShare: offenders.length / Math.max(1, pool.length),
        confidence: Math.min(0.95, rule.confidence),
        classification: "violation",
        elements: offenders.length,
        pages: uniquePages(offenders),
        evidence: evidenceFrom(offenders, body.role === "cta" ? "background-color" : "color",
          (e) => hexOf(body.role === "cta" ? e.backgroundColor : e.color), body.value),
        autoRemediable: true,
        fix: {
          selectors: offenders.map((e) => e.selector),
          declarations: body.role === "cta"
            ? { "background-color": body.value }
            : { color: body.value },
        },
      }));
    }

    if (body.kind === "radius") {
      const pool = elements.filter((e) => e.role === "button");
      const offenders = pool.filter((e) => Math.abs(e.borderRadius - body.value) > 1);
      if (offenders.length === 0 || pool.length === 0) continue;
      out.push(makeDeviation({
        category: "compliance",
        kind: "rule_violation",
        dominant: `${body.value}px radius (brand guide)`,
        observed: [...new Set(offenders.map((e) => `${Math.round(e.borderRadius)}px`))].join(", "),
        minorityShare: offenders.length / pool.length,
        confidence: Math.min(0.95, rule.confidence),
        classification: "violation",
        elements: offenders.length,
        pages: uniquePages(offenders),
        evidence: evidenceFrom(offenders, "border-radius", (e) => `${Math.round(e.borderRadius)}px`, `${body.value}px`),
        autoRemediable: true,
        fix: {
          selectors: offenders.map((e) => e.selector),
          declarations: { "border-radius": `${body.value}px` },
        },
      }));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------

export function detectDeviations(ctx: DeviationContext): Deviation[] {
  return [
    ...typographyDeviations(ctx),
    ...colorDeviations(ctx),
    ...componentDeviations(ctx),
    ...visualDeviations(ctx),
    ...accessibilityDeviations(ctx),
    ...complianceDeviations(ctx),
  ].sort((a, b) => penaltyOf(b) - penaltyOf(a));
}

function label(role: string): string {
  return role === "body" ? "body text elements" : `${role.toUpperCase()} headings`;
}

/** CSS-safe family value: quote anything that isn't a bare identifier. */
export function quoteFamily(family: string): string {
  return family
    .split(",")
    .map((part) => {
      const clean = part.replace(/["']/g, "").trim();
      return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(clean) ? clean : `"${clean}"`;
    })
    .join(", ");
}
