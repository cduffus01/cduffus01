# Fixture site + smoke test

`fixture-site/` is a small static site with **deliberate, documented drift**, so
the pipeline can be checked against a known answer rather than against vibes.

Planted issues:

| Where | Drift |
| --- | --- |
| `pricing.html` | H1 set in Arial 400 instead of Inter 700 |
| `pricing.html` | primary button is `#00a644` with a 20px radius and weight 400 |
| `product.html` | a third button treatment in `#00b84f` |
| `pricing.html` | prices set in Georgia — a third typeface |
| `pricing.html` | `.plan-note` / `.fine-print` copy at ~1.5:1 contrast, 11px |
| `pricing.html` | `chart.svg` has no `alt` attribute |
| `index.html`, `product.html` | emoji used alongside drawn SVG icons |
| `product.html` | icons mix 1px stroke, 2px stroke and filled |

`#00b74f`, `#00b84f` and `#00a644` are three near-identical greens: the case the
colour clustering exists to catch.

Run it:

```bash
npm run smoke          # serves the fixture, runs a full audit, prints the result
```

The smoke test writes screenshots and the preview CSS to `.data/` so the
before/after render can be inspected by eye.

## Producing a BEFORE / AFTER comparison

```bash
node --experimental-strip-types --import ./tests/register.mjs \
  scripts/remediate.ts <url> [brand-guide.pdf] [out.png]
```

Crawls the live site, audits it against the guide, generates the remediation
stylesheet, re-renders the real page with that sheet injected, and composes a
labelled two-panel image. Because the "after" is the same DOM with an override
sheet applied, layout, copy, imagery and information architecture cannot drift
between panels — only the corrected properties can. `scripts/compare.ts`
refuses to compose panels whose dimensions differ, rather than scaling one to
fit and quietly misrepresenting the comparison.

`VIEWPORT_HEIGHT=1400` captures more of the page in each panel.

Brand guides live in `brand-guides/`. `fonbnk-identity.pdf` encodes the Fonbnk
identity spec (Crisp Green #00B74F, Charcoal Gray #53565A, Freight Text Pro
headlines, Objektiv Mk1 UI/body, 8px button radius).

Freight Text Pro and Objektiv Mk1 are licensed faces we cannot embed, so the
preview renders approved open approximations — Source Serif 4 and Archivo —
while the findings still report the canonical names and the substitution.
`assets/fonts/embedded.css` inlines those faces so a preview never depends on
an external font request that the audited site's CSP might block.
