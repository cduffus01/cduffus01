import { config, scoreBand } from "@/lib/config";
import { getStore } from "@/lib/store";
import { validateAuditUrl, registrableDomain } from "@/lib/security/url";
import type {
  Audit, AuditError, AuditPage, AuditSummary, BrandRule, CapturedPage,
  PipelineStage, Preview, ProgressState,
} from "@/lib/types";
import { createContext } from "./browser";
import { CaptureError, captureScreenshots, guardContext, loadPage, toCapturedPage } from "./capture";
import { classifyPage, fetchRobots, selectRepresentativeLinks } from "./discovery";
import { detectDeviations } from "./deviations";
import { buildFindings, summarizeFindings } from "./findings";
import { renderPreview, selectPreviewPage } from "./preview";
import { buildRemediationPlan } from "./remediation";
import { largestOpportunity, scoreDeviations, strongestArea } from "./scoring";
import { buildStyleProfile, toStyleTokens } from "./style-profile";
import { analyzeImagery } from "./vision";

/**
 * Pipeline orchestration (spec section 19). Each stage is a plain function; the
 * "agents" are modules, not deployed services.
 *
 * Progress is reported from real stage completion — never a fake percentage
 * (spec section 24).
 */

const STAGES: { stage: PipelineStage; label: string }[] = [
  { stage: "validating", label: "Checking your website..." },
  { stage: "scanning", label: "Scanning your website..." },
  { stage: "patterns", label: "Finding your visual patterns..." },
  { stage: "typography", label: "Analyzing typography..." },
  { stage: "colors", label: "Comparing colors..." },
  { stage: "components", label: "Checking components..." },
  { stage: "scoring", label: "Calculating your Brand Score..." },
  { stage: "preview", label: "Creating your preview..." },
  { stage: "done", label: "Done" },
];

function progressFor(stage: PipelineStage): ProgressState {
  const index = STAGES.findIndex((s) => s.stage === stage);
  return {
    stage,
    label: STAGES[index]?.label ?? "Working...",
    completed: Math.max(0, index),
    total: STAGES.length - 1,
  };
}

export interface RunAuditInput {
  auditId: string;
  url: string;
  guide?: Buffer | null;
}

export async function runAudit({ auditId, url, guide }: RunAuditInput): Promise<void> {
  const store = getStore();
  const started = Date.now();
  const setStage = (stage: PipelineStage) =>
    store.updateAudit(auditId, { progress: progressFor(stage), status: "running" });

  const fail = async (error: AuditError) => {
    await store.updateAudit(auditId, {
      status: "failed",
      error,
      completedAt: new Date().toISOString(),
      progress: progressFor("done"),
    });
    await store.recordEvent({
      id: `${auditId}-failed`, name: "audit_failed", auditId,
      props: { code: error.code, ms: Date.now() - started },
      createdAt: new Date().toISOString(),
    });
  };

  let context: Awaited<ReturnType<typeof createContext>> | null = null;

  try {
    await setStage("validating");

    const check = await validateAuditUrl(url);
    if (!check.ok || !check.url) {
      return fail({
        code: check.code ?? "invalid_url",
        message: check.reason ?? "invalid url",
        userMessage: check.reason ?? "We couldn't audit that URL.",
      });
    }
    const startUrl = check.url;

    // Brand guide first: it determines whether this is a consistency audit or a
    // compliance audit, which changes the language of every finding.
    let rules: BrandRule[] = [];
    let guideNote: string | null = null;
    if (guide) {
      const { parseBrandGuide } = await import("./brand-policy");
      const parsed = await parseBrandGuide(guide, auditId);
      rules = parsed.rules;
      guideNote = parsed.note;
      await store.saveRules(auditId, rules);
    }
    const auditType = rules.some((r) => r.rule.kind !== "undefined-area")
      ? "compliance"
      : "consistency";
    await store.updateAudit(auditId, { auditType });

    await setStage("scanning");
    context = await createContext();
    await guardContext(context);

    // --- homepage ---------------------------------------------------------
    const home = await loadPage(context, startUrl.href);
    const homeShots = await captureScreenshots(home.page, auditId, "page-0");
    const homeCapture = toCapturedPage(home, "homepage", homeShots);
    const navHrefs = home.harvest.elements
      .filter((e) => e.role === "nav" && e.href)
      .map((e) => e.href!);
    const links = home.harvest.links;
    const homeSignals = home.harvest.signals;
    await home.page.close().catch(() => undefined);

    if (homeSignals.hasLoginForm && homeCapture.metadata.textLength < 800) {
      return fail({
        code: "requires_auth",
        message: "login wall",
        userMessage: "That page looks like a login screen, so there's no public design to audit.",
      });
    }
    if (
      homeCapture.elements.length < config.sufficiency.minElements ||
      homeCapture.metadata.textLength < config.sufficiency.minTextLength
    ) {
      return fail({
        code: "insufficient_content",
        message: "not enough rendered content",
        userMessage:
          "We couldn't analyze enough of this site to generate a reliable Brand Score. " +
          "It may still be loading content, or be built in a way we can't read yet.",
      });
    }

    // --- additional representative pages ----------------------------------
    const robots = await fetchRobots(startUrl.origin);
    const candidates = selectRepresentativeLinks(
      startUrl, links, navHrefs, config.crawl.maxPages - 1,
    ).filter((c) => {
      try { return robots.allows(new URL(c.url).pathname); } catch { return false; }
    });

    const captured: CapturedPage[] = [homeCapture];
    for (const [index, candidate] of candidates.entries()) {
      if (Date.now() - started > config.crawl.totalBudgetMs) break;
      await sleep(config.crawl.politenessMs);
      try {
        const loaded = await loadPage(context, candidate.url);
        const shots = await captureScreenshots(loaded.page, auditId, `page-${index + 1}`);
        const pageType = classifyPage(new URL(loaded.finalUrl), false);
        captured.push(toCapturedPage(loaded, pageType === "other" ? candidate.pageType : pageType, shots));
        await loaded.page.close().catch(() => undefined);
      } catch {
        // One unreachable sub-page must not sink the audit.
        continue;
      }
    }

    await store.savePages(auditId, captured.map((page, index) => toAuditPage(auditId, page, index)));

    // --- style extraction --------------------------------------------------
    await setStage("patterns");
    const profile = buildStyleProfile(captured);

    // Vision is optional and additive; the audit is identical without it.
    profile.imagery = await analyzeImagery(captured);

    await setStage("typography");
    await store.saveProfile(auditId, profile);
    await store.saveTokens(auditId, toStyleTokens(auditId, profile));

    // --- deviations, scoring, findings -------------------------------------
    await setStage("colors");
    const deviations = detectDeviations({ pages: captured, profile, rules });

    await setStage("components");
    const score = scoreDeviations(deviations, auditType);

    await setStage("scoring");
    // Build every finding so the headline counts reconcile with each other,
    // then surface only the top ones (spec section 12).
    const allFindings = await buildFindings(auditId, deviations, auditType, deviations.length);
    const findings = allFindings.slice(0, config.findings.maxFree);
    await store.saveFindings(auditId, findings);

    // --- remediation + preview ---------------------------------------------
    await setStage("preview");
    const plan = buildRemediationPlan(deviations);
    const previewTarget = selectPreviewPage(captured, plan.applied);
    const previewResult = await renderPreview(
      context, auditId, previewTarget, plan, captured, rules, auditType,
    );

    const preview: Preview = {
      id: `${auditId}-preview`,
      auditId,
      pageUrl: previewResult.previewedUrl,
      beforeScreenshot: previewTarget.viewportScreenshotKey,
      afterScreenshot: previewResult.afterScreenshotKey,
      changes: plan.changes.slice(0, 3),
      css: plan.css,
      // Never report a projection below the current score: that would mean the
      // fixes made things worse, which means we should not ship them.
      projectedScore:
        previewResult.projectedScore !== null
          ? Math.max(previewResult.projectedScore, score.overall)
          : null,
      projectedCategoryScores: previewResult.projectedCategories,
    };
    await store.savePreview(preview);

    const counts = summarizeFindings(allFindings);
    const band = scoreBand(score.overall);
    const strongest = strongestArea(score.categories);
    const opportunity = largestOpportunity(score.categories);
    const summary: AuditSummary = {
      verdict: guideNote ? `${band.verdict} ${guideNote}` : band.verdict,
      band: band.band,
      strongestArea: strongest?.label ?? "—",
      largestOpportunity: opportunity?.label ?? "—",
      totalFindings: counts.total,
      autoFixable: counts.autoFixable,
      needsReview: counts.needsReview,
      needsAssetReview: counts.needsAssetReview,
    };

    await store.updateAudit(auditId, {
      status: "complete",
      brandScore: score.overall,
      projectedScore: preview.projectedScore,
      categoryScores: score.categories,
      summary,
      auditType,
      domain: registrableDomain(startUrl.hostname),
      completedAt: new Date().toISOString(),
      progress: progressFor("done"),
      error: null,
    });

    await store.recordEvent({
      id: `${auditId}-complete`,
      name: "audit_completed",
      auditId,
      props: {
        ms: Date.now() - started,
        pages: captured.length,
        score: score.overall,
        projected: preview.projectedScore,
        auditType,
        deviations: deviations.length,
        previewRendered: previewResult.rendered,
      },
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof CaptureError) return fail(err.detail);
    console.error("[pipeline] unexpected failure", err);
    return fail({
      code: "internal",
      message: err instanceof Error ? err.message : String(err),
      userMessage: "Something went wrong while analyzing that site. Please try again.",
    });
  } finally {
    await context?.close().catch(() => undefined);
  }
}

function toAuditPage(auditId: string, page: CapturedPage, index: number): AuditPage {
  return {
    id: `${auditId}-p${index}`,
    auditId,
    url: page.url,
    pageType: page.pageType,
    title: page.metadata.title,
    screenshot: page.screenshotKey,
    viewportScreenshot: page.viewportScreenshotKey,
    htmlMetadata: page.metadata,
  };
}

export function initialAudit(id: string, url: string, domain: string): Audit {
  return {
    id,
    url,
    domain,
    auditType: "consistency",
    status: "queued",
    createdAt: new Date().toISOString(),
    completedAt: null,
    brandScore: null,
    projectedScore: null,
    categoryScores: null,
    summary: null,
    progress: progressFor("validating"),
    error: null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
