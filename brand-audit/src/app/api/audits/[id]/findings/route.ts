import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/audits/:id/findings */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9]{6,64}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const findings = await getStore().getFindings(id);
  return NextResponse.json({ findings });
}
