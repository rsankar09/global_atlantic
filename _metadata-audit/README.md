# PPM America — Site Metadata Audit & Bulk Metadata Plan

**Audited:** 2026-09-19
**Source audited:** `https://www.ppmamerica.com` (122 pages, all HTTP 200)
**Target:** EDS site for `rsankar09/global_atlantic`

## Why the source site was audited, not the EDS site

The EDS site has no published content yet. Every endpoint 404s:

| Endpoint | Status |
|---|---|
| `https://main--global_atlantic--rsankar09.aem.live/` | 404 |
| `.../query-index.json` | 404 |
| `.../sitemap.xml` | 404 |
| `.../metadata.json` | 404 |

`helix-query.yaml` and `helix-sitemap.yaml` are committed and correctly configured — there is simply no previewed/published content behind them yet. `fstab.yaml` still points at the boilerplate mount (`adobe-rnd/aem-boilerplate-xwalk/main`) rather than a PPM content source, which is the root cause.

So the audit was run against the **migration source** — the live PPM America site — using the URL list discovered in `capture/*/meta.json` (`internal_links`). This produces the metadata baseline that the EDS site will inherit at migration, and the bulk sheet below is what should be in place *before* content goes live.

---

## Summary statistics

| Metric | Result |
|---|---|
| Pages audited | 122 |
| Has `<title>` | 122 / 122 (100%) |
| Has meta description | 121 / 122 (99%) |
| Has `og:image` | **0 / 122 (0%)** |
| Has `og:title` / `og:description` | **0 / 122 (0%)** |
| Has `twitter:card` | **0 / 122 (0%)** |
| Has canonical | 122 / 122 (100%) |
| Has robots tag | 74 / 122 (61%) |
| Titles in the 50–60 char ideal range | **0 / 122 (0%)** |
| Descriptions in the 150–170 char range | 5 / 122 (4%) |
| Pages with a duplicated title | 29 |
| Pages with a duplicated description | 9 |

---

## Issues by severity

### Critical

**1. No Open Graph or Twitter Card tags anywhere on the site (122/122).**
Every link shared to LinkedIn — the company's only social channel, linked from all 122 pages — renders with no image and a scraped fallback. For an asset manager whose distribution is heavily LinkedIn-driven, this is the single highest-value fix.

*This is fixed entirely by bulk metadata.* The EDS pipeline auto-generates `og:title`, `og:description`, `og:url`, `og:image`, `og:image:secure_url`, `twitter:card`, `twitter:title`, `twitter:description`, and `twitter:image` from the `Title` / `Description` / `Image` metadata values. Setting `Image` in the bulk sheet is sufficient — do **not** hand-author `og:*` rows.

**2. `/` and `/home` are duplicates, and `/` canonicalises to `/home`.**
Identical title, identical 929-char description, and `/` declares `<link rel="canonical" href=".../home">`. The site's root is telling Google not to index itself. In EDS this must not be carried over: `/` is the index document and `/home` should not exist. Redirect `/home` → `/` at migration.

### High

**3. 70 of 122 descriptions exceed 170 characters** — body copy dumped into the description field rather than written for search. Worst offenders:

| Path | Length |
|---|---|
| `/news-and-insights/market-insights/2026/07/cio-letter` | 1061 |
| `/` and `/home` and `/our-story` | 929 |
| `/investment-solutions/collateralized-loan-obligations` | 874 |
| `/news-and-insights/market-insights/2025/12/2026-outlook` | 814 |

Google truncates around 155–160 characters, so most of this is wasted. **Not fixable by bulk metadata** — descriptions are per-page and must be rewritten in each source document during migration.

**4. 29 pages share a duplicate title.** The worst clusters are listing-style labels used as titles:

| Title | Pages |
|---|---|
| `Infographic` | 7 |
| `Quarterly Insights` | 5 |
| `Distribution Team` | 3 |
| `Pensions and Investments` / `Pensions And Investments` | 4 (also inconsistent casing) |
| `CIO Letter`, `EM Spotlight`, `Corporate Responsibility Report` | 2 each |
| `Chris Raub` | 2 (press release vs. team bio) |

**The fix is already written on every page: use the H1.** Every one of these pages has a specific, well-written H1 that is a far better title than its current `<title>`:

| Path | Current title | H1 → proposed title |
|---|---|---|
| `.../2024/04/infographics` | `Infographic` | Market, Economic Impacts of AI \| PPM America |
| `.../2024/10/infographics` | `Infographic` | Visualizing China's Economic Issues \| PPM America |
| `.../2025/04/quarterly-insights` | `Quarterly Insights` | Seeking (Bond) Shelter in a Tariff-ied World \| PPM America |
| `.../2026/07/cio-letter` | `CIO Letter` | An Argument for the Tight Spread, Elevated Yield Environment \| PPM America |
| `.../2024/01/distribution-team` | `Distribution Team` | PPM Continues Global Distribution Team Expansion \| PPM America |
| `.../2026/04/chris-raub` | `Chris Raub` | Chris Raub Named President and CEO of PPM America \| PPM America |

Apply the same H1-derived rule across all 29.

### Medium

**5. No title is in the 50–60 character ideal range; 81 of 122 are under 20 characters.**
Shortest: `CLO 6`, `CLO 7`, `CLO 8` (5 chars), `IG EMD` (6), `Social` (6), `Careers` (7). These give search engines almost nothing to match on.

**6. Brand suffix is applied to only 7 of 122 pages (6%).**
`| PPM America` appears on `/`, `/our-story`, `/investment-solutions`, `/news-and-insights` and its three children — nowhere else. 112 pages carry no brand token at all.

> **Important:** a brand suffix **cannot** be appended by bulk metadata. Bulk `Title` sets a default title for pages that have none; it cannot decorate an existing per-page title. Choose one of:
> - author the suffix into each page's Metadata table during migration (recommended — full author control), or
> - append it in `scripts.js` at render time (consistent, but invisible to the author and it will not appear in `og:title`, which the pipeline generates server-side).

**7. 48 of 122 pages have no robots meta tag.** Concentrated in `/our-story/our-team/**` (20 of 22), `/investment-solutions/fixed-income/**` (14 of 15), and all 5 privacy-policy pages. Absent = indexable by default, so nothing is currently deindexed by accident — but it is inconsistent and worth setting explicitly. Bulk metadata handles this in one row.

**8. Inconsistent robots values:** 70 pages use `index`, 4 use `index, follow`. Standardise on `index, follow`.

### Low

**9. `/social` has no description and a 6-character title (`Social`).** It appears to be a link-shim page. Recommend `noindex, follow`.

**10. 9 pages share a duplicate description**, including `/` + `/home` + `/our-story` (all three share the same 929-char block) and `/investment-solutions/fixed-income/core-fixed-income` + `core-plus-fixed-income` (two distinct products described identically — a genuine content problem, not just a metadata one).

---

## Deliverables in this folder

| File | Purpose |
|---|---|
| `metadata-bulk.csv` | Paste-ready bulk metadata sheet (see below) |
| `page-metadata-audit.csv` | All 122 pages with per-page title/description/robots/canonical and a per-page issue list |

---

## Bulk metadata spreadsheet

Paste-ready. Evaluated top-to-bottom, broad patterns first, specific overrides after.

| URL | Image | Image Alt | Robots | Template |
|---|---|---|---|---|
| `/**` | `/media/og-default.jpg` | PPM America — institutional asset manager | `index, follow` | |
| `/investment-solutions/**` | `/media/og-investment-solutions.jpg` | PPM America investment solutions | | `investment-solution` |
| `/news-and-insights/**` | `/media/og-news-and-insights.jpg` | PPM America news and insights | | |
| `/news-and-insights/market-insights/**` | `/media/og-market-insights.jpg` | PPM America market insights | | `insight` |
| `/news-and-insights/press-releases/**` | `/media/og-press-release.jpg` | PPM America press release | | `press-release` |
| `/news-and-insights/blog/**` | `/media/og-blog.jpg` | PPM America blog | | `blog-post` |
| `/our-story/our-team/**` | `/media/og-team.jpg` | PPM America team | | `team-bio` |
| `/our-commitments/**` | `/media/og-our-commitments.jpg` | PPM America commitments | | |
| `/privacy-policy/**` | `/media/og-default.jpg` | PPM America | | `legal` |
| `/terms-and-conditions` | `/media/og-default.jpg` | PPM America | | `legal` |
| `/social` | | | `noindex, follow` | |
| `/drafts/**` | | | `noindex, nofollow` | |

### Design notes

- **No `Title` or `Description` columns.** Every page has (or will have) its own title and description in its source document, and page-level always wins — bulk values would be dead weight. The real title/description work is per-page rewriting, covered in issues 3–6 above.
- **`Image` is the whole point of this sheet.** One row closes the 0% og:image gap for all 122 pages; the section rows give each content type a more relevant card image.
- **`Image Alt`** is set alongside each image so the social card and any fallback rendering have alt text.
- **`Template`** is included on the assumption the build will use template-driven section styling. If that is not the plan, delete the column — do not ship unused columns.
- **`/drafts/**`** is pre-emptive: the repo has a `drafts/` folder, and although `.hlxignore` excludes `drafts/*` from the code side, any drafts published through the content source would otherwise be indexable.
- The 12 rows deliberately do not enumerate pages. Per-page rows in a bulk sheet defeat its purpose.

### Images you must create

The sheet references 8 OG images that do not exist yet. Produce them at **1200×630** and place them under `/media/` in the content source:

`og-default.jpg`, `og-investment-solutions.jpg`, `og-news-and-insights.jpg`, `og-market-insights.jpg`, `og-press-release.jpg`, `og-blog.jpg`, `og-team.jpg`, `og-our-commitments.jpg`

Until they exist the rows will emit `og:image` pointing at 404s, which is worse than no tag — create the images, or trim the sheet to only `/**` with a single default image, before publishing.

---

## Implementation

### Google Drive

1. In the site's root content folder (alongside `nav` and `footer`), create a Google Sheet named **`metadata`**.
2. Paste the table above into the first sheet, header row first.
3. Open AEM Sidekick on the sheet → **Preview** → **Publish**.

### SharePoint

1. In the site's root content folder, create **`metadata.xlsx`**.
2. Paste the table into `Sheet1`, header row first, and save.
3. Open AEM Sidekick on the file → **Preview** → **Publish**.

### Verification

```bash
# 1. Confirm the rules are live
curl -s "https://main--global_atlantic--rsankar09.aem.live/metadata.json" | jq '.data'

# 2. Confirm tags render on a page
curl -s "https://main--global_atlantic--rsankar09.aem.live/news-and-insights/market-insights" \
  | grep -iE '<meta (property|name)="(og:|twitter:|robots)'
```

Expect `og:image`, `og:image:secure_url`, `twitter:card: summary_large_image`, and `twitter:image` to appear automatically once `Image` is set.

---

## Recommended sequence

1. **Point `fstab.yaml` at the PPM content source.** Nothing else can be verified until the query index returns pages.
2. **Publish the bulk metadata sheet** (create the 8 OG images first, or ship the `/**` row alone). Closes the 122-page og:image gap in one step.
3. **Rewrite the 29 duplicate titles from their H1s** during content migration, with the `| PPM America` suffix.
4. **Rewrite the 70 over-length descriptions** to 150–160 characters.
5. **Redirect `/home` → `/`** and drop the self-defeating canonical.
6. **Re-run this audit against the EDS query index** once content is live, to confirm the source-site issues did not migrate.
