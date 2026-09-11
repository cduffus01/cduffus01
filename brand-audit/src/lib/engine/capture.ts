import type { BrowserContext, Page } from "playwright-core";
import { config } from "@/lib/config";
import { assertPublicHost, normalizeInputUrl } from "@/lib/security/url";
import { getStorage } from "@/lib/storage";
import type { AuditError, CapturedPage, ElementRole, PageType } from "@/lib/types";
import { harvestScript, type HarvestResult } from "./harvest";

/**
 * Loads a page in a real browser, waits for it to settle, harvests a
 * normalized style sample, and captures screenshots.
 */

export interface LoadedPage {
  page: Page;
  harvest: HarvestResult;
  finalUrl: string;
}

export class CaptureError extends Error {
  readonly detail: AuditError;

  constructor(detail: AuditError) {
    super(detail.message);
    this.detail = detail;
  }
}

/**
 * Re-checks every navigation target, including redirect hops: a public hostname
 * can resolve to a private address, or redirect to one, after the first check.
 */
export async function guardContext(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();

    if (!/^https?:/i.test(url)) return route.abort("blockedbyclient");

    if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
      const normalized = normalizeInputUrl(url);
      if (!normalized.ok || !normalized.url) return route.abort("blockedbyclient");
      const check = await assertPublicHost(normalized.url);
      if (!check.ok) return route.abort("blockedbyclient");
    }
    return route.continue();
  });
}

async function settle(page: Page): Promise<void> {
  // Race networkidle against a deadline: many SPAs never reach idle because of
  // polling or analytics beacons, and we must not wait forever (spec 34).
  await page
    .waitForLoadState("networkidle", { timeout: Math.min(8_000, config.crawl.pageTimeoutMs) })
    .catch(() => undefined);
  // A short settle for late hydration and web-font swap.
  await page.waitForTimeout(700);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  // Trigger lazy-loaded content, then return to the top so the viewport
  // screenshot matches what a visitor actually sees first.
  await page
    .evaluate(async () => {
      window.scrollTo(0, Math.min(2400, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 350));
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 250));
    })
    .catch(() => undefined);
}

export async function loadPage(context: BrowserContext, url: string): Promise<LoadedPage> {
  const page = await context.newPage();
  // Never let an audited site open dialogs or extra tabs.
  page.on("dialog", (d) => d.dismiss().catch(() => undefined));
  page.on("popup", (p) => p.close().catch(() => undefined));

  let response;
  try {
    response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.crawl.pageTimeoutMs,
    });
  } catch (err) {
    await page.close().catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    throw new CaptureError({
      code: /blockedbyclient/i.test(message) ? "blocked_url" : "unreachable",
      message,
      userMessage: /timeout/i.test(message)
        ? "That site took too long to respond. It may be slow or blocking automated visits."
        : "We couldn't reach that site. Check the URL and try again.",
    });
  }

  const status = response?.status() ?? 0;
  if (status === 401 || status === 403) {
    await page.close().catch(() => undefined);
    throw new CaptureError({
      code: status === 401 ? "requires_auth" : "bot_protected",
      message: `HTTP ${status}`,
      userMessage:
        status === 401
          ? "That page needs a login, so we can't audit it. Try a public page."
          : "That site is blocking automated visits, so we couldn't analyze it.",
    });
  }
  if (status >= 500) {
    await page.close().catch(() => undefined);
    throw new CaptureError({
      code: "unreachable",
      message: `HTTP ${status}`,
      userMessage: "That site returned a server error, so we couldn't analyze it.",
    });
  }

  await settle(page);

  const harvest = (await page.evaluate(
    harvestScript,
    config.crawl.maxElementsPerPage,
  )) as HarvestResult;

  if (harvest.signals.isChallengePage) {
    await page.close().catch(() => undefined);
    throw new CaptureError({
      code: "bot_protected",
      message: "challenge page detected",
      userMessage: "That site is behind bot protection, so we couldn't see the real page.",
    });
  }

  return { page, harvest, finalUrl: page.url() };
}

export async function captureScreenshots(
  page: Page,
  auditId: string,
  slug: string,
): Promise<{ full: string | null; viewport: string | null }> {
  const storage = getStorage();
  const keys = { full: `${auditId}/${slug}-full.png`, viewport: `${auditId}/${slug}-view.png` };
  try {
    const viewport = await page.screenshot({ type: "png", fullPage: false });
    await storage.put(keys.viewport, viewport, "image/png");
    // Full-page shots fail on extremely tall pages; the viewport shot is the
    // one the UI actually needs, so a failure here is not fatal.
    let fullKey: string | null = null;
    try {
      const full = await page.screenshot({ type: "png", fullPage: true, timeout: 20_000 });
      await storage.put(keys.full, full, "image/png");
      fullKey = keys.full;
    } catch { /* keep the viewport capture */ }
    return { full: fullKey, viewport: keys.viewport };
  } catch {
    return { full: null, viewport: null };
  }
}

export function toCapturedPage(
  loaded: LoadedPage,
  pageType: PageType,
  screenshots: { full: string | null; viewport: string | null },
): CapturedPage {
  const { harvest, finalUrl } = loaded;
  return {
    url: finalUrl,
    pageType,
    metadata: harvest.metadata,
    elements: harvest.elements.map((e) => ({
      ...e,
      role: e.role as ElementRole,
      // Text came from a third-party page: sanitize before it enters the store.
      text: sanitizeText(e.text),
    })),
    images: harvest.images,
    icons: harvest.icons,
    backgroundColors: harvest.backgroundColors,
    screenshotKey: screenshots.full,
    viewportScreenshotKey: screenshots.viewport,
  };
}

/**
 * Extracted page text is untrusted input. Control characters, bidi overrides
 * and zero-width characters are stripped before the text is stored, displayed
 * or placed in a prompt.
 */
export function sanitizeText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const suspect =
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0x2028 || code === 0x2029 || code === 0xfeff;
    out += suspect ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 120);
}
