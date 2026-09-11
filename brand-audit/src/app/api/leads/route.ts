import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads — "Fix My Brand" intent capture (spec section 16).
 *
 * This is the most important behavioural metric in V0: of the users who see a
 * result, how many want the system to remediate it?
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    auditId?: string;
    source?: string;
  };

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const auditId = typeof body.auditId === "string" && /^[a-f0-9]{6,64}$/i.test(body.auditId)
    ? body.auditId
    : null;

  await getStore().createLead({
    id: crypto.randomUUID(),
    email,
    auditId,
    fixIntent: true,
    source: String(body.source ?? "fix_my_brand").slice(0, 40),
    createdAt: new Date().toISOString(),
  });

  await track("email_submitted", auditId, { source: body.source ?? "fix_my_brand" });

  return NextResponse.json({ ok: true });
}
