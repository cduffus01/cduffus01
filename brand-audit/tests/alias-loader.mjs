import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Lets the node test runner load the app's source directly: resolves the
 * tsconfig "@/..." alias and the extensionless relative imports that the
 * bundler resolves in the app itself.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function firstExisting(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = firstExisting(path.join(root, specifier.slice(2)));
    // Hand the resolved path back to Node so it still applies type stripping.
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  if (specifier.startsWith(".") && !path.extname(specifier) && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    const found = firstExisting(base);
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  return nextResolve(specifier, context);
}
