import { config } from "@/lib/config";
import { getLlm } from "@/lib/llm";
import { getStorage } from "@/lib/storage";
import type { CapturedPage, ImageryProfile } from "@/lib/types";

/**
 * Vision analysis (spec section 8): used only where CSS and the DOM genuinely
 * cannot answer the question — what the site's imagery actually looks like.
 *
 * Confidence is capped at 0.6 so a perceptual judgement can never materially
 * move the Brand Score (spec section 3F), and the whole module is optional:
 * with no API key the audit runs unchanged, minus this one signal.
 */

interface VisionResponse {
  dominantStyle?: string;
  consistent?: boolean;
  notes?: string[];
}

export async function analyzeImagery(pages: CapturedPage[]): Promise<ImageryProfile> {
  const llm = getLlm();
  const unavailable: ImageryProfile = {
    dominantStyle: null, notes: [], confidence: 0, source: "unavailable",
  };
  if (!llm.isAvailable()) return unavailable;

  const storage = getStorage();
  const keys = pages
    .map((p) => p.viewportScreenshotKey)
    .filter((k): k is string => Boolean(k))
    .slice(0, config.llm.maxImagesPerAudit);
  if (keys.length === 0) return unavailable;

  const images: { base64: string; mediaType: "image/png" }[] = [];
  for (const key of keys) {
    const buffer = await storage.get(key);
    if (buffer) images.push({ base64: buffer.toString("base64"), mediaType: "image/png" });
  }
  if (images.length === 0) return unavailable;

  const response = await llm.completeJson<VisionResponse>({
    system:
      "You characterize the visual style of website screenshots for a brand-consistency " +
      "audit. Describe only what is visible. Judge internal consistency between the " +
      "screenshots, not whether the design is good. Never invent brand rules.",
    prompt:
      `These are ${images.length} page screenshot(s) from one website. Return JSON:\n` +
      '{"dominantStyle":"short phrase, e.g. flat illustration on light surfaces",' +
      '"consistent":true|false,' +
      '"notes":["one short observation about imagery or icon treatment that varies"]}\n' +
      "Keep notes to at most two items, each under 140 characters. If the imagery is " +
      "consistent, return an empty notes array.",
    images,
    maxTokens: 600,
  });

  if (!response) return unavailable;

  const notes = (response.notes ?? [])
    .filter((n) => typeof n === "string")
    .map((n) => n.slice(0, 140))
    .slice(0, 2);

  return {
    dominantStyle: response.dominantStyle?.slice(0, 120) ?? null,
    notes: response.consistent === false ? notes : [],
    confidence: response.consistent === false && notes.length > 0 ? 0.55 : 0,
    source: "vision",
  };
}