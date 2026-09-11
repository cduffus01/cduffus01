/**
 * Composes the labelled BEFORE / AFTER comparison.
 *
 * Both panels must come from the same viewport, crop and scroll position, so
 * the only visible differences are the brand corrections. This refuses to
 * compose panels whose dimensions differ rather than scaling one to fit, which
 * would quietly misrepresent the comparison.
 *
 *   node --experimental-strip-types --import ./tests/register.mjs \
 *     scripts/compare.ts <before.png> <after.png> <out.png> [site label]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

/** Minimal PNG header read: width and height from the IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${file} is not a PNG`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const dataUri = (file: string) =>
  `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

export async function compose(
  beforePath: string,
  afterPath: string,
  outPath: string,
  siteLabel: string,
  notes: string[] = [],
): Promise<void> {
  const before = pngSize(beforePath);
  const after = pngSize(afterPath);
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `panel sizes differ (${before.width}x${before.height} vs ${after.width}x${after.height}); ` +
      "both panels must be captured at the same viewport and scroll position",
    );
  }

  const gutter = 28;
  const padding = 36;
  const headerHeight = 92;
  const footerHeight = notes.length ? 30 + notes.length * 24 : 0;
  const width = before.width * 2 + gutter + padding * 2;
  const height = before.height + headerHeight + footerHeight + padding;

  const html = `<!doctype html>
<meta charset="utf-8">
<style>
  @page { margin: 0 }
  body {
    margin: 0; width: ${width}px; background: #f4f4f1;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #0c0c0d; -webkit-font-smoothing: antialiased;
  }
  .wrap { padding: ${padding}px; padding-top: 26px; }
  .titles { display: grid; grid-template-columns: ${before.width}px ${before.width}px;
            gap: ${gutter}px; margin-bottom: 14px; }
  .eyebrow { font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: #6b6b70; }
  .site { font-size: 13px; color: #6b6b70; margin-bottom: 18px; }
  h2 { font-size: 20px; margin: 6px 0 0; letter-spacing: -0.02em; font-weight: 600; }
  .tag { display:inline-block; margin-left: 8px; font-size: 11px; font-weight: 600;
         padding: 3px 8px; border-radius: 999px; vertical-align: 3px; }
  .before .tag { background: #e9e9e5; color: #53565A; }
  .after .tag { background: #00B74F; color: #fff; }
  .panels { display: grid; grid-template-columns: ${before.width}px ${before.width}px; gap: ${gutter}px; }
  .panel { border: 1px solid #dedbd5; border-radius: 10px; overflow: hidden; background: #fff;
           box-shadow: 0 1px 2px rgb(12 12 13 / .05), 0 10px 28px -18px rgb(12 12 13 / .35); }
  .panel img { display: block; width: ${before.width}px; height: ${before.height}px; }
  .notes { margin-top: 26px; font-size: 13px; color: #53565A; line-height: 1.9; }
  .notes b { color: #0c0c0d; font-weight: 600; }
</style>
<div class="wrap">
  <div class="site">${escapeHtml(siteLabel)} · ${before.width}×${before.height} · same viewport, crop and scroll position</div>
  <div class="titles">
    <div class="before">
      <div class="eyebrow">Before</div>
      <h2>Current website<span class="tag">AS-IS</span></h2>
    </div>
    <div class="after">
      <div class="eyebrow">After</div>
      <h2>Brand-remediated<span class="tag">AUTOMATED FIX</span></h2>
    </div>
  </div>
  <div class="panels">
    <div class="panel"><img src="${dataUri(beforePath)}" alt="Before"></div>
    <div class="panel"><img src="${dataUri(afterPath)}" alt="After"></div>
  </div>
  ${notes.length ? `<div class="notes">${notes.map((n) => `<div>${n}</div>`).join("")}</div>` : ""}
</div>`;

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: outPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("compare.ts")) {
  const [, , beforePath, afterPath, outPath, label] = process.argv;
  if (!beforePath || !afterPath || !outPath) {
    console.error("usage: compare.ts <before.png> <after.png> <out.png> [label]");
    process.exit(1);
  }
  compose(beforePath, afterPath, outPath, label ?? "")
    .then(() => console.log(`wrote ${outPath}`))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
