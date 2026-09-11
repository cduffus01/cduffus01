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
  "freight text": "Libre Baskerville",
  "freight sans": "Public Sans",
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
