# Brand Audit — V0 Engineering Deliverable

> The hypothesis under test: **a user pastes a URL, gets an understandable Brand Score and
> concrete findings, and cares enough to open a visually improved version of their site.**
> Every decision below is judged by: *does this make URL → compelling improved preview
> faster, clearer, or more trustworthy?*

---

## 1. Proposed system architecture

One Next.js application, one container, logical modules — not microservices.

```
                 Browser (Next.js App Router, React, Tailwind)
                       │  POST /api/audits        GET /api/audits/:id (poll)
                       ▼
        ┌──────────────────────────────────────────────┐
        │ API routes (thin: validate, enqueue, read)   │
        └───────────────┬──────────────────────────────┘
                        │ enqueue
        ┌───────────────▼──────────────────────────────┐
        │ JobQueue (in-process, concurrency-limited)   │  ← interface; swap for
        └───────────────┬──────────────────────────────┘    Redis/SQS later
                        │ runAudit(auditId)
        ┌───────────────▼──────────────────────────────┐
        │ PIPELINE (src/lib/engine/*)                  │
        │  discovery → capture → style-extraction →    │
        │  brand-policy → vision → deviations →        │
        │  scoring → findings → remediation →          │
        │  preview → qa(rescore)                       │
        └───┬──────────────┬─────────────┬─────────────┘
            │              │             │
        Store          Storage         LLM
      (audits,       (screenshots)   (provider
       findings)                      abstraction)
       file | pg      local | s3      anthropic | none
```

**The load-bearing idea: one source of truth called a `Deviation`.**
Every module that observes something off-pattern emits a `Deviation`
(category, dominant pattern, observed value, share of population, confidence,
evidence, selector). The scoring engine is a pure function of deviations.
The findings list is a *grouping and rendering* of the same deviations. The
remediation engine consumes deviations to emit CSS. QA re-runs the identical
deviation + scoring code against the previewed DOM.

Consequences: the score can never disagree with the findings; every finding
has evidence by construction (§3E explainability); the projected score is
**measured**, not asserted (§13).

**Trust boundaries.** The user's URL is hostile input. It is resolved and
filtered (SSRF) before a browser ever sees it, and all page evaluation happens
inside the Chromium sandbox. Nothing extracted from a page is ever `eval`'d,
rendered as HTML, or executed server-side; extracted text is length-capped and
sanitized on the way into the store.

## 2. Repository / file structure

```
brand-audit/
├─ docs/ARCHITECTURE.md          this document
├─ db/schema.sql                 Postgres DDL (optional driver)
├─ scripts/smoke.ts              headless end-to-end run against a fixture site
├─ tests/                        node:test unit tests for the deterministic core
└─ src/
   ├─ app/
   │  ├─ page.tsx                landing: headline, URL input, optional guide
   │  ├─ a/[id]/page.tsx         progress + results (one URL, no flash)
   │  ├─ api/audits/route.ts             POST create
   │  ├─ api/audits/[id]/route.ts        GET status/result
   │  ├─ api/audits/[id]/findings/route.ts
   │  ├─ api/audits/[id]/preview/route.ts
   │  ├─ api/leads/route.ts              Fix My Brand → email capture
   │  ├─ api/events/route.ts             analytics sink
   │  └─ api/files/[...path]/route.ts    screenshot serving (local driver)
   ├─ components/                score ring, breakdown, finding cards, slider
   └─ lib/
      ├─ types.ts                data model (§21) + engine types
      ├─ config.ts               limits, weights, env
      ├─ security/url.ts         SSRF guard, protocol/redirect/IP policy
      ├─ store/                  index | file-store | pg-store   (interface)
      ├─ storage/                index | local | (s3 interface)
      ├─ llm/                    index | anthropic | none        (interface)
      ├─ queue/                  in-process job queue
      ├─ licensing/              Rights Resolver *interface* + open-font data
      └─ engine/
         ├─ browser.ts           Chromium lifecycle, hardened context
         ├─ discovery.ts         crawl, internal links, page selection
         ├─ capture.ts           in-page style/DOM harvest + screenshots
         ├─ color.ts             parsing, OKLab distance, clustering, contrast
         ├─ style-profile.ts     SiteStyleProfile assembly, role inference
         ├─ deviations.ts        ← the single source of truth
         ├─ scoring.ts           category + overall score (pure)
         ├─ findings.ts          deviations → user-facing findings
         ├─ brand-policy.ts      PDF guide → BrandRules (compliance mode)
         ├─ vision.ts            optional LLM imagery/icon characterization
         ├─ remediation.ts       canonical tokens → CSS overrides
         ├─ preview.ts           re-render with overrides, screenshot
         └─ pipeline.ts          orchestration + progress events
```

## 3. Database schema

Entities exactly as specified in §21 (`Audit`, `AuditPage`, `StyleToken`,
`BrandRule`, `Finding`, `Preview`, `Lead`, plus `Event` for §27 analytics).

Two interchangeable drivers behind one `Store` interface:

| Driver | When | Why |
| --- | --- | --- |
| `file` (default) | no `DATABASE_URL` | zero-config; the V0 container is already stateful because Playwright needs one. Boots with no external services. |
| `postgres` | `DATABASE_URL` set | production durability; `db/schema.sql` is the DDL, plain `pg`, no codegen step in the image. |

Choosing a thin typed SQL layer over an ORM is deliberate: the schema is nine
tables of mostly-JSON documents, and an ORM's codegen/engine download is real
build fragility for no modelling benefit at this size.

## 4. Crawler design

1. **Validate** — protocol allowlist (`http`/`https`), DNS resolve, reject
   loopback / private / link-local / CGNAT / IPv6-ULA / `169.254.169.254`
   metadata, reject non-default ports, cap redirects and re-check every hop.
2. **Load** — Chromium 1440×1000, fixed UA, `networkidle`-with-deadline, then a
   settle delay for SPA hydration. Hard per-page timeout; hard total budget.
3. **Discover** — collect same-registrable-domain internal links from the
   homepage, normalize, score them for *representativeness* (product/pricing/
   about/contact/blog signals, path depth, nav prominence), pick the top 3.
4. **Harvest** — one in-page script returns a normalized, compressed sample of
   the DOM: up to N elements per role with the computed properties in §7, plus
   images, SVG/icon shape, logo candidates, and page-level metadata. The raw
   DOM never leaves the browser.
5. **Capture** — full-page + viewport PNG per page.
6. **Behave** — same domain only, ≤4 pages, modest concurrency, polite delay,
   `robots.txt` respected for discovered links, never submits a form, never
   follows logout/auth/cart URLs.

## 5. Brand Score algorithm

Deterministic, reproducible, LLM-free.

```
For each category c:
  score_c = 100 − Σ penalty(d)  for deviations d in c      (clamped 0..100)
  penalty(d) = severityWeight(d) × minorityShare(d) × confidence(d) × categoryScale
BrandScore = Σ score_c × weight_c        (rounded)

weights: typography .25  colors .20  components .25  visual .15  a11y .15
         (+ compliance re-weighting when a brand guide is supplied)
```

Key properties:

* **Frequency-aware.** A treatment used by 8% of elements is drift; one used by
  45% is a legitimate second style and is penalized far less. `minorityShare`
  encodes this, so a deliberately eclectic site is not punished for being
  eclectic — only for being *accidentally* inconsistent (§32).
* **Confidence-scaled.** Subjective, vision-derived deviations carry ≤0.6
  confidence and therefore cannot materially move the score (§3F).
* **Near-duplicate colors** are the highest-signal deterministic finding: colors
  are clustered in OKLab; two colors under ΔE ≈ 0.03 are "the same intent,
  drifted", which is exactly the §8 `#00B74F / #00B84F / #00B74E` case.
* **Canonical > majority.** In compliance mode the brand guide's rule replaces
  the inferred dominant pattern, so a site can be consistently wrong (§10).

## 6. LLM vs deterministic responsibility matrix

| Concern | Owner | Rationale |
| --- | --- | --- |
| color parsing, OKLab distance, clustering, WCAG contrast | **code** | arithmetic |
| font/size/weight frequency, element counts, role inference by tag+size | **code** | arithmetic |
| deviation detection, all scoring, projected score | **code** | reproducibility |
| URL discovery, page selection, DOM parsing | **code** | deterministic |
| CSS override generation | **code** | must be safe & exact |
| imagery characterization (photo vs illustration, treatment) | **LLM (vision)** | genuinely perceptual |
| icon family / stroke-weight mixing (when CSS is insufficient) | **LLM (vision)** | perceptual |
| brand-guide prose → structured rules | **LLM** | language interpretation |
| finding headline/explanation phrasing | **LLM, optional** | polish only |
| grouping + prioritizing findings | **code first**, LLM may re-rank | must degrade gracefully |

**Hard rule: the product is fully functional with no API key.** The LLM is an
enhancement layer; every LLM call has a deterministic fallback, and no score
component depends on a model response.

## 7. Preview / remediation strategy

Option B + A, in that order, real DOM — never an AI-generated screenshot.

1. Remediation picks **canonical tokens** from the observed profile (dominant
   font per role, cluster-center colors, dominant button treatment/radius) or
   from the brand guide in compliance mode.
2. It emits a small, auditable CSS override sheet scoped to the *specific
   selectors that deviate* — typically 3 changes, ranked: typography
   normalization, CTA normalization, color correction (§14).
3. Preview re-opens the homepage in the browser, injects the sheet, re-screenshots.
   Structure, copy, imagery and identity are untouched by construction — the
   sheet only sets properties from a fixed allowlist (`font-family`, `font-weight`,
   `color`, `background-color`, `border-radius`, `border-color`, `padding`).
4. QA re-harvests the previewed DOM and runs the **same** deviation + scoring
   code. The "72 → 94" number is therefore a measurement of the preview, and is
   always labelled *Estimated after fixes*.

## 8. External services required

| Service | V0 | Notes |
| --- | --- | --- |
| Chromium (Playwright) | **required** | the only hard dependency; needs a container, not serverless |
| Postgres | optional | file store by default |
| Object storage (S3/R2) | optional | local disk by default, behind an interface |
| Anthropic (or any multimodal LLM) | optional | vision + guide parsing + phrasing |
| Email/CRM for leads | not in V0 | leads land in the store; export later |

## 9. Biggest technical risks

1. **Bot protection / WAF blocks the crawl** (Cloudflare, Akamai). Mitigation:
   honest UA, low rate, graceful *"we couldn't analyze enough of this site"*
   failure state rather than a fabricated score (§34). This is the #1 cause of
   a bad first impression.
2. **SPA never settles** → blank or half-rendered screenshots. Mitigation:
   deadline + settle delay + a content-sufficiency check that refuses to score
   a page with too little rendered text/elements.
3. **The preview is unconvincing.** If the "after" looks identical, the core
   hypothesis can't be tested. Mitigation: pick the 3 most *visually legible*
   changes, not the 3 highest-scoring ones, and highlight them explicitly.
4. **Score plausibility.** A score users find obviously wrong destroys trust
   faster than a slow audit. Mitigation: frequency+confidence weighting,
   neutral language, and evidence on every finding.
5. **Cost/latency creep** from over-using the LLM. Mitigation: the matrix above;
   vision runs on at most a handful of images.
6. **SSRF** — hostile URLs are the product's front door. Mitigation: §4 step 1,
   re-validated on every redirect hop.

## 10. Exact implementation sequence

Phase 1 URL input → browser → screenshots → page selection → style harvest →
        color/typography/component analysis.
Phase 2 deviations → scoring → findings → results UI + category scores.
Phase 3 vision analysis → optional PDF guide → consistency vs compliance.
Phase 4 remediation tokens → CSS overrides → homepage preview → before/after
        slider → QA-measured projected score.
Phase 5 analytics events → Fix My Brand → email capture → hardening (rate
        limits, failure states, retries).

Explicitly **not** in V0: payments, CMS/GitHub integrations, a licensing
marketplace, accounts, scheduled monitoring, outbound prospecting, a public API.
