# PPM Home — WCAG 2.1 AA Accessibility Audit

**Audited:** 2026-09-19
**Target:** `http://localhost:3000/drafts/ppm-home` (local dev server, `--html-folder drafts`)
**Fixtures:** `drafts/ppm-home.html`, `drafts/ppm-nav.plain.html`, `drafts/ppm-footer.plain.html`
**Code under audit:** `blocks/{hero,columns,stats,cards,header,footer}/`, `styles/styles.css`

## Why the local build was audited, not a published page

Every published endpoint 404s — same finding as `_metadata-audit/`:

| Endpoint | Status |
|---|---|
| `https://main--global_atlantic--rsankar09.aem.page/` | 404 |
| `https://main--global_atlantic--rsankar09.aem.live/` | 404 |
| `.../query-index.json`, `.../sitemap.xml` | 404 |

`fstab.yaml` still points at the boilerplate mount (`adobe-rnd/aem-boilerplate-xwalk/main`), so there is no PPM content behind the pipeline yet. The local dev server serves the real block code against the assembled `drafts/` fixtures, which is the closest available proxy for what will ship.

## Method

- **axe-core 4.x** (`wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice`) at 375px and 1440px — `tools/a11y/a11y-scan.mjs`
- **Keyboard tab-through** recording focus order, focus-ring presence and flyout state — `tools/a11y/a11y-keyboard.mjs`
- **Mobile menu flow** — open via Enter, Tab into menu, Escape to close — `tools/a11y/a11y-hamburger.mjs`
- **Pixel-level contrast sampling** behind the hero H1, and A/B measurement of candidate scrims — `tools/a11y/hero-scrim-test.mjs`

```bash
export CHROME_PATH="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
node tools/a11y/a11y-scan.mjs http://localhost:3000/drafts/ppm-home
node tools/a11y/a11y-keyboard.mjs http://localhost:3000/drafts/ppm-home 1440
node tools/a11y/a11y-hamburger.mjs
```

> **axe-core reports zero violations at both breakpoints** (35 rules passing on mobile, 34 on desktop). Every finding below is one automated tooling cannot see. Do not read a clean axe run as a pass.

---

## Findings

| # | WCAG | Severity | Element | Issue | Fix (Document) | Fix (Code) |
|---|---|---|---|---|---|---|
| 1 | 1.4.3 Contrast (Minimum) | **Critical** | `.hero h1` | White H1 over an unscrimmed photo. Worst case **1.00:1** (white on a white shirt). **41%** of the area behind the heading at 375px and **62.6%** at 1440px falls below even the relaxed 3:1 large-text minimum. | — | Add a scrim to `blocks/hero/hero.css` — see below |
| 2 | 1.1.1 Non-text Content | Major | `hero.jpeg`, `promo.jpeg` | Both carry `alt=""`. The promo image sits beside "Our advantage" and carries meaning; declaring it decorative hides it. Needs an author decision per image. | Set alt text in the image properties dialog | — |
| 3 | 2.4.1 Bypass Blocks | Major | Page | No skip link. A keyboard user passes **21 tab stops** (logo + 20 nav links + search) before reaching the first card. | — | Add skip link in `header.js` + `styles.css` |
| 4 | 4.1.2 Name, Role, Value | Major | `.nav-hamburger button` | `aria-expanded` is set on `<nav>`, not on the button that controls it. The button exposes **no state** — verified `aria-expanded: (absent)` both open and closed. Only `aria-label` changes, which is the wrong mechanism. | — | `blocks/header/header.js` |
| 5 | 4.1.2 Name, Role, Value | Major | `li.nav-drop` (×4) | `aria-expanded="false"` is permanent — `isDestination()` short-circuits the toggle for every item, since all four are links. Verified: with focus on "Investment Solutions" the flyout is `display: block` while the `<li>` still reports `aria-expanded="false"`. `aria-expanded` is also not valid on an implicit `listitem` role. | — | `blocks/header/header.js` |
| 6 | 1.3.1 Info and Relationships | Major | Heading outline | "Our Insights" is an **H3**, and the three card titles beneath it are **also H3**. The cards are children of that heading but sit as its siblings in the outline. | Change "Our Insights" to **Heading 2** | — |
| 7 | 1.3.1 Info and Relationships | Minor | `.stats-label sup` | "Billion in AUM¹" — the footnote marker has no programmatic link to the disclaimer at the foot of the page. Announced as a bare "1". | Link the `¹` to the disclaimer paragraph | — |
| 8 | 1.4.3 Contrast (Minimum) | Minor | `a.button.accent` | White on `--accent-color: #008578` = **4.54:1** against a 4.5:1 requirement at 18px/500. Passes by 0.04 — any darkening of the text or lightening of the token breaks it. | — | Darken `--accent-color` in `styles.css` |
| 9 | Best practice (no AA criterion) | Minor | 4 text runs | Literal ALL-CAPS in the source where the block CSS does not supply `text-transform`. Inconsistent with the cards/stats contract, where copy is authored in sentence case and CSS applies the casing. The fixture's own header comment flags this as temporary. | Re-author in sentence case | Add `text-transform: uppercase` where the caps look is wanted |

### Confirmed correct — do not "fix" these

- **Card images carry `alt=""` and that is right.** `cards.js` wraps the whole card in a single anchor whose accessible name is already "Emerging Markets Insights EM Private Credit: Another Arrow in the EM Quiver". Adding alt text would double-announce it.
- **The raw-URL link text in the fixture never reaches the DOM.** `cards.js` discards the anchor and keeps only its `href`.
- **Keyboard access to the desktop flyouts works.** The `:focus-within` approach is sound — tabbing to a top-level item opens its panel and the next Tab enters it. All 20 nav links are reachable.
- **The mobile menu is sound functionally** — Enter opens it, Tab moves into it, Escape closes it and returns focus to the hamburger, and `body` scroll is locked while open. Only the ARIA state (#4) is wrong.
- **Focus rings are present on every one of the 32 tab stops.** No `outline: none` anywhere in the codebase.
- **Contrast passes everywhere else measured** — body copy 18.58:1, dark band 8.74:1, footer 17.50:1, nav links 18.58:1.
- `lang="en"`, a descriptive `<title>`, and `header`/`nav`/`main`/`footer` landmarks are all present.

---

## Document fixes (content author)

Applied in the source document — Google Docs, Word, or da.live. In this repo they currently live in `drafts/ppm-home.html`.

**Hero section**
- Decide whether `hero.jpeg` is decorative. It sits behind the H1 and adds no information the heading does not carry — **recommend keeping `alt=""`**.

**"Our advantage" promo section**
- `promo.jpeg` needs real alt text. Suggested: **"Two PPM colleagues reviewing portfolio analysis together at a workstation"** — confirm against the actual image.
- Re-author `OUR ADVANTAGE` as **"Our advantage"**.
- Re-author the CTA `OUR STORY` as **"Our story"**.

**Statistics band**
- Link the `¹` in "Billion in AUM¹" to the disclaimer paragraph at the foot of the page, so the marker resolves for a screen-reader user.

**Headings**
- `OUR INVESTMENT PROFESSIONALS:` → **"Our investment professionals"** (drop the trailing colon; it is announced).
- `EVERYTHING WE DO COMES BACK TO OUR CLIENTS` → **"Everything we do comes back to our clients"**.
- `Our Insights` → change from **Heading 3 to Heading 2**. This is the one that matters structurally: it makes the three card H3s nest beneath it instead of sitting alongside it.

---

## Code fixes (developer)

### `blocks/hero/hero.css` — Critical

`.hero h1` is `color: var(--background-color)` over a photo with no scrim, no overlay and no text-shadow. Contrast is entirely at the mercy of whichever image an author drops in.

Five candidate scrims were measured against the real image at both breakpoints with `tools/a11y/hero-scrim-test.mjs`. **Only a flat 55% black scrim clears 4.5:1 everywhere:**

| Scrim | 375px worst | 375px below 4.5 | 1440px worst | 1440px below 4.5 |
|---|---|---|---|---|
| none (current) | 1.00:1 | 53.5% | 1.00:1 | 69.5% |
| `linear-gradient(90deg, 65% → transparent)` | 1.24:1 | 20.0% | 1.38:1 | **37.7%** |
| `linear-gradient(180deg, 30% → 70%)` | 2.68:1 | 5.1% | 2.68:1 | **51.9%** |
| flat 50% black | 3.95:1 | 8.1% | 3.95:1 | **42.9%** |
| **flat 55% black** | **4.74:1** | **0.0%** | **4.74:1** | **0.0%** |

Directional gradients fail because the heading wraps to full width at 375px and spans the full 1200px content box at 1440px — there is no edge for the text to hide behind. Use a uniform scrim:

```css
/*
 * The heading is white over an author-supplied photo, so nothing guarantees
 * contrast. A uniform scrim keeps 1.4.3 independent of whichever image an
 * author drops in: 55% black holds the worst-case pixel at 4.74:1 across the
 * whole heading box at every breakpoint. Measured -- see
 * tools/a11y/hero-scrim-test.mjs and _a11y-audit/README.md.
 */
.hero::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: rgb(0 0 0 / 55%);
}
```

If 55% is too heavy for the design, the alternative is to stop relying on the photo entirely — move the heading out of the image and onto a solid band. Re-run `tools/a11y/hero-scrim-test.mjs` after any change to the hero image, since the required opacity is a property of the photo, not of the CSS.

### `blocks/header/header.js` — Major ×3

**1. Move `aria-expanded` onto the hamburger button** (currently on `<nav>`, where no assistive technology looks for it):

```js
// in toggleMenu(), alongside the existing nav.setAttribute(...)
button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
```

Keep the `aria-label` swap or drop it — with correct `aria-expanded` a static `aria-label="Navigation menu"` is the cleaner pattern.

**2. Stop emitting a stale `aria-expanded` on the `<li>`s.** `toggleAllNavSections()` sets it on every `li`, but `isDestination()` means it never changes for any of the four PPM items, and `aria-expanded` is not valid on an implicit `listitem` role. Either skip destination items:

```js
sections.querySelectorAll('.nav-sections .default-content-wrapper > ul > li').forEach((section) => {
  if (isDestination(section)) {
    section.removeAttribute('aria-expanded');
    return;
  }
  section.setAttribute('aria-expanded', expanded);
});
```

…or, if the hover/focus flyout should be announced as a disclosure, give the `<li>` an explicit `role="group"` and drive the state from the same `:focus-within`/`:hover` transitions the CSS uses. The first option is the smaller change and matches the design, which has no chevron affordance.

**3. Add a skip link.** 21 tab stops before content is a real barrier:

```js
// at the top of decorate(), before the nav is built
const skip = document.createElement('a');
skip.href = '#main';
skip.className = 'skip-to-main';
skip.textContent = 'Skip to main content';
block.prepend(skip);
```

with the standard visually-hidden-until-focused treatment in `styles/styles.css`, and `id="main"` plus `tabindex="-1"` on `<main>` in `scripts/scripts.js`.

### `styles/styles.css` — Minor

`--accent-color: #008578` gives white text **4.54:1**, clearing 4.5:1 by 0.04. Darken it so the CTA has headroom:

```css
--accent-color: #00796e;  /* 5.2:1 against white */
```

Check this against the brand palette before applying — if `#008578` is a fixed brand value, set `a.button.accent` text to `#fff` at `font-weight: 600` and 19px so it qualifies as large text (3:1) instead.

---

## Compliance score

**FAIL** — one Critical issue.

| Severity | Count |
|---|---|
| Critical | 1 |
| Major | 5 |
| Minor | 3 |

The build is in better shape than the count suggests. Landmarks, language, focus management, focus rings, keyboard operability of both the desktop flyouts and the mobile menu, and every measured contrast pair except the hero are already correct — and `cards.js` handles link naming better than most hand-written blocks. The failure is concentrated in one place: **white text dropped on an arbitrary photograph with nothing behind it**. Fix the hero scrim and the skip link, correct the two `aria-expanded` placements, and this page passes.

Re-run the three harnesses in `tools/a11y/` after the fixes, and re-audit once real content is behind `fstab.yaml` — authored images and copy will reintroduce items 2, 6, 7 and 9 on every new page.
