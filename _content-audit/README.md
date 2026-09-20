# PPM Home — EDS Content Audit

**Audited:** 2026-09-19
**Target:** `http://localhost:3000/drafts/ppm-home` (local dev server, `--html-folder drafts`)
**Fixtures:** `drafts/ppm-home.html`, `drafts/ppm-nav.plain.html`, `drafts/ppm-footer.plain.html`
**Code under audit:** `blocks/{hero,columns,stats,cards,header,footer}/`, `scripts/scripts.js`, `styles/`, `head.html`

## Why the local build was audited

Same reason as `_metadata-audit/` and `_a11y-audit/`: every published endpoint 404s.

| Endpoint | Status |
|---|---|
| `https://main--global_atlantic--rsankar09.aem.page/` | 404 |
| `https://main--global_atlantic--rsankar09.aem.live/` | 404 |
| `.../query-index.json` | 404 |

`fstab.yaml` still mounts the boilerplate (`adobe-rnd/aem-boilerplate-xwalk/main`), so there is no PPM content behind the pipeline. The local dev server runs the real block code against the assembled fixtures — the closest available proxy for what ships.

**Scope limits this creates:**
- No `.plain.html` variant exists (the fixture is a complete `.html` document, not pipeline output), so the authored-content layer was read from the fixture source directly.
- No `<link rel="canonical">` is emitted locally. The EDS pipeline injects canonical on `.aem.page`/`.aem.live`; it could not be verified here.
- Byte sizes are local-server sizes. The dev server does **not** run the image optimizer — a request for `?width=750&format=webply&optimize=medium` returns the original file unchanged. Production numbers will be lower. Where that matters, both figures are given below.

## Method

- Headless Chromium render at 1440×900, post-`networkidle`, capturing the decorated DOM, every image's resolved attributes, the LCP entry, and all 36 network responses.
- Live HTTP status check of all 27 distinct link targets against `https://www.ppmamerica.com`.
- Reference comparison of `<picture>` markup against real EDS pipeline output (`www.aem.live`, `main--aem-boilerplate--adobe.aem.live`).
- Static read of `head.html`, `scripts/scripts.js`, `styles/*.css`, and each block's JS/CSS.

Accessibility findings are **not re-derived here** — `_a11y-audit/README.md` already covers them with axe-core, keyboard traversal and pixel-level contrast sampling. The three criticals from that audit are carried into the table below for priority ordering only, marked *(carried)*.

---

## Findings

| # | P | Category | Issue | Location | Fix | Impact |
|---|---|---|---|---|---|---|
| 1 | **P0** | Accessibility *(carried)* | White H1 over an unscrimmed photo — worst case **1.00:1**, 62.6% of the area behind the heading below 3:1 at 1440px | `blocks/hero/hero.css` | Add the measured flat-55% `::after` scrim — `_a11y-audit/README.md` §Code fixes | WCAG 1.4.3 failure, blocks launch |
| 2 | **P0** | Performance | Page ships **1.21 MB of images across 36 requests** (91% of 1.33 MB total). Pre-LCP critical path is **~246 KB** (~130 KB excluding fonts) against the EDS **100 KB budget** | whole page | Items 3–6 below are the constituent causes | LCP budget blown ~2.4×; every image competes with the LCP image for bandwidth |
| 3 | **P0** | Performance | **Card images download twice** — the raw `card-N.jpeg` *and* the `?width=750&format=webply` variant `cards.js` builds. 424 KB wasted. The fixture authors bare `<img src="./media/card-1.jpeg">`, so the browser starts the original at parse time, before `cards.js` runs | `drafts/ppm-home.html:133,145,157` | Author fixture images in real EDS pipeline markup (see *Fixture fidelity* below) | 424 KB of pure waste, all of it racing the LCP image |
| 4 | **P0** | Performance | `promo.jpeg` — **213 KB, loads eagerly**, and sits in section 6 of 7, far below the fold. No `loading` attribute in the fixture and `columns.js` never touches images | `drafts/ppm-home.html:173` | Same fixture fix; production pipeline supplies `loading="lazy"` | Largest single asset on the page, downloaded before anything the user can see |
| 5 | **P1** | Performance | LCP image has **no `fetchpriority="high"`**. `waitForFirstImage()` in `aem.js` flips it to `loading="eager"` (verified) but nothing raises its priority — **this one is real in production**, not a fixture artifact | `blocks/hero/hero.js` (currently 0 bytes) | Give `hero.js` a `decorate()` that sets `fetchpriority="high"` on the first `img` | LCP starts in the default priority queue behind the fonts |
| 6 | **P1** | Performance | Hero image has **no responsive variants** — single 80.7 KB JPEG, no `<source>`, no `srcset`. Intrinsic size is 1280×363 but it renders at **1440×380**, so it is upscaled on desktop and worse at 2× DPR. Declared `width="1757" height="499"` also disagrees with the real intrinsic size (aspect ratio matches, so no CLS) | `drafts/ppm-home.html:50` | Run the hero image through `createOptimizedPicture(src, alt, true, [{width:'2000'},{width:'750'}])` in `hero.js`; correct the declared dimensions | Blurry hero on desktop; no mobile size saving |
| 7 | **P1** | Performance | The PPM logo is a **44 KB, 1108×167 PNG rendered at 270×41** in the header and 212×32 in the footer — roughly 4× oversized, no lazy attribute, and it is the only asset the header needs | `drafts/ppm-nav.plain.html:20`, `drafts/ppm-footer.plain.html:18` | Replace with an SVG, or a PNG sized to 540×82 (2× the largest render) | ~40 KB recoverable on every page of the site |
| 8 | **P1** | SEO / Social | **Zero Open Graph or Twitter tags** — no `og:title`, `og:description`, `og:image`, `twitter:card`, and no `image` page metadata | `drafts/ppm-home.html` head | The plan already exists — deploy `_metadata-audit/metadata-bulk.csv` as `metadata.json` and add per-page `image` metadata | Every share of the homepage renders as a bare link. Matches the 0/122 finding in `_metadata-audit/` |
| 9 | **P1** | Accessibility *(carried)* | No skip link — 21 tab stops before the first card | `blocks/header/header.js` | `_a11y-audit/README.md` §Code fixes | WCAG 2.4.1 |
| 10 | **P1** | Accessibility *(carried)* | `aria-expanded` on `<nav>` not the hamburger button; permanently-stale `aria-expanded` on the four `li.nav-drop` | `blocks/header/header.js` | `_a11y-audit/README.md` §Code fixes | WCAG 4.1.2 |
| 11 | **P2** | Performance | `roboto-medium.woff2` is **64.7 KB** — 6× `roboto-regular.woff2` (11.0 KB) for the identical `unicode-range`. It is not subset. All four faces (116 KB) load in the **eager** phase on desktop, since `loadEager()` calls `loadFonts()` at `innerWidth >= 900` | `fonts/roboto-medium.woff2`, `styles/fonts.css` | Re-subset to the declared `unicode-range` — should land near 11 KB | ~54 KB off the critical path. Weight 500 is used 7× so the face itself is needed |
| 12 | **P2** | Content structure | `Our Insights` is an **H3** while the three card titles beneath it are **also H3**, so the cards sit as siblings of their own section heading. The page's two other section headings are H2 | `drafts/ppm-home.html:129` | Change to **Heading 2** | WCAG 1.3.1 and a broken outline for AI/LLM extraction. Also `_a11y-audit/` #6 |
| 13 | **P2** | Content quality | Literal ALL-CAPS in four text runs where no CSS `text-transform` supplies it: two headings, the promo eyebrow, the promo CTA. The fixture's own header comment flags this as temporary | `drafts/ppm-home.html:64,102,176,185` | Re-author in sentence case; add `text-transform: uppercase` in CSS where the caps look is wanted | Inconsistent with the cards/stats contract; screen readers may spell out short runs |
| 14 | **P2** | SEO | The logo links to **`/home`**, not `/` | `ppm-nav.plain.html:20`, `ppm-footer.plain.html:18` | Point at `/` | On EDS `/home` and `/` are two indexable pages with identical content. Live on the source site today (both 200) |
| 15 | **P2** | SEO | `<title>` is **41 chars** (ideal 50–60); description is **140** (ideal 150–160) and is a generic mission statement shared by **3 source pages** | head metadata | e.g. `PPM America — Institutional Asset Manager \| $101B AUM` and a description naming the asset classes | Under-uses SERP real estate; duplicate descriptions dilute |
| 16 | **P2** | SEO | Canonical could not be verified — none emitted locally | — | Confirm `<link rel="canonical">` on `.aem.page` once content is mounted | Pipeline normally handles this; verify, don't assume |
| 17 | **P2** | David's Model | The `OUR STORY` CTA uses a **relative** href (`/our-story`), as do all nav and footer links | fixture + fragments | Acceptable inside EDS; confirm the authored documents use fully-qualified URLs where the model calls for them | Relative URLs break when content is syndicated or fragment-embedded |
| 18 | **P2** | Accessibility *(carried)* | `promo.jpeg` carries `alt=""` but sits beside "Our advantage" and carries meaning | `drafts/ppm-home.html:173` | Author real alt text — `_a11y-audit/` #2 suggests wording | WCAG 1.1.1 |
| 19 | **P3** | SEO | **No JSON-LD.** An asset manager homepage is a textbook `Organization` / `FinancialService` case — address, phone and parent company are all already on the page | head | Emit `Organization` with `name`, `url`, `logo`, `address` (225 W Wacker Dr, Suite 1200, Chicago IL 60606), `telephone`, `parentOrganization: Jackson Financial Inc.`, `sameAs: [LinkedIn]` | Knowledge-panel eligibility; strong AI-search signal |
| 20 | **P3** | Content structure | The `¹` in "Billion in AUM¹" has no programmatic link to the disclaimer seven sections below | `drafts/ppm-home.html:79` | Link the marker to the disclaimer paragraph | Announced as a bare "1". Also `_a11y-audit/` #7 |
| 21 | **P3** | Code hygiene | `blocks/hero/hero.js` is a **0-byte file**. It still costs a module fetch | `blocks/hero/hero.js` | Either delete it, or fill it with the fix from #5 and #6 — #5 is the reason to keep it | One wasted request in the eager phase |
| 22 | **P3** | CSS | `font-weight: 600` is used once but no `@font-face` declares Roboto 600 — the browser synthesises or snaps to 700 | `blocks/*/*.css` | Use 500 or 700 | Inconsistent rendering |

---

## Confirmed correct — do not "fix" these

- **Zero broken links.** All 27 distinct targets across nav, cards, promo and footer return **200** on `https://www.ppmamerica.com`. No link rot to clean up before migration.
- **Card images are already fully optimized by `cards.js`** — `webply`, `srcset`, `loading="lazy"`, intrinsic dimensions preserved. The double-download in #3 is the fixture's authored markup, not this block.
- **Section and block modelling is genuinely good.** Seven sections, six block instances, one pure default-content section. `stats` is reused with two variants rather than forked into a second block. Section 4 pairs a default-content heading with a block under `split-33-66` — exactly the intended pattern. **No nested blocks.** No block exceeds 3 columns. No raw HTML/CSS/JSON in the content.
- **The button pattern is correct.** `OUR STORY` is `<strong><em><a>>` → `.button.accent`, which is what `decorateButtons()` in `scripts.js` expects.
- **Fallback fonts use `size-adjust`** (88.82% / 99.529%) — the main CLS trap is already handled.
- **`head.html` is clean** — CSP, viewport, the two boilerplate modules, one stylesheet. No inline styles, no inline scripts, no font preloads.
- **Theming runs entirely on CSS custom properties.** No hardcoded colours or spacing in the block CSS.
- **`lang="en"`, unique H1, and all four landmarks** (`header`/`nav`/`main`/`footer`) present.
- **E-L-D phase structure is intact** — `delayed.js` is empty, so no third-party script loads before LCP. Nothing to fix; just don't regress it when analytics lands.

---

## Fixture fidelity — the root cause behind #3, #4 and #6

Real EDS pipeline output for an image looks like this (verified against `www.aem.live` and `main--aem-boilerplate--adobe.aem.live`):

```html
<picture>
  <source type="image/webp" srcset="./media_1645e7a9.png?width=2000&format=webply&optimize=medium" media="(min-width: 600px)">
  <source type="image/webp" srcset="./media_1645e7a9.png?width=750&format=webply&optimize=medium">
  <source type="image/png"  srcset="./media_1645e7a9.png?width=2000&format=png&optimize=medium" media="(min-width: 600px)">
  <img loading="lazy" alt="" src="./media_1645e7a9.png?width=750&format=png&optimize=medium" width="1500" height="804">
</picture>
```

`drafts/ppm-home.html` authors this instead:

```html
<picture><img src="./media/card-1.jpeg" alt="" width="477" height="477"></picture>
```

Three things follow from that gap, and they are worth separating because **only one of them is a production bug**:

| Symptom | Production-real? |
|---|---|
| #3 card double-download | **No** — in production the raw `src` already carries `?width=750&format=webply`, so `createOptimizedPicture` regenerates an identical URL and the browser serves it from cache. Fixture-only. |
| #4 eager 213 KB promo | **No** — the pipeline stamps `loading="lazy"` on every image. Fixture-only. |
| #6 hero has no responsive variants and no `fetchpriority` | **Yes.** The pipeline gives the hero a `srcset`, but neither `hero.js` (empty) nor `columns.js` calls `createOptimizedPicture`, and nothing anywhere sets `fetchpriority="high"`. |

So the fixture is overstating the problem — but it is also **hiding #5/#6 behind noise**, and it makes every local Lighthouse number meaningless. Bringing `drafts/media` references up to pipeline markup is worth doing for measurement fidelity alone, independent of the perf wins.

---

## Executive summary

The content model underneath this page is the strong part: clean section/block separation, a reused `stats` block instead of a forked one, no nested blocks, correct button markup, `size-adjust` fallback fonts, a clean `head.html`, and 27 out of 27 links resolving. That is a better starting position than most migrations.

What is not ready is everything around it. The page is **~2.4× over the EDS LCP budget** with 1.21 MB of images, 424 KB of which is a literal duplicate download; it ships **no social metadata at all**, consistent with the 0/122 og:image finding already on record; and it still carries an unresolved **1.00:1 contrast failure** on the hero H1. None of these are hard problems — the metadata plan is already written in `_metadata-audit/metadata-bulk.csv` and the scrim is already measured in `_a11y-audit/` — but none are done.

## Top 3 fixes

**1. Give `blocks/hero/hero.js` a body (P0/P1, ~15 min).** It is currently 0 bytes, which is why the LCP image has no `fetchpriority` and no responsive variants. This is the only perf item on the list that is real in production rather than a fixture artifact:

```js
import { createOptimizedPicture } from '../../scripts/aem.js';

export default function decorate(block) {
  const img = block.querySelector('picture > img');
  if (!img) return;
  const pic = createOptimizedPicture(img.src, img.alt, true, [{ width: '2000' }, { width: '750' }]);
  const optimized = pic.querySelector('img');
  optimized.setAttribute('fetchpriority', 'high');
  img.closest('picture').replaceWith(pic);
}
```

Then correct `width="1757" height="499"` on the fixture image to its real 1280×363, and re-export the hero at 2560px wide so it is not upscaled at 1440.

**2. Bring the fixture's image markup up to pipeline parity (P0, ~30 min).** Rewrite the six `<img>` tags in `drafts/ppm-home.html`, `ppm-nav.plain.html` and `ppm-footer.plain.html` as full `<picture>` blocks with `<source>` variants and `loading="lazy"` on everything except the hero, using the shape shown above. This deletes the 424 KB double-download and the 213 KB eager promo load in one pass, and — more importantly — makes local Lighthouse runs mean something. While in there, re-export `ppm-logo.png` at 540×82 or convert it to SVG.

**3. Land the social metadata that is already planned (P1, ~20 min).** `_metadata-audit/metadata-bulk.csv` already specifies `/media/og-default.jpg` for `/**`. Two steps: publish that sheet as `metadata.json` so the `image` property applies site-wide, and add `og:title` / `og:description` / `twitter:card` emission. Note the sheet's last row sets `/drafts/** → noindex, nofollow`, which correctly covers this very page — confirm that rule survives to production so the fixtures never get indexed.

Fixes 1 and 2 together take the pre-LCP critical path from ~246 KB to roughly **85 KB**, inside the budget. Adding the `roboto-medium` re-subset (#11) brings it to ~31 KB.

## Score

**C (68%) — needs work before launch.**

Structure and content modelling audit at an A. Performance and metadata audit at a D, and one unresolved WCAG critical carries over from `_a11y-audit/`. The gap is almost entirely execution on plans that already exist in this repo rather than anything that needs redesigning — the three fixes above close most of it.
