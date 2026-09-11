import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/audits/:id — status while running, full result when complete. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9]{6,64}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const store = getStore();
  const audit = await store.getAudit(id);
  if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (audit.status !== "complete") {
    return NextResponse.json({ audit }, { headers: { "cache-control": "no-store" } });
  }

  const storage = getStorage();
  const [pages, findings, preview] = await Promise.all([
    store.getPages(id),
    store.getFindings(id),
    store.getPreview(id),
  ]);

  return NextResponse.json(
    {
      audit,
      pages: pages.map((p) => ({
        ...p,
        screenshotUrl: p.viewportScreenshot ? storage.url(p.viewportScreenshot) : null,
        fullScreenshotUrl: p.screenshot ? storage.url(p.screenshot) : null,
      })),
      findings,
      preview: preview && {
        ...preview,
        beforeUrl: preview.beforeScreenshot ? storage.url(preview.beforeScreenshot) : null,
        afterUrl: preview.afterScreenshot ? storage.url(preview.afterScreenshot) : null,
        // The generated CSS is available through the preview endpoint, not here.
        css: undefined,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
