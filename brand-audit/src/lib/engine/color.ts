/**
 * Colour maths. Pure, deterministic, and unit-tested — none of this belongs in
 * an LLM (spec section 20).
 *
 * Clustering runs in OKLab because that is what makes the spec's headline case
 * work: #00B74F / #00B84F / #00B74E are three different strings but one
 * perceptual intent, and should be reported as drift from a single brand
 * colour, not as three brand colours.
 */

export interface Rgb { r: number; g: number; b: number; a: number }

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
  blue: "#0000ff", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", navy: "#000080",
  teal: "#008080", olive: "#808000", maroon: "#800000", lime: "#00ff00",
  aqua: "#00ffff", cyan: "#00ffff", fuchsia: "#ff00ff", magenta: "#ff00ff",
  transparent: "rgba(0,0,0,0)",
};

export function parseColor(input: string | null | undefined): Rgb | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (NAMED[value]) value = NAMED[value]!;

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const expand = (h: string) => parseInt(h.length === 1 ? h + h : h, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]!), g: expand(hex[1]!), b: expand(hex[2]!),
        a: hex.length === 4 ? expand(hex[3]!) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const fn = value.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (p: string) =>
      p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p);
    const alpha = parts[3] === undefined
      ? 1
      : parts[3]!.endsWith("%") ? parseFloat(parts[3]!) / 100 : parseFloat(parts[3]!);
    const rgb = {
      r: channel(parts[0]!), g: channel(parts[1]!), b: channel(parts[2]!),
      a: Number.isFinite(alpha) ? alpha : 1,
    };
    if ([rgb.r, rgb.g, rgb.b].some((c) => !Number.isFinite(c))) return null;
    return rgb;
  }

  const hsl = value.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const parts = hsl[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = ((parseFloat(parts[0]!) % 360) + 360) % 360;
    const s = parseFloat(parts[1]!) / 100;
    const l = parseFloat(parts[2]!) / 100;
    const a = parts[3] === undefined ? 1 : parseFloat(parts[3]!);
    if (![h, s, l].every(Number.isFinite)) return null;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const seg = Math.floor(h / 60) % 6;
    const table: [number, number, number][] = [
      [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ];
    const [r1, g1, b1] = table[seg]!;
    return {
      r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255), a: Number.isFinite(a) ? a : 1,
    };
  }

  return null;
}

export function toHex(c: Rgb): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Composite a translucent colour over an opaque backdrop. */
export function composite(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function srgbToLinear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance. */
export function luminance(c: Rgb): number {
  return (
    0.2126 * srgbToLinear(c.r) +
    0.7152 * srgbToLinear(c.g) +
    0.0722 * srgbToLinear(c.b)
  );
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const f = fg.a < 1 ? composite(fg, bg) : fg;
  const l1 = luminance(f);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA threshold: 3.0 for large text (>=24px, or >=18.66px bold), else 4.5. */
export function aaThreshold(fontSize: number, fontWeight: number): number {
  const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
  return large ? 3 : 4.5;
}

export interface OkLab { L: number; a: number; b: number }

export function toOkLab(c: Rgb): OkLab {
  const r = srgbToLinear(c.r);
  const g = srgbToLinear(c.g);
  const b = srgbToLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Perceptual distance. ~0.02 is "the same colour, drifted"; ~0.1 is clearly different. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const x = toOkLab(a);
  const y = toOkLab(b);
  return Math.sqrt((x.L - y.L) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2);
}

export interface ColorSample { hex: string; frequency: number; role?: string; page?: string }

export interface RawCluster {
  canonical: string;
  members: { hex: string; frequency: number }[];
  frequency: number;
  roles: Set<string>;
  pages: Set<string>;
}

/**
 * Agglomerative single-pass clustering by perceptual distance. Samples are
 * sorted by frequency so the most-used colour becomes the cluster centre —
 * i.e. the canonical value is the one the site already uses most.
 */
export function clusterColors(samples: ColorSample[], threshold = 0.035): RawCluster[] {
  const byHex = new Map<string, ColorSample & { roles: Set<string>; pages: Set<string> }>();
  for (const s of samples) {
    const key = s.hex.toLowerCase();
    const existing = byHex.get(key);
    if (existing) {
      existing.frequency += s.frequency;
      if (s.role) existing.roles.add(s.role);
      if (s.page) existing.pages.add(s.page);
    } else {
      byHex.set(key, {
        ...s, hex: key, frequency: s.frequency,
        roles: new Set(s.role ? [s.role] : []),
        pages: new Set(s.page ? [s.page] : []),
      });
    }
  }

  const sorted = [...byHex.values()].sort((a, b) => b.frequency - a.frequency);
  const clusters: RawCluster[] = [];

  for (const sample of sorted) {
    const rgb = parseColor(sample.hex);
    if (!rgb) continue;
    let best: { cluster: RawCluster; dist: number } | null = null;
    for (const cluster of clusters) {
      const center = parseColor(cluster.canonical);
      if (!center) continue;
      const dist = colorDistance(rgb, center);
      if (dist <= threshold && (!best || dist < best.dist)) best = { cluster, dist };
    }
    if (best) {
      best.cluster.members.push({ hex: sample.hex, frequency: sample.frequency });
      best.cluster.frequency += sample.frequency;
      sample.roles.forEach((r) => best!.cluster.roles.add(r));
      sample.pages.forEach((p) => best!.cluster.pages.add(p));
    } else {
      clusters.push({
        canonical: sample.hex,
        members: [{ hex: sample.hex, frequency: sample.frequency }],
        frequency: sample.frequency,
        roles: new Set(sample.roles),
        pages: new Set(sample.pages),
      });
    }
  }

  return clusters.sort((a, b) => b.frequency - a.frequency);
}

/** True for near-white/near-black/near-grey, which are surfaces, not brand colours. */
export function isNeutral(c: Rgb): boolean {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const chroma = max - min;
  return chroma <= 14;
}
