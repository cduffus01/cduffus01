/**
 * End-to-end smoke test: serve the fixture site, run the real pipeline against
 * it, and print what a user would see.
 *
 * This is the fastest way to tell whether a change to the engine improved or
 * damaged the product, because the fixture's drift is known in advance
 * (see scripts/README.md).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.ALLOW_PRIVATE_HOSTS = "1";
process.env.DATA_DIR ??= path.resolve(process.cwd(), ".data");

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.join(here, "fixture-site");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serve(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const name = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.join(siteDir, path.normalize(name).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(siteDir) || !fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "text/plain" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const port = Number(process.env.SMOKE_PORT ?? 4319);
  const server = await serve(port);
  const origin = `http://127.0.0.1:${port}/`;
  console.log(`fixture site: ${origin}\n`);

  const { initialAudit, runAudit } = await import("../src/lib/engine/pipeline");
  const { getStore } = await import("../src/lib/store/index");
  const { closeBrowser } = await import("../src/lib/engine/browser");

  const store = getStore();
  const id = `smoke${Date.now().toString(16)}`;
  await store.createAudit(initialAudit(id, origin, "127.0.0.1"));

  const started = Date.now();
  await runAudit({ auditId: id, url: origin });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const audit = await store.getAudit(id);
  const findings = await store.getFindings(id);
  const preview = await store.getPreview(id);
  const pages = await store.getPages(id);

  if (!audit || audit.status !== "complete") {
    console.error("AUDIT FAILED:", audit?.error);
    await closeBrowser();
    server.close();
    process.exit(1);
  }

  const line = "─".repeat(64);
  console.log(line);
  console.log(`BRAND SCORE  ${audit.brandScore} / 100   ${audit.summary?.band}`);
  console.log(`${audit.summary?.verdict}`);
  console.log(line);
  for (const category of audit.categoryScores ?? []) {
    console.log(
      `${category.label.padEnd(16)} ${String(category.score).padStart(3)}  ` +
      `(weight ${Math.round(category.weight * 100)}%, ${category.deviationCount} deviations)`,
    );
  }
  console.log(line);
  console.log(
    `${audit.summary?.totalFindings} inconsistencies · ` +
    `${audit.summary?.autoFixable} auto-fixable · ` +
    `${audit.summary?.needsReview} need review · ` +
    `${audit.summary?.needsAssetReview} need asset review`,
  );
  console.log(`pages analyzed: ${pages.map((p) => `${p.pageType}`).join(", ")}`);
  console.log(line);

  findings.forEach((finding, index) => {
    console.log(
      `${index + 1}. [${finding.category}/${finding.classification}] ${finding.title} ` +
      `(${Math.round(finding.confidence * 100)}%)`,
    );
    console.log(`   ${finding.description}`);
    console.log(`   → ${finding.recommendation}`);
  });

  console.log(line);
  if (preview) {
    console.log(`preview: ${audit.brandScore} → ${preview.projectedScore} (estimated after fixes)`);
    console.log(`changes: ${preview.changes.map((c) => c.label).join(" · ") || "none"}`);
    console.log(`before:  ${preview.beforeScreenshot ?? "—"}`);
    console.log(`after:   ${preview.afterScreenshot ?? "—"}`);
    const cssPath = path.join(process.env.DATA_DIR!, `${id}-preview.css`);
    fs.writeFileSync(cssPath, preview.css);
    console.log(`css:     ${cssPath} (${preview.css.split("\n\n").length} rules)`);
  }
  console.log(`${line}\ncompleted in ${elapsed}s`);

  await closeBrowser();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
