import type { CapturedPage, Deviation, PreviewChange } from "@/lib/types";

/**
 * Remediation engine: canonical tokens -> a small, auditable CSS override sheet
 * (spec section 13, option B).
 *
 * Two hard constraints keep the preview honest:
 *   1. Only properties on the allowlist can be written, so structure, copy,
 *      imagery and layout cannot change.
 *   2. Only selectors this system generated itself are emitted, and each is
 *      re-validated before it reaches the sheet.
 */

const ALLOWED_PROPERTIES = new Set([
  "font-family",
  "font-weight",
  "font-size",
  "color",
  "background-color",
  "border-color",
  "border-radius",
  "letter-spacing",
]);

/** Matches only the selector shapes `selectorFor` in the harvest can produce. */
const SAFE_SELECTOR = /^[a-zA-Z][\w-]*(\.[A-Za-z][\w-]*){0,2}(:nth-of-type\(\d{1,3}\))?(\s*>\s*[a-zA-Z#][\w-]*(\.[A-Za-z][\w-]*){0,2}(:nth-of-type\(\d{1,3}\))?)*$/;
const SAFE_ID_SELECTOR = /^#[A-Za-z][\w-]*(\s*>\s*[a-zA-Z][\w-]*(\.[A-Za-z][\w-]*){0,2}(:nth-of-type\(\d{1,3}\))?)*$/;

export function isSafeSelector(selector: string): boolean {
  if (!selector || selector.length > 300) return false;
  // Note: ">" is the child combinator every generated selector uses, so the
  // structural allowlist below is what constrains shape; only characters that
  // could break out of the rule are rejected here.
  if (/[{}@;<"'\\]/.test(selector)) return false;
  return SAFE_SELECTOR.test(selector) || SAFE_ID_SELECTOR.test(selector);
}

export function isSafeValue(value: string): boolean {
  if (!value || value.length > 120) return false;
  return !/[{}@;<>\\]|url\(|expression\(|javascript:/i.test(value);
}

export interface RemediationPlan {
  css: string;
  changes: PreviewChange[];
  /** The deviations this plan actually fixes, for projected rescoring. */
  applied: Deviation[];
}

/** Human labels for the three headline changes shown on the before/after. */
const CHANGE_LABELS: Record<string, string> = {
  heading_font_family: "Typography normalized",
  body_font_family: "Typography normalized",
  heading_font_weight: "Heading weight normalized",
  button_radius: "Buttons normalized",
  button_font_weight: "Buttons normalized",
  button_color: "Call-to-action colour corrected",
  near_duplicate_color: "Colour corrected",
  contrast_fail: "Contrast raised to AA",
  rule_violation: "Brand guide applied",
};

export function buildRemediationPlan(deviations: Deviation[]): RemediationPlan {
  const rules: string[] = [];
  const changes: PreviewChange[] = [];
  const applied: Deviation[] = [];

  // Only fix what we are confident about: a preview that changes something the
  // user disagrees with is worse than a preview that changes less.
  const candidates = deviations.filter(
    (d) => d.autoRemediable && d.fix && d.confidence >= 0.75,
  );

  for (const deviation of candidates) {
    const fix = deviation.fix!;
    const declarations = Object.entries(fix.declarations).filter(
      ([property, value]) => ALLOWED_PROPERTIES.has(property) && isSafeValue(value),
    );
    if (declarations.length === 0) continue;

    // The sheet is site-wide, so selectors from every page are kept; ones that
    // don't match the homepage simply have no effect on the preview render.
    const selectors = [...new Set(fix.selectors)].filter(isSafeSelector).slice(0, 60);
    if (selectors.length === 0) continue;

    const body = declarations
      .map(([property, value]) => `  ${property}: ${value} !important;`)
      .join("\n");
    rules.push(`${selectors.join(",\n")} {\n${body}\n}`);

    applied.push(deviation);
    // Prefer a concrete measured pair ("20px" -> "8px", "1.6:1" -> "4.5:1")
    // over the summary sentence, which is written for the findings list.
    const sample = deviation.evidence[0];
    changes.push({
      label: CHANGE_LABELS[deviation.kind] ?? "Consistency fix",
      category: deviation.category,
      before: sample?.observed ?? deviation.observed,
      after: sample?.expected ?? deviation.dominant.split(" (")[0]!,
      css: `${selectors[0]} { ${declarations.map(([p, v]) => `${p}: ${v}`).join("; ")} }`,
      selectorSample: selectors[0]!,
    });
  }

  return { css: rules.join("\n\n"), changes: dedupeChanges(changes), applied };
}

/** The UI highlights ~3 changes; collapse repeats of the same kind first. */
function dedupeChanges(changes: PreviewChange[]): PreviewChange[] {
  const seen = new Set<string>();
  const out: PreviewChange[] = [];
  for (const change of changes) {
    if (seen.has(change.label)) continue;
    seen.add(change.label);
    out.push(change);
  }
  return out;
}

/**
 * Applies a plan to captured pages in memory.
 *
 * The homepage preview is a real browser re-render, but the projected score
 * must account for the whole site: the same override sheet ships site-wide, so
 * the other pages are updated analytically rather than re-crawled.
 */
export function applyPlanToPages(
  pages: CapturedPage[],
  applied: Deviation[],
): CapturedPage[] {
  const bySelector = new Map<string, Record<string, string>>();
  for (const deviation of applied) {
    if (!deviation.fix) continue;
    for (const selector of deviation.fix.selectors) {
      bySelector.set(selector, { ...(bySelector.get(selector) ?? {}), ...deviation.fix.declarations });
    }
  }

  return pages.map((page) => ({
    ...page,
    elements: page.elements.map((element) => {
      const declarations = bySelector.get(element.selector);
      if (!declarations) return element;
      const next = { ...element };
      for (const [property, value] of Object.entries(declarations)) {
        switch (property) {
          case "font-family": next.fontFamily = value.replace(/"/g, ""); break;
          case "font-weight": next.fontWeight = Number(value) || next.fontWeight; break;
          case "font-size": next.fontSize = parseFloat(value) || next.fontSize; break;
          case "color": next.color = value; break;
          case "background-color": next.backgroundColor = value; break;
          case "border-color": next.borderColor = value; break;
          case "border-radius": next.borderRadius = parseFloat(value) || 0; break;
        }
      }
      return next;
    }),
  }));
}
