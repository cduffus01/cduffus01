/**
 * Produces the BEFORE / AFTER brand-remediation comparison for one site.
 *
 *   node --experimental-strip-types --import ./tests/register.mjs \
 *     scripts/remediate.ts <url> [brand-guide.pdf] [out.png]
 *
 * This is the product's own pipeline, not a one-off: it crawls the live site,
 * audits it against the supplied guide, generates the remediation stylesheet,
 * re-renders the real page with that stylesheet injected, and composes the two
 * captures. Because the "after" is the same DOM with an override sheet applied,
 * layout, copy, imagery and information architecture cannot drift between the
 * panels — only the corrected properties can.
 */
import fs from "node:fs";
import path from "node:path";

process.env.DATA_DIR ??= path.resolve(process.cwd(), ".data");

async function main() {
  const [, , url, guidePath, outPath] = process.argv;
  if (!url) {
    console.error("usage: remediate.ts <url> [brand-guide.pdf] [out.png]");
    process.exit(1);
  }
  const out = outPath ?? path.resolve(process.cwd(), "comparison.png");

  const { initialAudit, runAudit } = await import("../src/lib/engine/pipeline");
  const { getStore } = await import("../src/lib/store/index");
  const { closeBrowser } = await import("../src/lib/engine/browser");
  const { compose } = await import("./compare");
  const { registrableDomain } = await import("../src/lib/security/url");

  const store = getStore();
  const id = `rem${Date.now().toString(16)}`;
  const domain = registrableDomain(new URL(url.startsWith("http") ? url : `https://${url}`).hostname);
  await store.createAudit(initialAudit(id, url, domain));

  const guide = guidePath ? fs.readFileSync(guidePath) : null;
  console.log(`auditing ${url}${guide ? ` against ${path.basename(guidePath!)}` : ""}...`);
  await runAudit({ auditId: id, url, guide });

  const audit = await store.getAudit(id);
  if (!audit || audit.status !== "complete") {
    console.error("audit failed:", audit?.error?.userMessage ?? "unknown error");
    await closeBrowser();
    process.exit(1);
  }

  const preview = await store.getPreview(id);
  const findings = await store.getFindings(id);
  const storageRoot = path.join(process.env.DATA_DIR!, "objects");

  const line = "-".repeat(70);
  console.log(line);
  console.log(`${audit.domain}  ${audit.brandScore} -> ${preview?.projectedScore ?? "-"}  (${audit.summary?.band})`);
  console.log(`audit type: ${audit.auditType}`);
  for (const c of audit.categoryScores ?? []) {
    console.log(`  ${c.label.padEnd(18)}${String(c.score).padStart(4)}`);
  }
  console.log(line);
  findings.forEach((f, i) => {
    console.log(`${i + 1}. [${f.classification}] ${f.title}`);
    console.log(`   ${f.description}`);
  });
  console.log(line);

  if (!preview?.beforeScreenshot || !preview.afterScreenshot) {
    console.error("no rendered preview to compare (nothing safely fixable, or the render failed)");
    await closeBrowser();
    process.exit(1);
  }

  const notes = (preview.changes ?? []).map(
    (c) => `<b>${c.label}</b> — ${c.before} → ${c.after}`,
  );
  await compose(
    path.join(storageRoot, preview.beforeScreenshot),
    path.join(storageRoot, preview.afterScreenshot),
    out,
    `${audit.domain}${preview.pageUrl ? ` · ${new URL(preview.pageUrl).pathname}` : ""}`,
    notes,
  );
  console.log(`comparison: ${out}`);
  fs.writeFileSync(`${out.replace(/\.png$/, "")}-remediation.css`, preview.css);
  console.log(`stylesheet: ${out.replace(/\.png$/, "")}-remediation.css`);

  await closeBrowser();
}

main().catch((err) => { console.error(err); process.exit(1); });
