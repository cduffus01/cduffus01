import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { clientIp, hashIp, track } from "@/lib/analytics";
import { config } from "@/lib/config";
import { jobQueue } from "@/lib/queue";
import { normalizeInputUrl, registrableDomain, validateAuditUrl } from "@/lib/security/url";
import { getStore } from "@/lib/store";
import { initialAudit, runAudit } from "@/lib/engine/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GUIDE_BYTES = 12 * 1024 * 1024;

/**
 * POST /api/audits — { url } (or multipart with an optional brand guide).
 * Returns immediately with an audit id; the work runs on the queue.
 */
export async function POST(request: Request) {
  const store = getStore();
  const ipHash = hashIp(clientIp(request.headers));

  let url = "";
  let guide: Buffer | null = null;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    url = String(form.get("url") ?? "");
    const file = form.get("guide");
    if (file && typeof file !== "string") {
      if (file.size > MAX_GUIDE_BYTES) {
        return NextResponse.json(
          { error: "Brand guide is too large (12MB max)." },
          { status: 413 },
        );
      }
      if (file.type && !file.type.includes("pdf")) {
        return NextResponse.json(
          { error: "Only PDF brand guides are supported right now." },
          { status: 415 },
        );
      }
      guide = Buffer.from(await file.arrayBuffer());
    }
  } else {
    const body = (await request.json().catch(() => ({}))) as { url?: string };
    url = String(body.url ?? "");
  }

  const normalized = normalizeInputUrl(url);
  if (!normalized.ok || !normalized.url) {
    return NextResponse.json({ error: normalized.reason ?? "Invalid URL." }, { status: 400 });
  }
  // Full DNS/SSRF validation happens here too, so an unusable URL fails fast
  // instead of producing a queued audit that can only fail.
  const validated = await validateAuditUrl(url);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.reason ?? "That URL can't be audited." }, { status: 400 });
  }

  const id = crypto.randomBytes(9).toString("hex");
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await store.countRecentAudits(ipHash, since);
    if (recent >= config.rateLimit.auditsPerHourPerIp) {
      return NextResponse.json(
        { error: "You've run a lot of audits in the last hour. Try again later." },
        { status: 429 },
      );
    }

    const audit = initialAudit(id, normalized.url.href, registrableDomain(normalized.url.hostname));
    if (guide) audit.auditType = "compliance";

    await store.createAudit(audit);
    await store.recordAuditOrigin(id, ipHash);
  } catch (err) {
    // Storage is down: say so rather than returning an audit id that can never
    // be read back.
    console.error("[api/audits] storage unavailable", err);
    return NextResponse.json(
      { error: "We can't start audits right now. Please try again shortly." },
      { status: 503 },
    );
  }

  await track("url_submitted", id, { domain: registrableDomain(normalized.url.hostname), withGuide: Boolean(guide) });
  if (guide) await track("guide_uploaded", id, { bytes: guide.byteLength });

  jobQueue.enqueue(id, () => runAudit({ auditId: id, url: normalized.url!.href, guide }));

  return NextResponse.json({ audit_id: id, status: "queued" }, { status: 202 });
}
