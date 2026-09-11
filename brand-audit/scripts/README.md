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
