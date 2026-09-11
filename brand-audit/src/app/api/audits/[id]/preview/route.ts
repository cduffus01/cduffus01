import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/audits/:id/preview — before/after plus the exact CSS we applied. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9]{6,64}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const preview = await getStore().getPreview(id);
  if (!preview) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const storage = getStorage();
  return NextResponse.json({
    preview: {
      ...preview,
      beforeUrl: preview.beforeScreenshot ? storage.url(preview.beforeScreenshot) : null,
      afterUrl: preview.afterScreenshot ? storage.url(preview.afterScreenshot) : null,
    },
  });
}
