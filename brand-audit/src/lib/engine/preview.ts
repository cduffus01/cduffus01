import type { BrowserContext } from "playwright-core";
import { config } from "@/lib/config";
import type {
  AuditType, BrandRule, CapturedPage, CategoryScore, Deviation,
} from "@/lib/types";
import { captureScreenshots, loadPage, toCapturedPage } from "./capture";
import { harvestScript } from "./harvest";
import { detectDeviations } from "./deviations";
import { applyPlanToPages, type RemediationPlan } from "./remediation";
import { scoreDeviations } from "./scoring";
import { buildStyleProfile } from "./style-profile";

/**
 * Preview + QA (spec sections 13 and 19).
 *
 * The preview is a real browser render of the user's own homepage with the
 * override sheet injected — never a generated image. QA then re-measures the
 * result with the same deviation and scoring code that produced the original
 * score, so "72 -> 94" is a measurement rather than a claim.
 */

export interface PreviewResult {
  afterScreenshotKey: string | null;
  projectedScore: number | null;
  projectedCategories: CategoryScore[] | null;
  /** True when the after-render was verified in a real browser. */
  rendered: boolean;
  /** The page the comparison shows. */
  previewedUrl: string;
}

/**
 * Picks the page to preview.
 *
 * The homepage is the default, but drift concentrates: on many sites the
 * homepage is the best-maintained page, and a before/after of it would show
 * almost nothing. We preview the page the fixes visibly change the most, which
 * is the whole point of the comparison.
 */
export function selectPreviewPage(pages: CapturedPage[], applied: Deviation[]): CapturedPage {
  const fixedSelectors = new Set(applied.flatMap((d) => d.fix?.selectors ?? []));
  const homepage = pages.find((p) => p.pageType === "homepage") ?? pages[0]!;

  let best = homepage;
  let bestScore = coverage(homepage, fixedSelectors) * HOMEPAGE_PREFERENCE;
  for (const page of pages) {
    const score = coverage(page, fixedSelectors);
    if (score > bestScore) {
      best = page;
      bestScore = score;
    }
  }
  return best;
}

/** The homepage wins unless another page is meaningfully more affected. */
const HOMEPAGE_PREFERENCE = 1.5;

function coverage(page: CapturedPage, fixedSelectors: Set<string>): number {
  return page.elements.filter((e) => fixedSelectors.has(e.selector)).length;
}

export async function renderPreview(
  context: BrowserContext,
  auditId: string,
  target: CapturedPage,
  plan: RemediationPlan,
  pages: CapturedPage[],
  rules: BrandRule[],
  auditType: AuditType,
): Promise<PreviewResult> {
  if (!plan.css.trim()) {
    return {
      afterScreenshotKey: null, projectedScore: null, projectedCategories: null,
      rendered: false, previewedUrl: target.url,
    };
  }

  let afterPage: CapturedPage | null = null;
  let afterScreenshotKey: string | null = null;

  try {
    const loaded = await loadPage(context, target.url);
    try {
      await loaded.page.addStyleTag({ content: plan.css });
      // Let the browser reflow and swap any newly-requested web font.
      await loaded.page.waitForTimeout(600);
      await loaded.page.evaluate(() => document.fonts?.ready).catch(() => undefined);

      const screenshots = await captureScreenshots(loaded.page, auditId, "preview-after");
      afterScreenshotKey = screenshots.viewport;

      const harvest = await loaded.page.evaluate(
        harvestScript,
        config.crawl.maxElementsPerPage,
      );
      afterPage = toCapturedPage(
        { page: loaded.page, harvest, finalUrl: loaded.finalUrl },
        target.pageType,
        screenshots,
      );
    } finally {
      await loaded.page.close().catch(() => undefined);
    }
  } catch {
    // A failed re-render must not fail the audit; we fall back to the
    // analytical projection below and simply have no "after" screenshot.
  }

  const projectedPages = buildProjectedPages(pages, plan.applied, afterPage, target.url);
  const projectedProfile = buildStyleProfile(projectedPages);
  const projectedDeviations = detectDeviations({
    pages: projectedPages,
    profile: projectedProfile,
    rules,
  });
  const projected = scoreDeviations(projectedDeviations, auditType);

  return {
    afterScreenshotKey,
    projectedScore: projected.overall,
    projectedCategories: projected.categories,
    rendered: afterPage !== null,
    previewedUrl: target.url,
  };
}

/**
 * The measured page replaces its original capture; the remaining pages get the
 * same overrides applied analytically, because the sheet would ship site-wide.
 */
function buildProjectedPages(
  pages: CapturedPage[],
  applied: Deviation[],
  afterPage: CapturedPage | null,
  targetUrl: string,
): CapturedPage[] {
  const projected = applyPlanToPages(pages, applied);
  if (!afterPage) return projected;
  return projected.map((page) =>
    page.url === targetUrl ? { ...afterPage, pageType: page.pageType } : page,
  );
}
