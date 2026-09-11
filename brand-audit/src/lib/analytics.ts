import crypto from "node:crypto";
import { getStore } from "@/lib/store";

/**
 * Analytics (spec section 27). V0 is a product experiment, so the funnel is
 * instrumented from the first commit: visitor -> URL submitted -> audit
 * completed -> preview viewed -> fix clicked -> email captured.
 */

export const FUNNEL_EVENTS = [
  "home_view",
  "url_submitted",
  "audit_completed",
  "audit_failed",
  "results_view",
  "finding_expanded",
  "preview_click",
  "before_after_interacted",
  "fix_click",
  "email_submitted",
  "guide_uploaded",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export async function track(
  name: string,
  auditId: string | null,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    await getStore().recordEvent({
      id: crypto.randomUUID(),
      name: name.slice(0, 64),
      auditId,
      props,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Analytics must never break a user-facing request.
  }
}

/** IPs are hashed with a per-deployment salt and never stored in the clear. */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "brand-audit-v0";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
