import path from "node:path";

const num = (v: string | undefined, d: number) => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};

export const config = {
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), ".data"),

  crawl: {
    /** Homepage + up to 3 representative pages (spec section 4). */
    maxPages: Math.min(num(process.env.MAX_PAGES, 4), 8),
    pageTimeoutMs: num(process.env.PAGE_TIMEOUT_MS, 25_000),
    totalBudgetMs: num(process.env.CRAWL_BUDGET_MS, 150_000),
    /** Politeness delay between page loads on the same host. */
    politenessMs: num(process.env.CRAWL_DELAY_MS, 400),
    viewport: {
      width: num(process.env.VIEWPORT_WIDTH, 1440),
      height: num(process.env.VIEWPORT_HEIGHT, 1000),
    },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 BrandAudit/0.1 " +
      "(+https://github.com/cduffus01; user-initiated audit)",
    maxRedirects: 5,
    /** An element sample this size per page keeps LLM/context cost near zero. */
    maxElementsPerPage: 400,
  },

  /** Below these thresholds we refuse to score rather than guess (spec 34). */
  sufficiency: {
    minElements: 12,
    minTextLength: 200,
    minPages: 1,
  },

  scoring: {
    weights: {
      typography: 0.25,
      colors: 0.2,
      components: 0.25,
      visual: 0.15,
      accessibility: 0.15,
    },
    /** Compliance mode re-weights so guide violations carry real weight. */
    complianceWeights: {
      typography: 0.2,
      colors: 0.15,
      components: 0.2,
      visual: 0.1,
      accessibility: 0.15,
      compliance: 0.2,
    },
  },

  findings: {
    /** Free tier surfaces the top 5-10 meaningful findings (spec section 12). */
    maxFree: 10,
  },

  rateLimit: {
    auditsPerHourPerIp: num(process.env.RATE_LIMIT_AUDITS, 10),
  },

  llm: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    model: process.env.LLM_MODEL ?? "claude-opus-5",
    maxImagesPerAudit: num(process.env.LLM_MAX_IMAGES, 4),
  },
} as const;

export const CATEGORY_LABELS: Record<string, string> = {
  typography: "Typography",
  colors: "Colors",
  components: "Components",
  visual: "Visual Style",
  accessibility: "Accessibility",
  compliance: "Brand Compliance",
};

/** Spec section 32 — neutral language. We measure consistency, not taste. */
export function scoreBand(score: number): { band: string; verdict: string } {
  if (score >= 90)
    return {
      band: "Highly consistent",
      verdict: "Your site applies a tight, repeatable visual system.",
    };
  if (score >= 80)
    return {
      band: "Strong consistency",
      verdict: "Your site is largely consistent, with a few treatments drifting.",
    };
  if (score >= 70)
    return {
      band: "Moderately consistent",
      verdict:
        "Your site has a clear visual identity, but several treatments vary across pages.",
    };
  if (score >= 60)
    return {
      band: "Noticeable drift",
      verdict:
        "Recurring patterns are visible, but a number of elements have drifted away from them.",
    };
  return {
    band: "Significant inconsistency",
    verdict:
      "Many elements use treatments that differ from the site's most common patterns.",
  };
}
