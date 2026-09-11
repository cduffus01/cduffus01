import assert from "node:assert/strict";
import { test } from "node:test";
import { detectDeviations } from "@/lib/engine/deviations";
import { buildFindings, summarizeFindings } from "@/lib/engine/findings";
import { buildRemediationPlan } from "@/lib/engine/remediation";
import { parseGuideDeterministically } from "@/lib/engine/brand-policy";
import { buildStyleProfile } from "@/lib/engine/style-profile";
import type { BrandRule } from "@/lib/types";
import { consistentSite, el } from "./fixtures";

function driftedSite() {
  const pages = consistentSite();
  pages[0]!.elements.push(
    el({ role: "h1", fontFamily: "Arial", fontWeight: 700, fontSize: 40, selector: "h1.alt" }),
    el({ role: "button", backgroundColor: "rgb(0, 166, 68)", color: "rgb(255,255,255)",
         borderRadius: 20, fontWeight: 400, selector: "a.cta", text: "Buy" }),
  );
  return pages;
}

test("without a brand guide nothing is called a violation", async () => {
  const pages = driftedSite();
  const profile = buildStyleProfile(pages);
  const deviations = detectDeviations({ pages, profile, rules: [] });
  const findings = await buildFindings("audit1", deviations, "consistency", 10);

  assert.ok(findings.length > 0);
  assert.equal(findings.some((f) => f.classification === "violation"), false);
  for (const finding of findings) {
    assert.doesNotMatch(finding.description, /violat/i, finding.description);
  }
});

test("with an explicit brand rule, a contradiction is a violation", async () => {
  const pages = driftedSite();
  const rules: BrandRule[] = [{
    id: "r1", auditId: "audit2", source: "brand_guide", category: "typography",
    rule: { kind: "font-family", role: "h1", value: "Freight Text" },
    confidence: 0.9, evidence: "H1 headings are set in Freight Text Medium.",
  }];
  const profile = buildStyleProfile(pages);
  const deviations = detectDeviations({ pages, profile, rules });
  const findings = await buildFindings("audit2", deviations, "compliance", 10);

  const violation = findings.find((f) => f.classification === "violation");
  assert.ok(violation, "expected a brand-guide violation");
  assert.match(violation!.description, /brand guide/i);
});

test("findings are capped, evidenced, and carry confidence", async () => {
  const pages = driftedSite();
  const profile = buildStyleProfile(pages);
  const deviations = detectDeviations({ pages, profile, rules: [] });
  const findings = await buildFindings("audit3", deviations, "consistency", 5);

  assert.ok(findings.length <= 5);
  for (const finding of findings) {
    assert.ok(finding.confidence > 0 && finding.confidence <= 1);
    assert.ok(finding.title.length > 0 && finding.description.length > 0);
    assert.ok(finding.recommendation.length > 0);
  }
  const counts = summarizeFindings(findings);
  assert.equal(counts.total, findings.length);
  assert.equal(counts.autoFixable + counts.needsReview + counts.needsAssetReview, findings.length);
});

test("a licensed typeface surfaces an open alternative instead of a blocked fix", async () => {
  const pages = consistentSite();
  for (const element of pages[0]!.elements) {
    if (element.role === "h1") element.fontFamily = "Freight Text";
  }
  pages[0]!.elements.push(
    el({ role: "h1", fontFamily: "Arial", fontWeight: 700, fontSize: 40, selector: "h1.alt" }),
  );
  const profile = buildStyleProfile(pages);
  const deviations = detectDeviations({ pages, profile, rules: [] });
  const findings = await buildFindings("audit4", deviations, "consistency", 10);

  const typography = findings.find((f) => f.category === "typography")!;
  assert.ok(typography.assetRequirement, "expected a licensing requirement");
  assert.equal(typography.assetRequirement!.freeAlternative, "Libre Baskerville");
  assert.equal(typography.autoRemediable, false, "a licensed font can't be auto-applied");
});

test("the remediation plan only emits allowlisted properties", () => {
  const pages = driftedSite();
  const profile = buildStyleProfile(pages);
  const deviations = detectDeviations({ pages, profile, rules: [] });
  const plan = buildRemediationPlan(deviations);

  assert.ok(plan.css.length > 0, "expected fixes for a drifted site");
  const properties = [...plan.css.matchAll(/^\s{2}([a-z-]+):/gm)].map((m) => m[1]);
  const allowed = new Set([
    "font-family", "font-weight", "font-size", "color",
    "background-color", "border-color", "border-radius", "letter-spacing",
  ]);
  for (const property of properties) assert.ok(allowed.has(property!), `unexpected property ${property}`);
  // Layout, content and imagery must be untouchable by construction.
  assert.doesNotMatch(plan.css, /display|position|content|background-image|width|margin/);
});

test("the brand guide parser reads only what the document states", () => {
  const text =
    "Northwind Brand Guidelines Colour Our primary brand colour is #00B74F. " +
    "Our secondary colour is #0C0C0D. Typography H1 headings are set in Freight Text Medium. " +
    "Body copy is set in Inter Regular. UI Buttons use an 8px corner radius. " +
    "Photography style is not defined in this document.";
  const rules = parseGuideDeterministically(text, "audit5").map((r) => r.rule);

  assert.deepEqual(rules, [
    { kind: "color", role: "primary", value: "#00b74f" },
    { kind: "color", role: "secondary", value: "#0c0c0d" },
    { kind: "font-family", role: "h1", value: "Freight Text" },
    { kind: "font-family", role: "body", value: "Inter" },
    { kind: "undefined-area", area: "photography style" },
    { kind: "radius", role: "button", value: 8 },
  ]);
});

test("an area the guide leaves open never becomes a requirement", () => {
  const rules = parseGuideDeterministically(
    "Iconography is not specified. Our primary colour is #00B74F.",
    "audit6",
  );
  const photography = rules.find((r) => r.rule.kind === "undefined-area");
  assert.ok(photography, "expected the undefined area to be recorded");
  // Nothing about iconography may appear as a checkable rule.
  assert.equal(rules.some((r) => r.category === "visual"), false);
});

test("a brand-guide typeface that needs a licence surfaces the licensing path", async () => {
  const pages = consistentSite();
  const rules: BrandRule[] = [{
    id: "r1", auditId: "audit7", source: "brand_guide", category: "typography",
    rule: { kind: "font-family", role: "h1", value: "Freight Text" },
    confidence: 0.9, evidence: "H1 headings are set in Freight Text Medium.",
  }];
  const profile = buildStyleProfile(pages);
  const deviations = detectDeviations({ pages, profile, rules });
  const findings = await buildFindings("audit7", deviations, "compliance", 10);

  const violation = findings.find((f) => f.classification === "violation")!;
  assert.ok(violation.assetRequirement, "a licensed typeface should surface its licence status");
  assert.equal(violation.assetRequirement!.status, "commercial");
  assert.equal(violation.assetRequirement!.freeAlternative, "Libre Baskerville");
  assert.equal(violation.autoRemediable, false, "we can't apply a font we have no licence for");
});
