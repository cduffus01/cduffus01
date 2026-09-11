import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import type { Store } from "./types";
import type {
  AnalyticsEvent, Audit, AuditPage, BrandRule, Finding, Lead, Preview,
  SiteStyleProfile, StyleToken,
} from "@/lib/types";

/**
 * Durable JSON-on-disk store. The V0 deployment is already a stateful
 * container (Playwright needs one), so this removes an external dependency
 * without removing durability.
 *
 * Writes are serialized per audit through a promise chain to avoid interleaved
 * read-modify-write on the same document.
 */
export class FileStore implements Store {
  private root: string;
  private locks = new Map<string, Promise<unknown>>();

  constructor(root = path.join(config.dataDir, "audits")) {
    this.root = root;
  }

  private dir(auditId: string) {
    // Audit ids are generated internally (hex), but never trust an id that
    // reached us from a URL path.
    if (!/^[a-z0-9_-]{6,64}$/i.test(auditId)) throw new Error("invalid audit id");
    return path.join(this.root, auditId);
  }

  private async read<T>(auditId: string, file: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(path.join(this.dir(auditId), file), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async write(auditId: string, file: string, data: unknown): Promise<void> {
    const dir = this.dir(auditId);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, file);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), "utf8");
    await fs.rename(tmp, target);
  }

  /** Serializes mutations that read-then-write the same document. */
  private lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(key, next.catch(() => undefined));
    return next;
  }

  private async append(file: string, row: unknown): Promise<void> {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.appendFile(path.join(config.dataDir, file), `${JSON.stringify(row)}\n`, "utf8");
  }

  async createAudit(audit: Audit) { await this.write(audit.id, "audit.json", audit); }

  async getAudit(id: string) { return this.read<Audit>(id, "audit.json"); }

  async updateAudit(id: string, patch: Partial<Audit>) {
    await this.lock(id, async () => {
      const current = await this.read<Audit>(id, "audit.json");
      if (!current) return;
      await this.write(id, "audit.json", { ...current, ...patch });
    });
  }

  async savePages(auditId: string, pages: AuditPage[]) { await this.write(auditId, "pages.json", pages); }
  async getPages(auditId: string) { return (await this.read<AuditPage[]>(auditId, "pages.json")) ?? []; }

  async saveTokens(auditId: string, tokens: StyleToken[]) { await this.write(auditId, "tokens.json", tokens); }
  async getTokens(auditId: string) { return (await this.read<StyleToken[]>(auditId, "tokens.json")) ?? []; }

  async saveRules(auditId: string, rules: BrandRule[]) { await this.write(auditId, "rules.json", rules); }
  async getRules(auditId: string) { return (await this.read<BrandRule[]>(auditId, "rules.json")) ?? []; }

  async saveFindings(auditId: string, findings: Finding[]) { await this.write(auditId, "findings.json", findings); }
  async getFindings(auditId: string) { return (await this.read<Finding[]>(auditId, "findings.json")) ?? []; }

  async savePreview(preview: Preview) { await this.write(preview.auditId, "preview.json", preview); }
  async getPreview(auditId: string) { return this.read<Preview>(auditId, "preview.json"); }

  async saveProfile(auditId: string, profile: SiteStyleProfile) { await this.write(auditId, "profile.json", profile); }
  async getProfile(auditId: string) { return this.read<SiteStyleProfile>(auditId, "profile.json"); }

  async createLead(lead: Lead) { await this.append("leads.ndjson", lead); }
  async recordEvent(event: AnalyticsEvent) { await this.append("events.ndjson", event); }

  async recordAuditOrigin(auditId: string, ipHash: string) {
    await this.append("origins.ndjson", { auditId, ipHash, at: new Date().toISOString() });
  }

  async countRecentAudits(ipHash: string, sinceIso: string) {
    try {
      const raw = await fs.readFile(path.join(config.dataDir, "origins.ndjson"), "utf8");
      let count = 0;
      for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
          const row = JSON.parse(line) as { ipHash: string; at: string };
          if (row.ipHash === ipHash && row.at >= sinceIso) count++;
        } catch { /* skip malformed line */ }
      }
      return count;
    } catch {
      return 0;
    }
  }
}
