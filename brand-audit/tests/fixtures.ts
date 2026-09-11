import type { CapturedElement, CapturedPage, ElementRole } from "@/lib/types";

/** Builds a captured element with sensible defaults so tests state only what matters. */
export function el(overrides: Partial<CapturedElement> & { role: ElementRole }): CapturedElement {
  return {
    selector: `div.x:nth-of-type(${Math.floor(Math.random() * 90) + 1})`,
    tag: "div",
    text: "Sample text",
    fontFamily: "Inter",
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 24,
    letterSpacing: "normal",
    textTransform: "none",
    color: "rgb(12, 12, 13)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    effectiveBackground: "rgb(255, 255, 255)",
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "rgb(0,0,0)",
    padding: [8, 16, 8, 16],
    margin: [0, 0, 0, 0],
    width: 200,
    height: 40,
    classes: [],
    inViewport: true,
    area: 8000,
    ...overrides,
  };
}

export function page(url: string, elements: CapturedElement[]): CapturedPage {
  return {
    url,
    pageType: url.endsWith("/") || !url.split("/")[3] ? "homepage" : "other",
    metadata: {
      title: "Test", description: null, elementCount: elements.length * 4,
      textLength: 2000, width: 1440, height: 3000,
    },
    elements,
    images: [],
    icons: [],
    backgroundColors: [{ color: "rgb(255,255,255)", area: 1_400_000 }],
    screenshotKey: null,
    viewportScreenshotKey: null,
  };
}

/** A site where every treatment is applied consistently. */
export function consistentSite(): CapturedPage[] {
  const headings = Array.from({ length: 10 }, (_, i) =>
    el({ role: "h1", fontFamily: "Inter", fontWeight: 700, fontSize: 40, selector: `h1:nth-of-type(${i + 1})` }));
  const body = Array.from({ length: 20 }, (_, i) =>
    el({ role: "body", fontFamily: "Inter", fontWeight: 400, fontSize: 16, selector: `p:nth-of-type(${i + 1})` }));
  const buttons = Array.from({ length: 8 }, (_, i) =>
    el({
      role: "button", fontFamily: "Inter", fontWeight: 600, fontSize: 15,
      backgroundColor: "rgb(0, 183, 79)", color: "rgb(255,255,255)", borderRadius: 8,
      selector: `button:nth-of-type(${i + 1})`, text: "Get started",
    }));
  return [page("https://example.com/", [...headings, ...body, ...buttons])];
}
