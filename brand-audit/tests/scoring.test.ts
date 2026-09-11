import assert from "node:assert/strict";
import { test } from "node:test";
import { detectDeviations, penaltyOf, shareFactor } from "@/lib/engine/deviations";
import { scoreDeviations } from "@/lib/engine/scoring";
import { buildStyleProfile } from "@/lib/engine/style-profile";
import { consistentSite, el, page } from "./fixtures";

function analyze(pages: ReturnType<typeof consistentSite>) {
  const profile = buildStyleProfile(pages);
  const deviations = detectDeviations({ pages, profile, rules: [] });
  return { deviations, score: scoreDeviations(deviations, "consistency") };
}

test("a consistent site scores high", () => {
  const { score } = analyze(consistentSite());
  assert.ok(score.overall >= 90, `expected >= 90, got ${score.overall}`);
});

test("a minority heading typeface is detected and costs typography score", () => {
  const pages = consistentSite();
  pages[0]!.elements.push(
    el({ role: "h1", fontFamily: "Arial", fontWeight: 700, fontSize: 40, selector: "h1.alt" }),
  );

  const { deviations, score } = analyze(pages);
  const drift = deviations.find((d) => d.kind === "heading_font_family");
  assert.ok(drift, "expected a heading font deviation");
  assert.equal(drift!.observed, "Arial");
  assert.equal(drift!.classification, "probable_drift");
  assert.ok(drift!.autoRemediable && drift!.fix, "should be auto-remediable");

  const typography = score.categories.find((c) => c.category === "typography")!;
  assert.ok(typography.score < 100, "typography should be penalised");
  assert.ok(typography.score > 80, `one outlier shouldn't be catastrophic: ${typography.score}`);
});

test("an eclectic-by-design split is treated as a second style, not as drift", () => {
  const pages = consistentSite();
  // Half the headings in a second face: deliberate, not accidental.
  for (let i = 0; i < 9; i++) {
    pages[0]!.elements.push(
      el({ role: "h1", fontFamily: "Playfair Display", fontWeight: 700, fontSize: 40, selector: `h1.b${i}` }),
    );
  }
  const { deviations } = analyze(pages);
  const drift = deviations.find((d) => d.kind === "heading_font_family")!;
  assert.equal(drift.classification, "enhancement", "a ~50/50 split is a second style");
  assert.ok(shareFactor(drift.minorityShare) <= 0.6, "large shares are discounted");
});

test("near-duplicate brand greens are reported as one colour that drifted", () => {
  const pages = consistentSite();
  pages[0]!.elements.push(
    el({ role: "button", backgroundColor: "rgb(0, 166, 68)", color: "rgb(255,255,255)",
         borderRadius: 8, fontWeight: 600, selector: "a.cta", text: "Buy" }),
  );
  const { deviations } = analyze(pages);
  const color = deviations.find((d) => d.kind === "button_color");
  assert.ok(color, "expected CTA colour drift");
  assert.equal(color!.dominant, "#00b74f");
  assert.equal(color!.fix?.declarations["background-color"], "#00b74f");
});

test("button radius drift is detected with the dominant treatment as the target", () => {
  const pages = consistentSite();
  pages[0]!.elements.push(
    el({ role: "button", backgroundColor: "rgb(0, 183, 79)", color: "rgb(255,255,255)",
         borderRadius: 20, fontWeight: 600, selector: "button.pricing", text: "Choose plan" }),
  );
  const { deviations } = analyze(pages);
  const radius = deviations.find((d) => d.kind === "button_radius")!;
  assert.match(radius.dominant, /^8px radius/);
  assert.equal(radius.observed, "20px radius");
  assert.equal(radius.fix?.declarations["border-radius"], "8px");
});

test("failing contrast is detected and gets a hue-preserving fix", () => {
  const pages = [page("https://example.com/", [
    ...consistentSite()[0]!.elements,
    ...Array.from({ length: 4 }, (_, i) =>
      el({ role: "body", color: "rgb(200, 200, 200)", effectiveBackground: "rgb(255,255,255)",
           selector: `p.faint${i}` })),
  ])];
  const { deviations, score } = analyze(pages);
  const contrast = deviations.find((d) => d.kind === "contrast_fail")!;
  assert.ok(contrast, "expected a contrast deviation");
  assert.ok(contrast.fix, "contrast should be fixable in the preview");
  assert.ok(score.categories.find((c) => c.category === "accessibility")!.score < 100);
});

test("scores are deterministic across runs", () => {
  const a = analyze(consistentSite()).score.overall;
  const b = analyze(consistentSite()).score.overall;
  assert.equal(a, b);
});

test("low-confidence deviations cannot materially move the score", () => {
  const subjective = {
    id: "x", category: "visual" as const, kind: "imagery_style_mix" as const,
    dominant: "photography", observed: "mixed", minorityShare: 0.25, confidence: 0.55,
    severity: "low" as const, classification: "enhancement" as const, elements: 4,
    pages: [], evidence: [], weight: 20, autoRemediable: false,
  };
  assert.ok(penaltyOf(subjective) < 8, `subjective penalty too large: ${penaltyOf(subjective)}`);
});

test("share factor peaks in the drift band and falls off for deliberate splits", () => {
  assert.ok(shareFactor(0.08) < shareFactor(0.3));
  assert.ok(shareFactor(0.5) < shareFactor(0.35));
  assert.equal(shareFactor(0), 0);
});
