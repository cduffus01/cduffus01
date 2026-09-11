import type {
  AnalyticsEvent, Audit, AuditPage, BrandRule, Finding, Lead, Preview,
  SiteStyleProfile, StyleToken,
} from "@/lib/types";

/**
 * Persistence boundary. Two drivers implement it: a durable file store
 * (default, zero-config) and Postgres (when DATABASE_URL is set).
 */
export interface Store {
  createAudit(audit: Audit): Promise<void>;
  getAudit(id: string): Promise<Audit | null>;
  updateAudit(id: string, patch: Partial<Audit>): Promise<void>;

  savePages(auditId: string, pages: AuditPage[]): Promise<void>;
  getPages(auditId: string): Promise<AuditPage[]>;

  saveTokens(auditId: string, tokens: StyleToken[]): Promise<void>;
  getTokens(auditId: string): Promise<StyleToken[]>;

  saveRules(auditId: string, rules: BrandRule[]): Promise<void>;
  getRules(auditId: string): Promise<BrandRule[]>;

  saveFindings(auditId: string, findings: Finding[]): Promise<void>;
  getFindings(auditId: string): Promise<Finding[]>;

  savePreview(preview: Preview): Promise<void>;
  getPreview(auditId: string): Promise<Preview | null>;

  saveProfile(auditId: string, profile: SiteStyleProfile): Promise<void>;
  getProfile(auditId: string): Promise<SiteStyleProfile | null>;

  createLead(lead: Lead): Promise<void>;
  recordEvent(event: AnalyticsEvent): Promise<void>;
  countRecentAudits(ipHash: string, sinceIso: string): Promise<number>;
  recordAuditOrigin(auditId: string, ipHash: string): Promise<void>;
}
