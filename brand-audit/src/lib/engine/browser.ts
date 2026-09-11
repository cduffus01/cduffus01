import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext } from "playwright-core";
import { chromium } from "playwright-core";
import { config } from "@/lib/config";

/**
 * Chromium lifecycle. One browser per process, fresh context per audit so
 * cookies and storage never leak between audited sites.
 */

let browserPromise: Promise<Browser> | null = null;

function resolveExecutable(): string | undefined {
  const explicit = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;

  // Pre-provisioned browser directories (containers, CI images).
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && fs.existsSync(root)) {
    const direct = path.join(root, "chromium");
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
    const candidates = fs
      .readdirSync(root)
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .reverse()
      .map((d) => path.join(root, d, "chrome-linux", "chrome"))
      .filter((p) => fs.existsSync(p));
    if (candidates[0]) return candidates[0];
  }
  return undefined; // fall back to Playwright's own resolution
}

/**
 * Egress proxy, when the environment mandates one.
 *
 * Without this the browser can reach nothing outside localhost in a proxied
 * network, which shows up as an audit that "works" but renders every page as an
 * error, and as preview fonts that silently fail to load.
 */
function proxyConfig(): { server: string; bypass: string } | undefined {
  // Opt-in: an ambient HTTPS_PROXY is often a CONNECT proxy that the browser
  // cannot use the way a CLI does, so adopting it automatically would break
  // crawling in environments where the browser has direct egress.
  const server = process.env.BROWSER_PROXY;
  if (!server) return undefined;
  const bypass = process.env.NO_PROXY ?? process.env.no_proxy ?? "localhost,127.0.0.1,::1";
  return { server, bypass };
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      executablePath: resolveExecutable(),
      proxy: proxyConfig(),
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
        "--mute-audio",
        "--disable-background-networking",
      ],
    });
    browserPromise.catch(() => { browserPromise = null; });
  }
  return browserPromise;
}

export async function createContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: config.crawl.viewport,
    deviceScaleFactor: 1,
    userAgent: config.crawl.userAgent,
    locale: "en-US",
    timezoneId: "UTC",
    javaScriptEnabled: true,
    bypassCSP: false,
    // Audited sites are third-party code. Deny everything they might ask for.
    permissions: [],
    serviceWorkers: "block",
  });
  context.setDefaultTimeout(config.crawl.pageTimeoutMs);
  context.setDefaultNavigationTimeout(config.crawl.pageTimeoutMs);
  return context;
}

export async function closeBrowser(): Promise<void> {
  const current = browserPromise;
  browserPromise = null;
  if (current) {
    const browser = await current.catch(() => null);
    await browser?.close().catch(() => undefined);
  }
}
