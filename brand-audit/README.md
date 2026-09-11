# Brand Audit — V0

**See if your website is on-brand.**

Paste a URL → get a Brand Score from 0–100, the handful of inconsistencies that
actually matter, and a real before/after preview of your own site with the fixes
applied.

```
URL  →  crawl  →  Brand Score  →  5–10 findings  →  one convincing before/after
```

That single flow is the product hypothesis this V0 exists to test: *do people
who see a score care enough to want it fixed?*

---

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

No database, no API key, no signup — the app boots with zero configuration.
Everything optional lives in `.env.example`:

| Set this | To get |
| --- | --- |
| `DATABASE_URL` | Postgres instead of the durable file store |
| `ANTHROPIC_API_KEY` | imagery/icon vision analysis and brand-guide prose parsing |
| `DATA_DIR` | where screenshots and audit records are written |

**The product is fully functional with none of them.** The LLM is an enhancement
layer with a deterministic fallback on every call; no part of the Brand Score
depends on a model response.

```bash
npm test             # 31 unit tests over the deterministic core
npm run smoke        # full pipeline against a fixture site with known drift
npm run build        # production build
docker build -t brand-audit . && docker run -p 3000:3000 -v ba:/data brand-audit
```

`npm run smoke` is the fastest way to see whether an engine change helped or
hurt: the fixture's drift is documented in advance (`scripts/README.md`), so the
output can be checked against a known answer. Current output:

```
BRAND SCORE  75 / 100   Moderately consistent
Typography  68 · Colors  85 · Components  67 · Visual Style  86 · Accessibility  76
13 inconsistencies · 7 auto-fixable · 6 need review
preview: 75 → 93 (estimated after fixes)
```

## How it works

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the full engineering write-up.
The short version:

Everything the system observes becomes a **`Deviation`** — a dominant pattern, an
observed value, the share of the site that deviates, a confidence, and evidence.
The score is a pure function of deviations; the findings are a rendering of the
same deviations; the remediation CSS is a translation of them. The three can
never disagree with each other, and every finding carries its evidence by
construction.

```
discovery → capture → style extraction → brand policy → vision
          → deviations → scoring → findings → remediation → preview → QA
```

Choices worth knowing about:

* **Colours cluster in OKLab.** `#00B74F`, `#00B84F` and `#00B74E` are one
  brand colour that drifted, not three brand colours.
* **Frequency and confidence scale every penalty.** A treatment on 8% of
  elements is drift; one on 45% is a second design system the site chose on
  purpose, and is penalised far less. A gorgeous, deliberately eclectic site is
  not punished for being eclectic.
* **Repeated site chrome counts once.** One navigation CTA rendering on four
  pages is one design decision, not four votes.
* **No brand guide means no violations.** Without an explicit rule we only ever
  say a treatment *differs from the dominant pattern on this site*. Upload a PDF
  guide and the audit switches to compliance mode, where the guide's rule
  replaces the inferred majority and a contradiction is a real violation.
* **The projected score is measured, not claimed.** We re-render the page with
  the override sheet injected, re-harvest the DOM, and run the identical scoring
  code. "75 → 93" is the result of that measurement.
* **The preview only writes an allowlist of properties** (`font-family`,
  `font-weight`, `color`, `background-color`, `border-radius`, …) to selectors
  this system generated itself. Structure, copy, imagery and identity cannot
  change, and your live site is never touched.
* **Failures fail.** Bot protection, login walls, and pages that render too
  little all produce an explicit "we couldn't analyze enough of this site"
  rather than an invented score.

## API

```
POST /api/audits              { "url": "https://example.com" }  → { audit_id, status }
GET  /api/audits/:id          status while running, full result when complete
GET  /api/audits/:id/findings
GET  /api/audits/:id/preview
POST /api/leads               "Fix My Brand" intent capture
POST /api/events              funnel instrumentation
```

## Security

User-submitted URLs are treated as hostile input: protocol allowlist, DNS
resolution checked against loopback / private / link-local / CGNAT / IPv6-ULA /
cloud-metadata ranges, re-validated on every redirect hop inside the browser,
per-page and whole-crawl budgets, four pages maximum, same domain only,
`robots.txt` respected for discovered links, and no form is ever submitted.
Extracted page content is sanitized on the way in and only ever rendered as
text.

## What is deliberately not here

Payments, CMS/GitHub integrations, a licensing marketplace, accounts, scheduled
monitoring, outbound prospecting, a public developer API. Licensing exists as an
*interface* (`src/lib/licensing`) with a small open-font dataset behind it, so a
real rights resolver can drop in without touching findings or remediation.

Those come after the hypothesis is validated — not before.
