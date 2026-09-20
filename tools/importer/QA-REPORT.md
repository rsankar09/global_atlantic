# Import transform — QA report

Transform: `tools/importer/import.js`
Harness: `node tools/importer/run.mjs` (real `@adobe/helix-importer`), then
`node tools/importer/qa.mjs` (structural) and `node tools/importer/shoot.mjs` (visual).
Date: 2026-09-19

## Verdict

**Approved for the homepage template only. Not ready for a bulk site import.**

The transform is complete, structurally correct and visually faithful for
`www.ppmamerica.com/` (the one page it was written against). Run against the
other 13 captured pages it silently drops 38–98% of their content, because
those pages are built from components that have neither a block nor a
transform yet.

---

## 1. Homepage — PASS

`capture/www-ppmamerica-com` → `/index`

### Structural QA (the decisive check)

Cells map to model properties by **position**, so a wrong cell count or order
lands content in the wrong field while the page still renders correctly.
Every emitted block was reduced to a block/row/cell skeleton and compared
against the authored fixture `drafts/ppm-home.html`:

| Block | Skeleton | Result |
|---|---|---|
| `hero` | `[img] [h1]` | OK |
| `columns columns-33-66` | `[h2 \| p]` | OK |
| `stats` | `[p \| p]` × 4 | OK |
| `stats small` | `[p \| p]` × 4 | OK |
| `cards square plain` | `[img \| p+h3 \| a]` × 3 | OK |
| `columns flush` | `[img \| p+ul+p]` | OK |

All 6 fixture blocks match. Beyond the blocks, the imported document now also
matches the fixture **section-for-section**, including default content and all
four `Section Metadata` tables (only pretty-printing whitespace differs).

Cell counts are additionally asserted at import time against the model files
(`CONTRACT` in `import.js`), so a model change that is not mirrored in the
transform throws rather than shifting content silently.

Contracts verified against the models by hand:

- `_hero.json` — `image` (+`imageAlt`, collapses), `text` → **2 rows × 1 cell**
  (simple block). Correctly *not* one row of two columns.
- `_stats.json` — `stat`: `figure`, `label` → **1 row per stat × 2 cells**;
  `classes` is a block-level field and correctly rides in the block name.
- `_cards.json` — `card`: `image` (+`imageAlt`), `text`, `link` → **3 cells**;
  the trailing link cell is emitted even when unlinked.
- `_columns.json` — templated `columns="2"`, `rows="1"` → **1 row × 2 cells**.

### Visual QA

Rendered through the local dev server at 375 / 768 / 1440 and compared to
`capture/www-ppmamerica-com/screenshots/`:

```
render-www-ppmamerica-com @375   h=5676px  broken-img=0  js-err=0
render-www-ppmamerica-com @768   h=4046px  broken-img=0  js-err=0
render-www-ppmamerica-com @1440  h=2529px  broken-img=0  js-err=0
```

All components present, in the right order, with the right content: hero,
intro 33/66, both teal stat rows (large + small, separator, beside-heading),
3-up insights cards, the 50/50 promo with its bullets and CTA, and the
footnote disclaimer. No dropped content, no broken links or images.

### Open issues found (not transform defects)

1. **Hero heading is unreadable — block CSS gap.** `hero.css` sets
   `.hero h1 { color: var(--background-color) }`, painting a reversed white H1
   straight onto the photo. PPM's design puts the heading in a solid white
   panel with dark serif text and a teal rule, so at 1440 the first line
   ("Focused on performance.") is invisible against the bright part of the
   image. The transform emits the correct `[img] [h1]` structure — this is a
   `hero.css` gap. Note the mapping recorded cmp-002 as `reuse`, score 0.92,
   **`gaps: []`**; that judgment was wrong and should be corrected to `extend`.
2. **Typography drift** — card titles render title-case/sans where the source
   is uppercase, and "Our Insights" is sans where the source is serif. Block
   CSS, not the transform.
3. **5/5 images have empty `alt`.** Carried across verbatim from the source
   (never synthesised). Needs an authoring pass before go-live.

---

## 2. The other 13 pages — FAIL (do not bulk import)

All 13 report `PASS` from `run.mjs`, but that only means *no exception was
thrown*. Measuring the source page's unique content terms against the imported
markdown:

| Coverage | Dropped | Page |
|---:|---:|---|
| 2% | 123 | `/our-story/contact-us` |
| 10% | 181 | `/our-story/careers` |
| 15% | 120 | `/our-story/our-team` |
| 20% | 123 | `/news-and-insights` |
| 24% | 84 | `/investment-solutions/fixed-income` |
| 24% | 176 | `/our-commitments/responsible-investment` |
| 24% | 104 | `/privacy-policy` |
| 27% | 149 | `/investment-solutions` |
| 37% | 239 | `/investment-solutions/private-equity` |
| 45% | 167 | `/our-story` |
| 46% | 110 | `/news-and-insights/press-releases` |
| 52% | 87 | `/news-and-insights/market-insights/2026/07/cio-letter` |
| 62% | 96 | `/news-and-insights/market-insights` |

Two failure modes, the second more dangerous than the first:

- **Empty pages.** `/our-story/contact-us` emits *nothing but a Metadata
  table* — a bulk import would create a blank page.
- **Plausible but unreviewed pages.** `/our-story` emits a well-formed
  `Columns (columns-33-66)` and a 5-row `Cards (square, plain)` because the
  homepage selectors happen to match, while its `herotitle`, `breadcrumb` and
  `disclosureagreement` content is dropped without a trace. This output looks
  correct on inspection and is not.

### Root cause: 10 of 18 mapped components have no transform

| Component | Pages | Verdict | Transform |
|---|---:|---|---|
| `intro-text-columns` | 16 | extend | yes |
| `ppm-header-nav` | 14 | extend | yes (fragment) |
| `ppm-footer` | 14 | extend | yes (fragment) |
| **`breadcrumb`** | **13** | new | **NONE** |
| **`herotitle`** | **13** | extend | **NONE** |
| **`disclosureagreement`** | **13** | new | **NONE** |
| `staticcard` | 8 | extend | yes |
| `staticcard-left` | 8 | extend | yes |
| **`biocard`** | **6** | extend | **NONE** |
| `numbertext` | 3 | new | yes |
| **`link-list`** | 2 | reuse | **NONE** |
| **`dynamic-card-list`** | 2 | new | **NONE** |
| `hero` | 1 | reuse | yes |
| **`assetclass-list`** | 1 | extend | **NONE** |
| **`article-body`** | 1 | reuse | **NONE** |
| **`report-links`** | 1 | extend | **NONE** |
| **`text-logo`** | 1 | reuse | **NONE** |
| **`staticcard-right`** | 1 | extend | **NONE** |

Three of the missing components (`breadcrumb`, `herotitle`,
`disclosureagreement`) appear on 13 of 14 pages. None of the 10 has a block in
`blocks/`, so a transform cannot be written for them yet — the block contract
is `eds-block-authoring`'s output and it does not exist.

### Blocking process issue

**No mapping is approved.** All 14 `capture/*/mapping.json` files carry
`"approved": false` on every entry (0 approved / 120 pending), and 5 entries
are flagged `needs_review` with unresolved `open_decision` questions — for
example whether the teal band is one `stats` block or two. This step's input
is meant to be an *approved* mapping.

---

## Fixes applied this pass

1. **`import.js` — disclaimer section lost its `light` style.** The trailing
   footnote section was appended without a `Section Metadata` table, so it
   rendered unthemed instead of continuing the light band. Now emits
   `style: light`, matching the fixture.
2. **`import.js` — the two `columns` transforms emitted cells unchecked.**
   `hero`, `stat` and `card` asserted their cell counts against the model;
   `columns` did not. Added a `columns` contract and assertions to both, so all
   four block transforms now fail loudly on a model drift.
3. **`run.mjs` — harness could not run across captures.** Directory discovery
   denylisted only `verify`, so it crashed on `capture/_detect` once the
   pipeline added `_detect`, `_map` and `assemble`. Now selects directories
   that actually contain a `dom.json`, which cannot fall behind.

## Recommended next steps

1. Get the mappings reviewed and approved, resolving the `needs_review`
   entries — the homepage's `stats` split decision and the cmp-002 hero
   `gaps: []` error above.
2. Correct cmp-002 hero to `extend` and close the white-panel gap in
   `hero.css`.
3. Author blocks for the 10 unmapped components, starting with `herotitle`,
   `breadcrumb` and `disclosureagreement` (13 pages each).
4. Extend this transform per template, re-running `run.mjs` + `qa.mjs` against
   a fixture for each new template.
5. Only then hand off to `eds-author-upload` — and re-run `npm run build:json`
   first if any block model changed, since the importer derives cell structure
   from the aggregate.
