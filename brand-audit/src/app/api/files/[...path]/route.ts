import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/** Serves screenshots from the local storage driver. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const key = path.join("/");
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const file = await getStorage().get(key);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
