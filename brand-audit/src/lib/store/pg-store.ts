import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import type { Store } from "./types";
import type {
  AnalyticsEvent, Audit, AuditPage, BrandRule, Finding, Lead, Preview,
  SiteStyleProfile, StyleToken,
} from "@/lib/types";

type DocKind = "pages" | "tokens" | "rules" | "findings" | "preview" | "profile";

/**
 * Postgres driver. Plain `pg` with parameterized SQL rather than an ORM: the
 * schema is a handful of tables of read-whole JSONB documents, so codegen and a
 * query-engine binary would be build fragility for no modelling benefit.
 */
export class PostgresStore implements Store {
  private pool: Pool;
  private ready: Promise<void> | null = null;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async init() {
    if (!this.ready) {
      this.ready = (async () => {
        const ddl = await fs.readFile(
          path.join(process.cwd(), "db", "schema.sql"),
          "utf8",
        );
        await this.pool.query(ddl);
      })();
    }
    return this.ready;
  }

  private async q<T = unknown>(text: string, params: unknown[] = []) {
    await this.init();
    return this.pool.query<T extends object ? T : never>(text, params as never[]);
  }

  private async putDoc(auditId: string, kind: DocKind, doc: unknown) {
    await this.q(
      `INSERT INTO audit_documents (audit_id, kind, doc, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (audit_id, kind) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [auditId, kind, JSON.stringify(doc)],
    );
  }

  private async getDoc<T>(auditId: string, kind: DocKind): Promise<T | null> {
    const res = await this.q<{ doc: T }>(
      `SELECT doc FROM audit_documents WHERE audit_id = $1 AND kind = $2`,
      [auditId, kind],
    );
    return res.rows[0]?.doc ?? null;
  }

  async createAudit(audit: Audit) {
    await this.q(
      `INSERT INTO audits (id, url, domain, audit_type, status, created_at, doc)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [audit.id, audit.url, audit.domain, audit.auditType, audit.status,
       audit.createdAt, JSON.stringify(audit)],
    );
  }

  async getAudit(id: string) {
    const res = await this.q<{ doc: Audit }>(`SELECT doc FROM audits WHERE id = $1`, [id]);
    return res.rows[0]?.doc ?? null;
  }

  async updateAudit(id: string, patch: Partial<Audit>) {
    // Merge server-side so concurrent stage updates don't clobber each other.
    await this.q(
      `UPDATE audits SET
         doc = doc || $2::jsonb,
         status = COALESCE($3, status),
         brand_score = COALESCE($4, brand_score),
         projected_score = COALESCE($5, projected_score),
         completed_at = COALESCE($6, completed_at)
       WHERE id = $1`,
      [id, JSON.stringify(patch), patch.status ?? null, patch.brandScore ?? null,
       patch.projectedScore ?? null, patch.completedAt ?? null],
    );
  }

  async savePages(auditId: string, pages: AuditPage[]) { await this.putDoc(auditId, "pages", pages); }
  async getPages(auditId: string) { return (await this.getDoc<AuditPage[]>(auditId, "pages")) ?? []; }
  async saveTokens(auditId: string, tokens: StyleToken[]) { await this.putDoc(auditId, "tokens", tokens); }
  async getTokens(auditId: string) { return (await this.getDoc<StyleToken[]>(auditId, "tokens")) ?? []; }
  async saveRules(auditId: string, rules: BrandRule[]) { await this.putDoc(auditId, "rules", rules); }
  async getRules(auditId: string) { return (await this.getDoc<BrandRule[]>(auditId, "rules")) ?? []; }
  async saveFindings(auditId: string, findings: Finding[]) { await this.putDoc(auditId, "findings", findings); }
  async getFindings(auditId: string) { return (await this.getDoc<Finding[]>(auditId, "findings")) ?? []; }
  async savePreview(preview: Preview) { await this.putDoc(preview.auditId, "preview", preview); }
  async getPreview(auditId: string) { return this.getDoc<Preview>(auditId, "preview"); }
  async saveProfile(auditId: string, profile: SiteStyleProfile) { await this.putDoc(auditId, "profile", profile); }
  async getProfile(auditId: string) { return this.getDoc<SiteStyleProfile>(auditId, "profile"); }

  async createLead(lead: Lead) {
    await this.q(
      `INSERT INTO leads (id, email, audit_id, fix_intent, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [lead.id, lead.email, lead.auditId, lead.fixIntent, lead.source, lead.createdAt],
    );
  }

  async recordEvent(event: AnalyticsEvent) {
    await this.q(
      `INSERT INTO events (id, name, audit_id, props, created_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [event.id, event.name, event.auditId, JSON.stringify(event.props), event.createdAt],
    );
  }

  async recordAuditOrigin(auditId: string, ipHash: string) {
    await this.q(
      `INSERT INTO audit_origins (audit_id, ip_hash) VALUES ($1,$2)
       ON CONFLICT (audit_id) DO NOTHING`,
      [auditId, ipHash],
    );
  }

  async countRecentAudits(ipHash: string, sinceIso: string) {
    const res = await this.q<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_origins
       WHERE ip_hash = $1 AND created_at >= $2`,
      [ipHash, sinceIso],
    );
    return Number(res.rows[0]?.count ?? 0);
  }
}
