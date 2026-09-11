import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/events — client-side funnel instrumentation. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    auditId?: string;
    props?: Record<string, unknown>;
  };

  const name = String(body.name ?? "").slice(0, 64);
  if (!/^[a-z0-9_]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  const auditId = typeof body.auditId === "string" && /^[a-f0-9]{6,64}$/i.test(body.auditId)
    ? body.auditId
    : null;

  // Props are client-supplied: keep them small and scalar-only.
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body.props ?? {}).slice(0, 10)) {
    if (["string", "number", "boolean"].includes(typeof value)) {
      props[key.slice(0, 32)] = typeof value === "string" ? value.slice(0, 120) : value;
    }
  }

  await track(name, auditId, props);
  return NextResponse.json({ ok: true });
}
