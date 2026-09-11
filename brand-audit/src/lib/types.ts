/**
 * Data model (product spec section 21) plus the engine types that flow between
 * pipeline stages.
 *
 * The important type in this file is `Deviation`. Scores, findings and
 * remediations are all derived from deviations, so those three can never
 * disagree with one another.
 */

export type AuditType = "consistency" | "compliance";

export type AuditStatus =
  | "queued"
  | "running"
  | "complete"
  | "failed";

export type AuditCategory =
  | "typography"
  | "colors"
  | "components"
  | "visual"
  | "accessibility"
  | "compliance";

/** Spec section 11 classification. */
export type Classification = "violation" | "probable_drift" | "enhancement";

export type Severity = "high" | "medium" | "low";

/** Stage identifiers drive the progress UI (spec section 24). */
export type PipelineStage =
  | "validating"
  | "scanning"
  | "patterns"
  | "typography"
  | "colors"
  | "components"
  | "scoring"
  | "preview"
  | "done";

export interface ProgressState {
  stage: PipelineStage;
  label: string;
  /** Completed stages / total stages. Tied to real progress, never faked. */
  completed: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Audit {
  id: string;
  url: string;
  domain: string;
  auditType: AuditType;
  status: AuditStatus;
  createdAt: string;
  completedAt: string | null;
  brandScore: number | null;
  projectedScore: number | null;
  categoryScores: CategoryScore[] | null;
  summary: AuditSummary | null;
  progress: ProgressState;
  error: AuditError | null;
}

export interface AuditError {
  code:
    | "invalid_url"
    | "blocked_url"
    | "unreachable"
    | "bot_protected"
    | "requires_auth"
    | "insufficient_content"
    | "render_failed"
    | "guide_unparsable"
    | "internal";
  message: string;
  /** Shown to the user verbatim. Never fabricate a score instead of failing. */
  userMessage: string;
}

export interface AuditSummary {
  verdict: string;
  band: string;
  strongestArea: string;
  largestOpportunity: string;
  totalFindings: number;
  autoFixable: number;
  needsReview: number;
  needsAssetReview: number;
}

export interface AuditPage {
  id: string;
  auditId: string;
  url: string;
  pageType: PageType;
  title: string;
  screenshot: string | null;
  viewportScreenshot: string | null;
  htmlMetadata: PageMetadata;
}

export type PageType =
  | "homepage"
  | "product"
  | "about"
  | "pricing"
  | "contact"
  | "blog"
  | "other";

export interface PageMetadata {
  title: string;
  description: string | null;
  elementCount: number;
  textLength: number;
  width: number;
  height: number;
}

export interface StyleToken {
  id: string;
  auditId: string;
  type: "color" | "font-family" | "font-size" | "radius" | "spacing" | "shadow";
  value: string;
  normalizedValue: string;
  frequency: number;
  pages: string[];
  role?: string;
}

export interface BrandRule {
  id: string;
  auditId: string;
  source: "brand_guide" | "inferred";
  category: AuditCategory;
  /** Machine-checkable shape, e.g. { kind: "font-family", role: "h1", value: "Inter" } */
  rule: BrandRuleBody;
  confidence: number;
  /** Verbatim supporting text from the guide, for explainability. */
  evidence?: string;
}

export type BrandRuleBody =
  | { kind: "font-family"; role: string; value: string }
  | { kind: "color"; role: string; value: string }
  | { kind: "radius"; role: string; value: number }
  | { kind: "font-weight"; role: string; value: number }
  | { kind: "undefined-area"; area: string };

export interface Evidence {
  pageUrl: string;
  selector: string;
  text?: string;
  property: string;
  observed: string;
  expected: string;
}

export interface Finding {
  id: string;
  auditId: string;
  category: AuditCategory;
  classification: Classification;
  severity: Severity;
  confidence: number;
  title: string;
  description: string;
  currentState: string;
  recommendedState: string;
  evidence: Evidence[];
  recommendation: string;
  autoRemediable: boolean;
  pagesAffected: string[];
  elementsAffected: number;
  /** Populated by the licensing interface when a finding requires an asset. */
  assetRequirement: AssetRequirement | null;
}

/** Spec section 17: an interface, not a dependency. */
export interface AssetRequirement {
  kind: "font";
  required: string;
  status: "open_source" | "commercial" | "unknown";
  freeAlternative: string | null;
  note: string;
}

export interface PreviewChange {
  label: string;
  category: AuditCategory;
  before: string;
  after: string;
  css: string;
  selectorSample: string;
}

export interface Preview {
  id: string;
  auditId: string;
  /** The page the before/after comparison shows. */
  pageUrl: string;
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
  changes: PreviewChange[];
  css: string;
  projectedScore: number | null;
  projectedCategoryScores: CategoryScore[] | null;
}

export interface Lead {
  id: string;
  email: string;
  auditId: string | null;
  fixIntent: boolean;
  createdAt: string;
  source: string;
}

export interface AnalyticsEvent {
  id: string;
  name: string;
  auditId: string | null;
  props: Record<string, unknown>;
  createdAt: string;
}

export interface CategoryScore {
  category: AuditCategory;
  label: string;
  score: number;
  weight: number;
  deviationCount: number;
}

// ---------------------------------------------------------------------------
// Engine types
// ---------------------------------------------------------------------------

/** One harvested element, normalized in-page before it crosses the boundary. */
export interface CapturedElement {
  selector: string;
  tag: string;
  role: ElementRole;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: string;
  textTransform: string;
  color: string;
  backgroundColor: string;
  /** Nearest non-transparent ancestor background, for real contrast math. */
  effectiveBackground: string;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  padding: [number, number, number, number];
  margin: [number, number, number, number];
  width: number;
  height: number;
  classes: string[];
  href?: string;
  /** Visible in the 1440x1000 viewport at capture time. */
  inViewport: boolean;
  area: number;
}

export type ElementRole =
  | "h1"
  | "h2"
  | "h3"
  | "body"
  | "nav"
  | "button"
  | "link"
  | "caption"
  | "input"
  | "card"
  | "footer";

export interface CapturedImage {
  src: string;
  alt: string | null;
  width: number;
  height: number;
  isLogoCandidate: boolean;
  inViewport: boolean;
}

export interface CapturedIcon {
  selector: string;
  kind: "svg" | "icon-font" | "emoji";
  /** Stroke width when the SVG is an outline icon; 0 for filled. */
  strokeWidth: number;
  filled: boolean;
  family: string | null;
  viewBox: string | null;
}

export interface CapturedPage {
  url: string;
  pageType: PageType;
  metadata: PageMetadata;
  elements: CapturedElement[];
  images: CapturedImage[];
  icons: CapturedIcon[];
  backgroundColors: { color: string; area: number }[];
  screenshotKey: string | null;
  viewportScreenshotKey: string | null;
}

export interface ColorCluster {
  /** Cluster centre in hex; the canonical value remediation proposes. */
  canonical: string;
  members: { hex: string; frequency: number }[];
  frequency: number;
  roles: string[];
  pages: string[];
}

export interface TypographyPattern {
  role: ElementRole;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  frequency: number;
  pages: string[];
}

export interface ButtonPattern {
  signature: string;
  backgroundColor: string;
  color: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  borderRadius: number;
  paddingY: number;
  paddingX: number;
  frequency: number;
  pages: string[];
  selectors: string[];
}

export interface ImageryProfile {
  dominantStyle: string | null;
  notes: string[];
  /** Vision-derived, hence capped confidence. Null when no LLM is configured. */
  confidence: number;
  source: "vision" | "unavailable";
}

export interface SiteStyleProfile {
  colors: ColorCluster[];
  typography: TypographyPattern[];
  buttons: ButtonPattern[];
  spacingPatterns: { value: number; frequency: number }[];
  radii: { value: number; frequency: number }[];
  logos: { src: string; occurrences: number; variants: number }[];
  imagery: ImageryProfile;
  icons: { families: string[]; filled: number; outlined: number; emoji: number };
  pagePatterns: { pageType: PageType; url: string }[];
}

/**
 * The single source of truth. Scoring is a pure function of these; findings are
 * a grouping of these; remediation is a translation of these into CSS.
 */
export interface Deviation {
  id: string;
  category: AuditCategory;
  kind: DeviationKind;
  /** Human-readable dominant pattern, e.g. "Inter 700". */
  dominant: string;
  observed: string;
  /** Share of the population using the deviating treatment (0..1). */
  minorityShare: number;
  /** 0..1 — deterministic CSS facts are high; perceptual judgements are low. */
  confidence: number;
  severity: Severity;
  classification: Classification;
  elements: number;
  pages: string[];
  evidence: Evidence[];
  /** Weight of this deviation inside its category before scaling. */
  weight: number;
  autoRemediable: boolean;
  /** CSS the remediation engine can apply, when auto-remediable. */
  fix?: { selectors: string[]; declarations: Record<string, string> };
}

export type DeviationKind =
  | "heading_font_family"
  | "heading_font_weight"
  | "body_font_family"
  | "font_family_count"
  | "type_scale_noise"
  | "near_duplicate_color"
  | "palette_sprawl"
  | "link_color_inconsistent"
  | "button_variant_sprawl"
  | "button_radius"
  | "button_font_weight"
  | "button_color"
  | "radius_sprawl"
  | "spacing_off_scale"
  | "icon_family_mix"
  | "emoji_icons"
  | "imagery_style_mix"
  | "logo_variants"
  | "contrast_fail"
  | "missing_alt"
  | "tiny_text"
  | "rule_violation";

export interface AuditResult {
  audit: Audit;
  pages: AuditPage[];
  findings: Finding[];
  preview: Preview | null;
  profile: SiteStyleProfile | null;
  rules: BrandRule[];
}
