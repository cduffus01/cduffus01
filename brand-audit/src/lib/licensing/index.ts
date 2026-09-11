import type { AssetRequirement } from "@/lib/types";

/**
 * Rights Resolver (spec section 17) — an INTERFACE, not a dependency.
 *
 * V0 answers only from a small open-font dataset. A commercial resolver
 * (entitlement lookup, marketplace pricing) implements the same interface later
 * without any change to findings or remediation.
 */
export interface RightsResolver {
  resolveFont(family: string): Promise<AssetRequirement>;
}

/** Popular open-licensed families and the closest open substitutes. */
const OPEN_FONTS = new Set([
  "inter", "roboto", "open sans", "lato", "montserrat", "poppins", "raleway",
  "source sans pro", "source sans 3", "nunito", "nunito sans", "work sans",
  "dm sans", "dm serif display", "playfair display", "merriweather",
  "libre baskerville", "libre franklin", "ibm plex sans", "ibm plex serif",
  "ibm plex mono", "space grotesk", "manrope", "figtree", "outfit", "rubik",
  "karla", "mulish", "jetbrains mono", "fira sans", "fira code", "noto sans",
  "noto serif", "pt sans", "pt serif", "public sans", "geist", "geist mono",
  "system-ui", "-apple-system", "arial", "helvetica", "georgia", "times new roman",
]);

/** Commercial families we can name a credible open substitute for. */
const SUBSTITUTES: Record<string, string> = {
  "freight text": "Source Serif 4",
  "freight sans": "Public Sans",
  "objektiv": "Archivo",
  "gotham": "Montserrat",
  "proxima nova": "Figtree",
  "circular": "Manrope",
  "avenir": "Nunito Sans",
  "futura": "Jost",
  "helvetica neue": "Inter",
  "brandon grotesque": "Josefin Sans",
  "sofia pro": "Poppins",
  "graphik": "Inter",
  "founders grotesk": "Space Grotesk",
  "tiempos": "Source Serif 4",
  "苹方": "Noto Sans SC",
};

export function normalizeFamily(family: string): string {
  return family
    .split(",")[0]!
    .replace(/["']/g, "")
    .trim()
    .toLowerCase();
}

class OpenDatasetResolver implements RightsResolver {
  async resolveFont(family: string): Promise<AssetRequirement> {
    const key = normalizeFamily(family);
    if (OPEN_FONTS.has(key)) {
      return {
        kind: "font",
        required: family,
        status: "open_source",
        freeAlternative: null,
        note: "Open-licensed or system font — no licence needed to apply this fix.",
      };
    }
    const substitute = Object.entries(SUBSTITUTES).find(([k]) => key.includes(k))?.[1];
    if (substitute) {
      return {
        kind: "font",
        required: family,
        status: "commercial",
        freeAlternative: substitute,
        note: `${family} is a licensed typeface. ${substitute} is a close open-licensed substitute.`,
      };
    }
    return {
      kind: "font",
      required: family,
      status: "unknown",
      freeAlternative: null,
      note: "We couldn't determine the licence for this typeface.",
    };
  }
}

let resolver: RightsResolver | null = null;
export function getRightsResolver(): RightsResolver {
  if (!resolver) resolver = new OpenDatasetResolver();
  return resolver;
}


// ---------------------------------------------------------------------------
// Rendering substitution
// ---------------------------------------------------------------------------

/**
 * A brand guide can require a typeface nobody can render — a licensed font the
 * audited site doesn't serve and we have no right to embed. The preview then
 * has to approximate it, because showing the drifted original would understate
 * the fix and silently swapping in an unrelated face would misrepresent the
 * brand.
 *
 * So we substitute deliberately: the closest open-licensed face of the same
 * classification, chosen from this table only — never from anything the audited
 * page supplied — and the finding still reports the canonical name plus the
 * substitution.
 */
export interface RenderableFont {
  /** CSS font-family stack safe to place in the preview stylesheet. */
  stack: string;
  /** Google Fonts family to load, when the substitute needs fetching. */
  googleFamily: string | null;
  /** True when this is an approximation rather than the canonical face. */
  substituted: boolean;
  classification: "serif" | "sans";
}

const GENERIC_SERIF = 'Georgia, "Times New Roman", serif';
const GENERIC_SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** Open faces we are willing to load, with their classification. */
const RENDERABLE: Record<string, { google: string; classification: "serif" | "sans" }> = {
  "source serif 4": { google: "Source Serif 4", classification: "serif" },
  "libre baskerville": { google: "Libre Baskerville", classification: "serif" },
  "crimson pro": { google: "Crimson Pro", classification: "serif" },
  "archivo": { google: "Archivo", classification: "sans" },
  "inter": { google: "Inter", classification: "sans" },
  "public sans": { google: "Public Sans", classification: "sans" },
  "figtree": { google: "Figtree", classification: "sans" },
  "manrope": { google: "Manrope", classification: "sans" },
  "montserrat": { google: "Montserrat", classification: "sans" },
  "nunito sans": { google: "Nunito Sans", classification: "sans" },
  "jost": { google: "Jost", classification: "sans" },
  "space grotesk": { google: "Space Grotesk", classification: "sans" },
  "josefin sans": { google: "Josefin Sans", classification: "sans" },
  "poppins": { google: "Poppins", classification: "sans" },
};

/** Serif-sounding names, used only to classify a face we can't render. */
const SERIF_HINT = /(serif|freight text|georgia|times|garamond|baskerville|caslon|didot|bodoni|minion|tiempos|spectral|playfair|merriweather|lora|cormorant)/i;

export function resolveRenderableFont(canonical: string): RenderableFont {
  const key = normalizeFamily(canonical);
  const direct = RENDERABLE[key];
  if (direct) {
    return {
      stack: `"${direct.google}", ${direct.classification === "serif" ? GENERIC_SERIF : GENERIC_SANS}`,
      googleFamily: direct.google,
      substituted: false,
      classification: direct.classification,
    };
  }

  // A system or web-safe face the browser already has needs no substitution.
  if (OPEN_FONTS.has(key)) {
    const classification = SERIF_HINT.test(key) ? "serif" : "sans";
    return {
      stack: `"${canonical.split(",")[0]!.replace(/["']/g, "").trim()}", ${classification === "serif" ? GENERIC_SERIF : GENERIC_SANS}`,
      googleFamily: null,
      substituted: false,
      classification,
    };
  }

  const substituteName = Object.entries(SUBSTITUTES).find(([k]) => key.includes(k))?.[1];
  const substitute = substituteName ? RENDERABLE[substituteName.toLowerCase()] : undefined;
  if (substitute) {
    return {
      stack: `"${substitute.google}", ${substitute.classification === "serif" ? GENERIC_SERIF : GENERIC_SANS}`,
      googleFamily: substitute.google,
      substituted: true,
      classification: substitute.classification,
    };
  }

  // Unknown face: keep its classification so the editorial/functional contrast
  // the guide asks for survives, even though the exact face cannot.
  const classification = SERIF_HINT.test(key) ? "serif" : "sans";
  return {
    stack: classification === "serif" ? GENERIC_SERIF : GENERIC_SANS,
    googleFamily: null,
    substituted: true,
    classification,
  };
}

/** Stylesheet URL for a family from the table above. Never user-supplied. */
export function googleFontUrl(families: string[]): string | null {
  const allowed = [...new Set(families)]
    .filter((f) => RENDERABLE[f.toLowerCase()])
    .map((f) => `family=${encodeURIComponent(f)}:ital,wght@0,400;0,500;0,600;0,700;1,400`);
  if (allowed.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${allowed.join("&")}&display=swap`;
}
