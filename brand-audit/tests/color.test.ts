import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aaThreshold, clusterColors, colorDistance, contrastRatio, isNeutral, parseColor, toHex,
} from "@/lib/engine/color";

test("parses the colour formats computed styles actually return", () => {
  assert.deepEqual(parseColor("rgb(0, 183, 79)"), { r: 0, g: 183, b: 79, a: 1 });
  assert.deepEqual(parseColor("#00B74F"), { r: 0, g: 183, b: 79, a: 1 });
  assert.deepEqual(parseColor("rgba(0, 0, 0, 0.5)"), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.equal(toHex(parseColor("hsl(147, 100%, 36%)")!), "#00b853");
  assert.equal(parseColor("not-a-colour"), null);
  assert.equal(parseColor("transparent")!.a, 0);
});

test("near-identical brand greens cluster as one colour", () => {
  // The case from the spec: three hexes, one intent.
  const clusters = clusterColors([
    { hex: "#00b74f", frequency: 10 },
    { hex: "#00b84f", frequency: 3 },
    { hex: "#00b74e", frequency: 2 },
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]!.canonical, "#00b74f", "most frequent member becomes canonical");
  assert.equal(clusters[0]!.members.length, 3);
});

test("genuinely different colours stay in separate clusters", () => {
  const clusters = clusterColors([
    { hex: "#00b74f", frequency: 10 },
    { hex: "#3b34e8", frequency: 8 },
    { hex: "#ffffff", frequency: 20 },
  ]);
  assert.equal(clusters.length, 3);
});

test("contrast ratio matches the WCAG reference values", () => {
  const black = parseColor("#000000")!;
  const white = parseColor("#ffffff")!;
  assert.equal(Math.round(contrastRatio(black, white) * 100) / 100, 21);
  assert.equal(contrastRatio(white, white), 1);
  // #767676 on white is the canonical 4.54:1 AA boundary case.
  assert.ok(contrastRatio(parseColor("#767676")!, white) >= 4.5);
  assert.ok(contrastRatio(parseColor("#777777")!, white) < 4.6);
});

test("large text uses the 3:1 threshold", () => {
  assert.equal(aaThreshold(16, 400), 4.5);
  assert.equal(aaThreshold(24, 400), 3);
  assert.equal(aaThreshold(19, 700), 3);
});

test("translucent text is composited over its backdrop before measuring", () => {
  const faded = parseColor("rgba(0,0,0,0.35)")!;
  const white = parseColor("#ffffff")!;
  const ratio = contrastRatio(faded, white);
  assert.ok(ratio > 1 && ratio < 4.5, `expected a failing ratio, got ${ratio}`);
});

test("neutrals are recognised so surfaces aren't mistaken for brand colours", () => {
  assert.equal(isNeutral(parseColor("#fafafa")!), true);
  assert.equal(isNeutral(parseColor("#00b74f")!), false);
});

test("perceptual distance separates drift from a different colour", () => {
  const drift = colorDistance(parseColor("#00b74f")!, parseColor("#00b84f")!);
  const different = colorDistance(parseColor("#00b74f")!, parseColor("#3b34e8")!);
  assert.ok(drift < 0.01, `drift should be tiny, got ${drift}`);
  assert.ok(different > 0.3, `distinct colours should be far apart, got ${different}`);
});
