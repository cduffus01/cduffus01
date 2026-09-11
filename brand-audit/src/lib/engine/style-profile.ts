import type {
  ButtonPattern, CapturedElement, CapturedPage, ColorCluster, SiteStyleProfile,
  StyleToken, TypographyPattern,
} from "@/lib/types";
import { clusterColors, isNeutral, parseColor, toHex, type ColorSample } from "./color";

/**
 * Builds the site's *apparent* design system from the harvested pages
 * (spec section 8). This is an observation, not a judgement: nothing here
 * decides what is right, only what the site actually does and how often.
 */

export function normalizeFontFamily(raw: string): string {
  const first = (raw || "").split(",")[0] ?? "";
  return first.replace(/["']/g, "").trim() || "unknown";
}

/** Font sizes are bucketed to 1px: sub-pixel noise is not a design decision. */
const roundSize = (n: number) => Math.round(n);

/** Weights are quantized to the 9 CSS steps a designer would actually pick. */
export function normalizeWeight(weight: number): number {
  const steps = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  return steps.reduce((best, s) =>
    Math.abs(s - weight) < Math.abs(best - weight) ? s : best, 400);
}

export function buttonSignature(el: CapturedElement): string {
  return [
    toHexSafe(el.backgroundColor),
    toHexSafe(el.color),
    normalizeFontFamily(el.fontFamily),
    normalizeWeight(el.fontWeight),
    Math.round(el.borderRadius),
  ].join("|");
}

function toHexSafe(css: string): string {
  const rgb = parseColor(css);
  return rgb && rgb.a > 0.05 ? toHex(rgb) : "transparent";
}

export function buildStyleProfile(pages: CapturedPage[]): SiteStyleProfile {
  const typography = buildTypography(pages);
  const buttons = buildButtons(pages);
  const colors = buildColors(pages);

  const radii = tally(
    pages.flatMap((p) =>
      p.elements
        .filter((e) => e.role === "button" || e.role === "card" || e.borderWidth > 0)
        .map((e) => Math.round(e.borderRadius)),
    ),
  ).map(([value, frequency]) => ({ value, frequency }));

  const spacingPatterns = tally(
    pages.flatMap((p) =>
      p.elements.flatMap((e) => [e.padding[0], e.padding[3]].map((v) => Math.round(v))),
    ).filter((v) => v > 0),
  )
    .map(([value, frequency]) => ({ value, frequency }))
    .slice(0, 16);

  const logoTally = new Map<string, number>();
  for (const page of pages) {
    for (const img of page.images) {
      if (!img.isLogoCandidate) continue;
      logoTally.set(img.src, (logoTally.get(img.src) ?? 0) + 1);
    }
  }
  const logos = [...logoTally.entries()]
    .map(([src, occurrences]) => ({ src, occurrences, variants: logoTally.size }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 8);

  const allIcons = pages.flatMap((p) => p.icons);
  const families = [...new Set(allIcons.map((i) => i.family).filter(Boolean) as string[])];
  const icons = {
    families,
    filled: allIcons.filter((i) => i.kind === "svg" && i.filled).length,
    outlined: allIcons.filter((i) => i.kind === "svg" && !i.filled).length,
    emoji: allIcons.filter((i) => i.kind === "emoji").length,
  };

  return {
    colors,
    typography,
    buttons,
    spacingPatterns,
    radii,
    logos,
    icons,
    imagery: { dominantStyle: null, notes: [], confidence: 0, source: "unavailable" },
    pagePatterns: pages.map((p) => ({ pageType: p.pageType, url: p.url })),
  };
}

function buildTypography(pages: CapturedPage[]): TypographyPattern[] {
  const map = new Map<string, TypographyPattern>();
  for (const page of pages) {
    for (const el of page.elements) {
      if (el.role === "input") continue;
      if (!el.text && el.role !== "button") continue;
      const family = normalizeFontFamily(el.fontFamily);
      const weight = normalizeWeight(el.fontWeight);
      const size = roundSize(el.fontSize);
      const key = `${el.role}|${family}|${weight}|${size}`;
      const existing = map.get(key);
      if (existing) {
        existing.frequency += 1;
        if (!existing.pages.includes(page.url)) existing.pages.push(page.url);
      } else {
        map.set(key, {
          role: el.role, fontFamily: family, fontWeight: weight, fontSize: size,
          frequency: 1, pages: [page.url],
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.frequency - a.frequency);
}

function buildButtons(pages: CapturedPage[]): ButtonPattern[] {
  const map = new Map<string, ButtonPattern>();
  for (const page of pages) {
    for (const el of page.elements) {
      if (el.role !== "button") continue;
      const signature = buttonSignature(el);
      const existing = map.get(signature);
      if (existing) {
        existing.frequency += 1;
        if (!existing.pages.includes(page.url)) existing.pages.push(page.url);
        if (existing.selectors.length < 6) existing.selectors.push(el.selector);
      } else {
        map.set(signature, {
          signature,
          backgroundColor: toHexSafe(el.backgroundColor),
          color: toHexSafe(el.color),
          fontFamily: normalizeFontFamily(el.fontFamily),
          fontWeight: normalizeWeight(el.fontWeight),
          fontSize: roundSize(el.fontSize),
          borderRadius: Math.round(el.borderRadius),
          paddingY: Math.round(el.padding[0]),
          paddingX: Math.round(el.padding[3]),
          frequency: 1,
          pages: [page.url],
          selectors: [el.selector],
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.frequency - a.frequency);
}

function buildColors(pages: CapturedPage[]): ColorCluster[] {
  const samples: ColorSample[] = [];
  for (const page of pages) {
    for (const el of page.elements) {
      const push = (css: string, role: string, weight = 1) => {
        const rgb = parseColor(css);
        if (!rgb || rgb.a < 0.2) return;
        samples.push({ hex: toHex(rgb), frequency: weight, role, page: page.url });
      };
      push(el.color, `text:${el.role}`);
      if (el.role === "button") {
        // A CTA fill is the strongest brand-colour signal on a page.
        push(el.backgroundColor, "cta", 4);
      }
      if (el.role === "link") push(el.color, "link", 2);
      if (el.borderWidth > 0) push(el.borderColor, "border", 0.5);
    }
    for (const bg of page.backgroundColors) {
      const rgb = parseColor(bg.color);
      if (!rgb || rgb.a < 0.2) continue;
      // Surface weight is area-derived but capped: a full-bleed white section
      // should not drown out every other colour on the site.
      samples.push({
        hex: toHex(rgb),
        frequency: Math.min(6, Math.max(1, Math.round(bg.area / 250_000))),
        role: "surface",
        page: page.url,
      });
    }
  }

  return clusterColors(samples).map((c) => ({
    canonical: c.canonical,
    members: c.members.sort((a, b) => b.frequency - a.frequency),
    frequency: Math.round(c.frequency * 10) / 10,
    roles: [...c.roles],
    pages: [...c.pages],
  }));
}

/** Brand colours are the non-neutral clusters actually used for identity. */
export function brandColors(profile: SiteStyleProfile): ColorCluster[] {
  return profile.colors.filter((c) => {
    const rgb = parseColor(c.canonical);
    if (!rgb || isNeutral(rgb)) return false;
    return c.roles.some((r) => r === "cta" || r === "link" || r === "surface" || r.startsWith("text"));
  });
}

function tally<T>(values: T[]): [T, number][] {
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** Flattens the profile into the StyleToken rows of the data model. */
export function toStyleTokens(auditId: string, profile: SiteStyleProfile): StyleToken[] {
  const tokens: StyleToken[] = [];
  let n = 0;
  const id = () => `${auditId}-t${n++}`;

  for (const c of profile.colors.slice(0, 24)) {
    tokens.push({
      id: id(), auditId, type: "color", value: c.members[0]?.hex ?? c.canonical,
      normalizedValue: c.canonical, frequency: c.frequency, pages: c.pages,
      role: c.roles.join(","),
    });
  }
  for (const t of profile.typography.slice(0, 40)) {
    tokens.push({
      id: id(), auditId, type: "font-family", value: t.fontFamily,
      normalizedValue: `${t.fontFamily} ${t.fontWeight}`, frequency: t.frequency,
      pages: t.pages, role: t.role,
    });
    tokens.push({
      id: id(), auditId, type: "font-size", value: `${t.fontSize}px`,
      normalizedValue: `${t.fontSize}`, frequency: t.frequency, pages: t.pages, role: t.role,
    });
  }
  for (const r of profile.radii.slice(0, 12)) {
    tokens.push({
      id: id(), auditId, type: "radius", value: `${r.value}px`,
      normalizedValue: `${r.value}`, frequency: r.frequency, pages: [],
    });
  }
  for (const s of profile.spacingPatterns.slice(0, 12)) {
    tokens.push({
      id: id(), auditId, type: "spacing", value: `${s.value}px`,
      normalizedValue: `${s.value}`, frequency: s.frequency, pages: [],
    });
  }
  return tokens;
}
