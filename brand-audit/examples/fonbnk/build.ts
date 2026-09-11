/**
 * Fonbnk homepage — raster brand remediation.
 *
 * The input here is a screenshot, not a live page, so the corrections are
 * applied to pixels rather than to a DOM. Every operation below is driven by a
 * measurement taken from the image itself (see MEASURED), and each is limited
 * to a colour value or a rectangle we located — never a global filter, so
 * photography, third-party marks and the phone's own UI are untouched.
 *
 * Anti-aliased edges are handled by treating each pixel as a blend
 * `p = a·source + (1-a)·backdrop`, recovering `a`, and recomposing against the
 * corrected colour. That keeps glyph and curve edges smooth instead of leaving
 * a fringe of the old colour.
 *
 *   node --experimental-strip-types --import ./tests/register.mjs \
 *     examples/fonbnk/build.ts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const DIR = path.dirname(new URL(import.meta.url).pathname);

/** Values read off the supplied screenshot; see the session's analysis step. */
export const MEASURED = {
  pageBackground: "#0a0e13",
  /** The one green the site actually uses, everywhere. */
  siteGreen: "#02b966",
  bodyText: "#aaabac",
  /** "Try it now": filled, white label. */
  primaryButton: { x0: 72, x1: 487, y0: 1958, y1: 2101, radius: 20 },
  /** "Read the docs": outlined, 3px border, 30px shorter than the primary. */
  secondaryButton: { x0: 524, x1: 1066, y0: 1973, y1: 2086, border: "#303238", borderWidth: 3 },
  /** Below this row the capture is the phone's own browser UI, not the site. */
  siteContentTop: 300,
  deviceScale: 3,
};

/** The guide's canonical values (brand-guides/fonbnk-identity.pdf). */
export const CANONICAL = {
  crispGreen: "#00b74f",
  charcoalGray: "#53565a",
  buttonRadiusCss: 8,
};

const radiusPx = CANONICAL.buttonRadiusCss * MEASURED.deviceScale; // 24 device px

async function main() {
  const beforePath = path.join(DIR, "before.png");
  const afterPath = path.join(DIR, "after.png");
  const src = `data:image/png;base64,${fs.readFileSync(beforePath).toString("base64")}`;

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent("<canvas id=c></canvas>");

    const { dataUrl, stats } = await page.evaluate(
      async ({ src, M, C, radiusPx }) => {
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.src = src; });
        const canvas = document.getElementById("c") as HTMLCanvasElement;
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);

        const image = ctx.getImageData(0, 0, img.width, img.height);
        const d = image.data;
        const W = img.width;
        const rgb = (hex: string) => [
          parseInt(hex.slice(1, 3), 16),
          parseInt(hex.slice(3, 5), 16),
          parseInt(hex.slice(5, 7), 16),
        ];

        /**
         * Recolours pixels that are a blend of `from` over `backdrop`, into the
         * same blend of `to` over `backdrop`. `tolerance` is how far off that
         * blend line a pixel may sit and still count, which is what keeps
         * unrelated colours (body grey, white text, photography) untouched.
         */
        const remap = (
          from: string, to: string, backdrop: string,
          box: { x0: number; y0: number; x1: number; y1: number },
          tolerance = 26,
          minAlpha = 0.06,
        ) => {
          const [fr, fg, fb] = rgb(from);
          const [tr, tg, tb] = rgb(to);
          const [br, bg_, bb] = rgb(backdrop);
          const dr = fr - br, dg = fg - bg_, db = fb - bb;
          const denom = dr * dr + dg * dg + db * db;
          let touched = 0;
          for (let y = box.y0; y <= box.y1; y++) {
            for (let x = box.x0; x <= box.x1; x++) {
              const i = (y * W + x) * 4;
              const pr = d[i] - br, pg = d[i + 1] - bg_, pb = d[i + 2] - bb;
              const alpha = (pr * dr + pg * dg + pb * db) / denom;
              if (alpha < minAlpha || alpha > 1.08) continue;
              // Distance from the blend line: rejects anything that merely has
              // a similar brightness.
              const ex = pr - alpha * dr, ey = pg - alpha * dg, ez = pb - alpha * db;
              if (Math.sqrt(ex * ex + ey * ey + ez * ez) > tolerance) continue;
              const a = Math.min(1, alpha);
              d[i]     = br  + a * (tr - br);
              d[i + 1] = bg_ + a * (tg - bg_);
              d[i + 2] = bb  + a * (tb - bb);
              touched++;
            }
          }
          return touched;
        };

        const fill = (box: { x0: number; y0: number; x1: number; y1: number }, hex: string) => {
          const [r, g, b] = rgb(hex);
          for (let y = box.y0; y <= box.y1; y++) {
            for (let x = box.x0; x <= box.x1; x++) {
              const i = (y * W + x) * 4;
              d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
            }
          }
        };

        /** Clears pixels that fall outside a rounded rectangle's corners. */
        const roundCorners = (
          box: { x0: number; y0: number; x1: number; y1: number },
          radius: number, backdrop: string,
        ) => {
          const [br, bg_, bb] = rgb(backdrop);
          const corners = [
            { cx: box.x0 + radius, cy: box.y0 + radius, sx: -1, sy: -1 },
            { cx: box.x1 - radius, cy: box.y0 + radius, sx: 1, sy: -1 },
            { cx: box.x0 + radius, cy: box.y1 - radius, sx: -1, sy: 1 },
            { cx: box.x1 - radius, cy: box.y1 - radius, sx: 1, sy: 1 },
          ];
          let cleared = 0;
          for (const { cx, cy, sx, sy } of corners) {
            for (let y = cy; sy < 0 ? y >= box.y0 : y <= box.y1; y += sy) {
              for (let x = cx; sx < 0 ? x >= box.x0 : x <= box.x1; x += sx) {
                const dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy <= radius * radius) continue;
                const i = (y * W + x) * 4;
                d[i] = br; d[i + 1] = bg_; d[i + 2] = bb; d[i + 3] = 255;
                cleared++;
              }
            }
          }
          return cleared;
        };

        const stats: Record<string, number> = {};
        const site = { x0: 0, y0: M.siteContentTop, x1: W - 1, y1: img.height - 1 };
        const primary = M.primaryButton;

        // 1. Every appearance of the site's green becomes the canonical green:
        //    logo, the "global commerce" accent, and the primary button fill.
        stats.greenPixels = remap(M.siteGreen, C.crispGreen, M.pageBackground, site);

        // 2. The primary button's white label fails AA on green (2.58:1).
        //    The guide's instruction is to keep the green and change how it is
        //    used, so the label goes to the page ink (7.27:1) and the canonical
        //    fill stays exactly as specified.
        stats.labelPixels = remap(
          "#ffffff", M.pageBackground, C.crispGreen,
          { x0: primary.x0, y0: primary.y0, x1: primary.x1, y1: primary.y1 },
          60,
        );

        // 3. Both buttons take the guide's 8px radius (24px at 3x).
        stats.primaryCorners = roundCorners(primary, radiusPx, M.pageBackground);

        // 4. The secondary button is 30px shorter than the primary and drawn in
        //    an undocumented grey. Erase its border ring, then redraw it at the
        //    primary's height in the documented Charcoal Gray. Its label and
        //    position are untouched.
        const sec = M.secondaryButton;
        const pad = sec.borderWidth + 2;
        fill({ x0: sec.x0 - pad, y0: sec.y0 - pad, x1: sec.x1 + pad, y1: sec.y0 + pad }, M.pageBackground);
        fill({ x0: sec.x0 - pad, y0: sec.y1 - pad, x1: sec.x1 + pad, y1: sec.y1 + pad }, M.pageBackground);
        fill({ x0: sec.x0 - pad, y0: sec.y0 - pad, x1: sec.x0 + pad, y1: sec.y1 + pad }, M.pageBackground);
        fill({ x0: sec.x1 - pad, y0: sec.y0 - pad, x1: sec.x1 + pad, y1: sec.y1 + pad }, M.pageBackground);

        ctx.putImageData(image, 0, 0);

        ctx.save();
        ctx.strokeStyle = C.charcoalGray;
        ctx.lineWidth = sec.borderWidth;
        ctx.beginPath();
        const half = sec.borderWidth / 2;
        ctx.roundRect(
          sec.x0 + half, primary.y0 + half,
          sec.x1 - sec.x0 - sec.borderWidth + 1,
          primary.y1 - primary.y0 - sec.borderWidth + 1,
          radiusPx,
        );
        ctx.stroke();
        ctx.restore();

        return { dataUrl: canvas.toDataURL("image/png"), stats };
      },
      { src, M: MEASURED, C: CANONICAL, radiusPx },
    );

    fs.writeFileSync(afterPath, Buffer.from(dataUrl.split(",")[1]!, "base64"));
    console.log("pixels recoloured:", JSON.stringify(stats));
    console.log(`wrote ${afterPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
