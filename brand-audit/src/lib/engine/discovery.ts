import type { PageType } from "@/lib/types";
import { registrableDomain } from "@/lib/security/url";

/**
 * Page discovery and selection (spec section 4): homepage plus up to three
 * pages that are *representative* of the site, not merely the first three links.
 */

const EXCLUDED = [
  "login", "signin", "sign-in", "signup", "sign-up", "register", "logout",
  "cart", "checkout", "account", "dashboard", "admin", "wp-admin", "wp-login",
  "privacy", "terms", "legal", "cookie", "gdpr", "sitemap", "rss", "feed",
  "search", "unsubscribe", "download", "api-docs", "status",
];

const FILE_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|docx?|xlsx?|csv|xml|json|txt)$/i;

/** Path keywords → page type and how representative that type is of the brand. */
// The trailing group also matches .html/.php so sites that serve files, not
// clean paths, are still classified correctly.
const END = "(\\.[a-z]{2,5})?(\\/|$)";
const TYPE_RULES: { re: RegExp; type: PageType; score: number }[] = [
  { re: new RegExp(`(^|/)(pricing|plans|price)${END}`, "i"), type: "pricing", score: 10 },
  { re: new RegExp(`(^|/)(products?|solutions?|features?|platform|services?|use-cases?)${END}`, "i"), type: "product", score: 9 },
  { re: new RegExp(`(^|/)(about|company|who-we-are|our-story|team|mission)${END}`, "i"), type: "about", score: 8 },
  { re: new RegExp(`(^|/)(contact|support|help|get-in-touch|demo|book)${END}`, "i"), type: "contact", score: 7 },
  { re: new RegExp(`(^|/)(blog|news|resources|insights|articles?|guides?|case-stud)${END}`, "i"), type: "blog", score: 5 },
];

export function classifyPage(url: URL, isHome: boolean): PageType {
  if (isHome) return "homepage";
  const path = url.pathname;
  for (const rule of TYPE_RULES) if (rule.re.test(path)) return rule.type;
  return "other";
}

export interface CandidateLink {
  url: string;
  pageType: PageType;
  score: number;
}

/**
 * Ranks internal links. Navigation links win ties because a link the site puts
 * in its own nav is, by definition, a page the site considers representative.
 */
export function selectRepresentativeLinks(
  homeUrl: URL,
  links: string[],
  navHrefs: string[],
  limit: number,
): CandidateLink[] {
  const homeDomain = registrableDomain(homeUrl.hostname);
  const navSet = new Set(navHrefs.map(normalize).filter(Boolean) as string[]);
  const seen = new Set<string>([normalize(homeUrl.href) ?? ""]);
  const candidates: CandidateLink[] = [];

  for (const raw of links) {
    const normalized = normalize(raw);
    if (!normalized || seen.has(normalized)) continue;

    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (registrableDomain(url.hostname) !== homeDomain) continue;

    const path = url.pathname.toLowerCase();
    if (FILE_EXT.test(path)) continue;
    if (EXCLUDED.some((word) => path.includes(word))) continue;

    const segments = path.split("/").filter(Boolean);
    if (segments.length > 3) continue;

    const rule = TYPE_RULES.find((r) => r.re.test(path));
    let score = rule?.score ?? 2;
    if (navSet.has(normalized)) score += 3;
    score -= Math.max(0, segments.length - 1) * 0.5;
    if (url.search) score -= 2;

    seen.add(normalized);
    candidates.push({ url: normalized, pageType: rule?.type ?? "other", score });
  }

  candidates.sort((a, b) => b.score - a.score);

  // One page per type first, so four pages cover four different surfaces
  // rather than four blog posts.
  const picked: CandidateLink[] = [];
  const usedTypes = new Set<PageType>();
  for (const c of candidates) {
    if (picked.length >= limit) break;
    if (c.pageType !== "other" && usedTypes.has(c.pageType)) continue;
    usedTypes.add(c.pageType);
    picked.push(c);
  }
  for (const c of candidates) {
    if (picked.length >= limit) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.slice(0, limit);
}

function normalize(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.username = "";
    url.password = "";
    // Trailing-slash-insensitive identity, so /about and /about/ aren't two pages.
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.href;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

export interface RobotsPolicy {
  allows(pathname: string): boolean;
}

const ALLOW_ALL: RobotsPolicy = { allows: () => true };

/**
 * Minimal robots.txt support for discovered links. The submitted page itself is
 * always fetched: the user asked us to look at their own site.
 */
export async function fetchRobots(origin: string): Promise<RobotsPolicy> {
  let body: string;
  try {
    const res = await fetch(new URL("/robots.txt", origin), {
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
      headers: { "user-agent": "BrandAudit" },
    });
    if (!res.ok) return ALLOW_ALL;
    body = (await res.text()).slice(0, 200_000);
  } catch {
    return ALLOW_ALL;
  }

  const disallow: string[] = [];
  let applies = false;
  for (const line of body.split("\n")) {
    const clean = line.split("#")[0]!.trim();
    if (!clean) continue;
    const [rawKey, ...rest] = clean.split(":");
    const key = rawKey!.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      applies = value === "*" || value.toLowerCase().includes("brandaudit");
    } else if (key === "disallow" && applies && value) {
      disallow.push(value);
    } else if (key === "allow" && applies && value === "/") {
      // Explicit blanket allow; nothing to record.
    }
  }

  return {
    allows(pathname: string) {
      return !disallow.some((rule) => rule !== "/" && pathname.startsWith(rule));
    },
  };
}
