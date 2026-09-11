/**
 * The in-page harvest script.
 *
 * Everything in `harvestScript` runs inside the audited page's own sandbox and
 * returns a normalized, compressed sample — never the raw DOM (spec section 7).
 * Keep it self-contained: it is serialized into the browser, so it cannot
 * reference anything from module scope.
 */

export interface HarvestResult {
  metadata: {
    title: string;
    description: string | null;
    elementCount: number;
    textLength: number;
    width: number;
    height: number;
  };
  elements: RawElement[];
  images: RawImage[];
  icons: RawIcon[];
  backgroundColors: { color: string; area: number }[];
  links: string[];
  /** Signals used to detect bot walls / auth walls / empty SPAs. */
  signals: {
    bodyText: string;
    hasLoginForm: boolean;
    isChallengePage: boolean;
  };
}

export interface RawElement {
  selector: string;
  tag: string;
  role: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: string;
  textTransform: string;
  color: string;
  backgroundColor: string;
  effectiveBackground: string;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  padding: [number, number, number, number];
  margin: [number, number, number, number];
  width: number;
  height: number;
  classes: string[];
  href?: string;
  inViewport: boolean;
  area: number;
}

export interface RawImage {
  src: string;
  alt: string | null;
  width: number;
  height: number;
  isLogoCandidate: boolean;
  inViewport: boolean;
}

export interface RawIcon {
  selector: string;
  kind: "svg" | "icon-font" | "emoji";
  strokeWidth: number;
  filled: boolean;
  family: string | null;
  viewBox: string | null;
}

/**
 * Returned as a string-compiled function by Playwright's `evaluate`. Written as
 * a normal function for type-checking; do not close over module scope.
 */
export function harvestScript(maxElements: number): HarvestResult {
  const px = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const shortText = (el: Element): string =>
    (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

  const selectorFor = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 5 && node.tagName !== "HTML") {
      let part = node.tagName.toLowerCase();
      const id = node.getAttribute("id");
      if (id && /^[A-Za-z][\w-]*$/.test(id)) {
        parts.unshift(`#${id}`);
        break;
      }
      const cls = (node.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter((c) => c && /^[A-Za-z][\w-]*$/.test(c) && c.length < 32)
        .slice(0, 2);
      if (cls.length) part += `.${cls.join(".")}`;
      const parent: Element | null = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (s) => s.tagName === node!.tagName,
        );
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
      depth++;
    }
    return parts.join(" > ");
  };

  const effectiveBackground = (el: Element): string => {
    let node: Element | null = el;
    let guard = 0;
    while (node && guard < 12) {
      const bg = getComputedStyle(node).backgroundColor;
      const match = bg.match(/rgba?\(([^)]+)\)/);
      if (match) {
        const parts = match[1]!.split(/[\s,/]+/).filter(Boolean);
        const alpha = parts[3] === undefined ? 1 : parseFloat(parts[3]!);
        if (alpha > 0.5) return bg;
      }
      node = node.parentElement;
      guard++;
    }
    return "rgb(255, 255, 255)";
  };

  const isButtonLike = (el: Element, style: CSSStyleDeclaration): boolean => {
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return true;
    if (tag === "input") {
      const t = (el as HTMLInputElement).type;
      return t === "submit" || t === "button";
    }
    if (el.getAttribute("role") === "button") return true;
    if (tag === "a") {
      const cls = (el.getAttribute("class") ?? "").toLowerCase();
      if (/\b(btn|button|cta)\b/.test(cls) || /(^|[-_])(btn|button|cta)/.test(cls)) return true;
      // Visual heuristic: a link with a filled background and real padding is a button.
      const bg = style.backgroundColor;
      const hasFill = bg !== "transparent" && !/rgba\([^)]*,\s*0\s*\)/.test(bg);
      const padded = px(style.paddingLeft) >= 10 && px(style.paddingTop) >= 6;
      const inline = style.display === "inline";
      return hasFill && padded && !inline;
    }
    return false;
  };

  const inAncestor = (el: Element, selector: string): boolean =>
    Boolean(el.closest(selector));

  const roleFor = (el: Element, style: CSSStyleDeclaration): string | null => {
    const tag = el.tagName.toLowerCase();
    if (isButtonLike(el, style)) return "button";
    if (tag === "input" || tag === "textarea" || tag === "select") return "input";
    if (tag === "h1") return "h1";
    if (tag === "h2") return "h2";
    if (tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") return "h3";
    if (tag === "a") {
      if (inAncestor(el, "nav, header, [role='navigation']")) return "nav";
      if (inAncestor(el, "footer")) return "footer";
      return "link";
    }
    if (tag === "p" || tag === "li" || tag === "span" || tag === "div" || tag === "td") {
      if (inAncestor(el, "footer")) return "footer";
      const size = px(style.fontSize);
      if (size > 0 && size < 13) return "caption";
      return "body";
    }
    return null;
  };

  const visible = (el: Element, style: CSSStyleDeclaration, rect: DOMRect): boolean => {
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") < 0.05) return false;
    return rect.width > 1 && rect.height > 1;
  };

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ---- elements -----------------------------------------------------------
  const candidates = Array.from(
    document.querySelectorAll(
      "h1,h2,h3,h4,h5,h6,p,li,a,button,input,textarea,select,span,td,div",
    ),
  );

  const perRoleCap = Math.max(12, Math.floor(maxElements / 8));
  const roleCounts: Record<string, number> = {};
  const elements: RawElement[] = [];

  for (const el of candidates) {
    if (elements.length >= maxElements) break;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!visible(el, style, rect)) continue;

    const role = roleFor(el, style);
    if (!role) continue;

    const text = shortText(el);
    // Containers: only keep a div/span when it is a leaf-ish text node, so we
    // don't record the same string a dozen times up the tree.
    const tag = el.tagName.toLowerCase();
    if ((tag === "div" || tag === "span" || tag === "td") &&
        (!text || el.querySelector("p,h1,h2,h3,h4,h5,h6,li,a,button"))) continue;
    if (role !== "input" && role !== "button" && !text) continue;

    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    if (roleCounts[role]! > perRoleCap) continue;

    const classes = (el.getAttribute("class") ?? "")
      .split(/\s+/).filter(Boolean).slice(0, 6);

    elements.push({
      selector: selectorFor(el),
      tag,
      role,
      text,
      fontFamily: style.fontFamily,
      fontSize: px(style.fontSize),
      fontWeight: Number(style.fontWeight) || (style.fontWeight === "bold" ? 700 : 400),
      lineHeight: px(style.lineHeight) || 0,
      letterSpacing: style.letterSpacing,
      textTransform: style.textTransform,
      color: style.color,
      backgroundColor: style.backgroundColor,
      effectiveBackground: effectiveBackground(el),
      borderRadius: px(style.borderTopLeftRadius),
      borderWidth: px(style.borderTopWidth),
      borderColor: style.borderTopColor,
      padding: [px(style.paddingTop), px(style.paddingRight), px(style.paddingBottom), px(style.paddingLeft)],
      margin: [px(style.marginTop), px(style.marginRight), px(style.marginBottom), px(style.marginLeft)],
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      classes,
      href: tag === "a" ? (el as HTMLAnchorElement).href : undefined,
      inViewport: rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0,
      area: Math.round(rect.width * rect.height),
    });
  }

  // ---- images -------------------------------------------------------------
  const images: RawImage[] = [];
  const imgEls = Array.from(document.querySelectorAll("img")).slice(0, 60);
  for (const img of imgEls) {
    const rect = img.getBoundingClientRect();
    const style = getComputedStyle(img);
    if (!visible(img, style, rect)) continue;
    const src = img.currentSrc || img.src || "";
    if (!src || src.startsWith("data:image/gif")) continue;
    const hint = `${src} ${img.className} ${img.alt ?? ""} ${img.closest("header,nav,footer") ? "chrome" : ""}`.toLowerCase();
    images.push({
      src: src.slice(0, 500),
      alt: img.hasAttribute("alt") ? img.alt : null,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      isLogoCandidate:
        /logo|brand|wordmark/.test(hint) ||
        (rect.width <= 260 && rect.height <= 90 && Boolean(img.closest("header,nav,footer"))),
      inViewport: rect.top < vh && rect.bottom > 0,
    });
  }

  // ---- icons --------------------------------------------------------------
  const icons: RawIcon[] = [];
  const svgs = Array.from(document.querySelectorAll("svg")).slice(0, 80);
  for (const svg of svgs) {
    const rect = svg.getBoundingClientRect();
    if (rect.width < 6 || rect.width > 96 || rect.height < 6) continue;
    const path = svg.querySelector("path, circle, rect, line, polyline, polygon");
    const strokeAttr = path?.getAttribute("stroke") ?? svg.getAttribute("stroke");
    const strokeWidthAttr =
      path?.getAttribute("stroke-width") ?? svg.getAttribute("stroke-width");
    const fillAttr = path?.getAttribute("fill") ?? svg.getAttribute("fill");
    const hasStroke = Boolean(strokeAttr && strokeAttr !== "none");
    const cls = `${svg.getAttribute("class") ?? ""}`.toLowerCase();
    const familyMatch = cls.match(/\b(lucide|feather|heroicon[s]?|fa|font-?awesome|bi|material|ionicon[s]?|tabler|phosphor|octicon)\b/);
    icons.push({
      selector: selectorFor(svg),
      kind: "svg",
      strokeWidth: hasStroke ? parseFloat(strokeWidthAttr ?? "1") || 1 : 0,
      filled: !hasStroke && fillAttr !== "none",
      family: familyMatch ? familyMatch[1]! : null,
      viewBox: svg.getAttribute("viewBox"),
    });
  }
  // Icon fonts and emoji used as iconography.
  const iconFontEls = Array.from(
    document.querySelectorAll("i[class], span[class]"),
  ).slice(0, 120);
  for (const el of iconFontEls) {
    const cls = (el.getAttribute("class") ?? "").toLowerCase();
    const m = cls.match(/\b(fa|fas|far|fab|material-icons|glyphicon|bi|icon)\b/);
    if (m && !shortText(el)) {
      icons.push({
        selector: selectorFor(el), kind: "icon-font", strokeWidth: 0,
        filled: true, family: m[1]!, viewBox: null,
      });
    }
  }
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const el of Array.from(document.querySelectorAll("li,p,h2,h3,span,div")).slice(0, 200)) {
    const t = (el.firstChild?.textContent ?? "").trim().slice(0, 8);
    if (t && emojiRe.test(t)) {
      icons.push({
        selector: selectorFor(el), kind: "emoji", strokeWidth: 0,
        filled: true, family: "emoji", viewBox: null,
      });
      if (icons.length > 140) break;
    }
  }

  // ---- background surfaces ------------------------------------------------
  const bgTally = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll("body,section,main,header,footer,div")).slice(0, 300)) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 40) continue;
    const bg = style.backgroundColor;
    if (!bg || /rgba\([^)]*,\s*0\s*\)/.test(bg)) continue;
    bgTally.set(bg, (bgTally.get(bg) ?? 0) + Math.round(rect.width * rect.height));
  }
  const backgroundColors = Array.from(bgTally.entries())
    .map(([color, area]) => ({ color, area }))
    .sort((a, b) => b.area - a.area)
    .slice(0, 12);

  // ---- links --------------------------------------------------------------
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => (a as HTMLAnchorElement).href)
    .filter((href) => href.startsWith("http"))
    .slice(0, 400);

  // ---- signals ------------------------------------------------------------
  const bodyText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  const lowered = bodyText.slice(0, 1500).toLowerCase();
  const signals = {
    bodyText: bodyText.slice(0, 4000),
    hasLoginForm: Boolean(
      document.querySelector("input[type='password']") &&
      bodyText.length < 2500,
    ),
    isChallengePage:
      /(just a moment|checking your browser|enable javascript and cookies|verify you are human|access denied|attention required)/.test(lowered) &&
      bodyText.length < 2000,
  };

  return {
    metadata: {
      title: document.title?.slice(0, 200) ?? "",
      description:
        document.querySelector("meta[name='description']")?.getAttribute("content")?.slice(0, 300) ?? null,
      elementCount: document.querySelectorAll("*").length,
      textLength: bodyText.length,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    elements,
    images,
    icons,
    backgroundColors,
    links,
    signals,
  };
}
