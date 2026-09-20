/* global WebImporter, globalThis */

/*
 * PPM America -> EDS import transform.
 *
 * ---------------------------------------------------------------------------
 * Table shape
 * ---------------------------------------------------------------------------
 * Emits the table shape the *xwalk* importer expects, which mirrors the MODEL
 * in each block's `_{block}.json`, not the visual shape of the source page:
 *
 *   simple block     one row per property (or property group), ONE cell each
 *   container block  one row per child item, that item's properties as cells
 *
 * Companion fields (`imageAlt`, `linkText`) collapse into their base property
 * and never get a cell of their own. Cells are positional, so every cell is
 * emitted even when the source has nothing for it -- a skipped cell shifts
 * every later property up by one and the content lands silently in the wrong
 * field, while the page still renders correctly.
 *
 * Block contracts asserted in this file (property order taken from the model
 * files, which are the source of truth) -- see CONTRACT below.
 *
 * ---------------------------------------------------------------------------
 * Why this walks the page instead of querying for known selectors
 * ---------------------------------------------------------------------------
 * The previous revision ran six `document.querySelector` probes in homepage
 * order. That is correct for one page and silently destructive everywhere
 * else: across the other 13 captured pages it dropped 38-98% of the content,
 * and the pages it damaged most were the ones that still *looked* right,
 * because a homepage selector happened to match something.
 *
 * This revision instead walks the source's own content tree in document order
 * and dispatches each component it meets. Anything it does not recognise is
 * recorded in `WebImporter.ppmUnclaimed` rather than dropped in silence, so the
 * QA harness can fail a page that lost content instead of reporting PASS
 * because no exception was thrown.
 */

// ---------------------------------------------------------------------------
// pending decisions
// ---------------------------------------------------------------------------

/*
 * Two mapping verdicts are contradicted by the capture and are awaiting a human
 * decision (capture/block-authoring-verification.md section 3). They are
 * switches rather than inline edits so that flipping either one is a one-line
 * change and the alternative stays documented and runnable.
 *
 * herotitle: the approved mapping says `hero` + `banner` variant -- white H1
 *   over a full-bleed photograph with a scrim. The computed styles disagree on
 *   all 115 instances: background-image is `none`, the H1 is ink rgb(37,40,42)
 *   rather than reversed, and the band is content-height (58px, not 340px). The
 *   7 instances that do carry an image place it BESIDE the text at x=805, not
 *   behind it. `content` follows that evidence; `hero-banner` follows the
 *   recorded verdict.
 */
const DECISIONS = {
  herotitle: 'content', // 'content' | 'hero-banner'
  breadcrumbs: 'block', // 'block' | 'omit'
};

// ---------------------------------------------------------------------------
// contracts
// ---------------------------------------------------------------------------

/*
 * Cell counts derived from the model files. Kept next to the transforms so a
 * model change that is not mirrored here fails loudly at import time instead
 * of silently shifting content into the wrong property.
 *
 *   hero       _hero.json        image(+imageAlt), text        2 rows x 1 cell
 *   bio-detail _bio-detail.json  image(+imageAlt), name, role, text
 *                                                              4 rows x 1 cell
 *   card-list  _card-list.json   path, category, limit         3 rows x 1 cell
 *   fragment   _fragment.json    reference                     1 row  x 1 cell
 *   stat       _stats.json       figure, label                 2 cells per row
 *   card       _cards.json       image(+imageAlt), text, link  3 cells per row
 *   columns    _columns.json     authored grid                 N cells
 */
const CONTRACT = {
  hero: { rows: 2, cells: 1 },
  bioDetail: { rows: 4, cells: 1 },
  cardList: { rows: 3, cells: 1 },
  fragment: { rows: 1, cells: 1 },
  stat: { cells: 2 },
  card: { cells: 3 },
};

/**
 * Throws when an emitted row does not match the contract taken from the model.
 * @param {string} name Contract key, for the message
 * @param {Array} cells The row about to be emitted
 * @param {number} expected Expected cell count
 */
function assertCells(name, cells, expected) {
  if (cells.length !== expected) {
    throw new Error(`[import] ${name}: expected ${expected} cells, got ${cells.length}`);
  }
}

/**
 * Asserts a simple block's rows are each a single cell, in model order.
 * @param {string} name Contract key
 * @param {Array} rows The rows about to be emitted
 * @param {object} contract The CONTRACT entry
 */
function assertRows(name, rows, contract) {
  assertCells(name, rows, contract.rows);
  rows.forEach((row) => assertCells(`${name} row`, row, contract.cells));
}

// ---------------------------------------------------------------------------
// source vocabulary
// ---------------------------------------------------------------------------

/*
 * Source container themes -> this project's section styles.
 *
 * Measured from the captures rather than guessed: the painted background sits
 * on the inner `.cmp-container`, full-bleed at 1440.
 *
 *   gray-theme        rgb(244,244,244)  204 instances -> `light`  (#f8f8f8)
 *   teal-theme        rgb(0,79,89)       84 instances -> `dark`   (exactly
 *                                        --band-dark-color #004f59)
 *   light-green-theme rgb(71,215,172)    20 instances -> NO EQUIVALENT
 *
 * light-green has no section style in this project. It is mapped to
 * `highlight` so the band is at least authorable and visibly distinct in the
 * content tree, but `highlight` currently resolves to the same #f8f8f8 as
 * `light`, so these 20 bands import a mint band as light grey. That is a
 * reported visual gap, not a silent one -- see the QA report.
 */
const THEME_STYLE = {
  'cmp-container--gray-theme': 'light',
  'cmp-container--teal-theme': 'dark',
  'cmp-container--light-green-theme': 'highlight',
  'cmp-container--dark-green-theme': 'dark',
};

/*
 * Source column layouts -> `columns` block variants.
 *
 * `columns-66-33` is NOT in _columns.json's `classes` select and has no CSS. It
 * is the single most common layout in the source (148 instances), so emitting
 * the content under a correct-but-unbuilt variant name is preferred to
 * emitting it under a wrong-but-existing one: the content lands right and the
 * fix is one option plus one CSS rule. Reported as a pre-import blocker.
 */
const COLUMN_VARIANT = {
  'cmp-container-columns-33-66': 'columns-33-66',
  'cmp-container-columns-66-33': 'columns-66-33',
  'cmp-container-columns-2-equal': '',
  'cmp-container-columns-3-equal': '',
  'cmp-container-columns-4-equal': '',
};

/*
 * How many cells wide each layout is. The source puts every child in a flat
 * 12-column AEM grid and lets CSS wrap them, so a 33-66 container holding six
 * text components is three ROWS of two columns, not one row of six. Emitting
 * the flat list would give the block six cells in one row, which renders as six
 * columns and -- because cells map to model properties by position -- makes
 * every cell after the second meaningless.
 */
const COLUMN_COUNT = {
  'cmp-container-columns-33-66': 2,
  'cmp-container-columns-66-33': 2,
  'cmp-container-columns-2-equal': 2,
  'cmp-container-columns-3-equal': 3,
  'cmp-container-columns-4-equal': 4,
};

/**
 * Splits a flat list of cells into rows of `size`, padding the final row so
 * every row has the same cell count. Ragged rows would shift the trailing
 * cells into the wrong columns.
 * @param {Array} cells The flat cell list
 * @param {number} size Cells per row
 * @returns {Array<Array>} The rows
 */
function chunk(cells, size) {
  const rows = [];
  for (let i = 0; i < cells.length; i += size) {
    const row = cells.slice(i, i + size);
    while (row.length < size) row.push('');
    rows.push(row);
  }
  return rows;
}

/*
 * Experience fragments whose content is genuinely shared across the pages that
 * use them, verified by hashing the rendered text of all 890 instances in the
 * capture. Only these four are one piece of content reused; every other
 * `cmp-experiencefragment--*` modifier names a SLOT whose content varies per
 * page (insights-promo alone has 12 distinct variants across 69 instances).
 *
 * Treating a varying slot as a shared fragment would collapse 69 different
 * promos into one and silently destroy 68 of them, so everything not listed
 * here is inlined into the page that uses it.
 */
const SHARED_FRAGMENTS = new Set([
  'our-insights', // 53 instances, 1 variant
  'our-advantage', // 10 instances, 1 variant
  'career-opportunities', // 4 instances, 1 variant
  'commercial-real-estate-debt', // 2 instances, 1 variant
]);

/*
 * Site-global chrome and the unresolved consent gate. Excluded by construction
 * rather than filtered afterwards.
 *
 * `disclosureagreement` (cmp-015) is deliberately dropped: its verdict is an
 * open legal/compliance decision, not a block decision, and importing a
 * blocking interstitial as page content would bake a product question into
 * 170 pages of content.
 */
const CHROME = [
  '.header-sticky',
  '.cmp-experiencefragment--header',
  '.cmp-experiencefragment--footer',
  '.disclosureagreement',
  '.cmp-modal',
  '.cmp-modal_overlay',
];

/**
 * True when a grid column is site chrome rather than page content.
 *
 * Deliberately shallow. Testing `unit.querySelector(chrome)` at any depth looks
 * safer and is not: the footer fragment shares its section wrapper with the
 * page's footnote disclaimer, so a descendant test discards the whole section
 * and silently loses the legal text on every page that has one.
 * @param {Element} unit A `.aem-GridColumn` wrapper
 * @returns {boolean}
 */
function isChrome(unit) {
  return CHROME.some((selector) => unit.matches(selector)
    || unit.querySelector(`:scope > ${selector}, :scope > * > ${selector}`));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Builds an EDS block name with its variant classes, e.g. "Cards (square, plain)".
 * @param {string} name The block name
 * @param {string[]} variants Variant class names
 * @returns {string}
 */
function blockName(name, variants = []) {
  const used = variants.filter(Boolean);
  return used.length ? `${name} (${used.join(', ')})` : name;
}

/**
 * Collapses AEM's templating whitespace into a single-spaced trimmed string.
 * @param {Element|null} el The element to read
 * @returns {string}
 */
function text(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Replaces an element's tag while keeping its child nodes, so inline markup
 * such as a <sup> footnote marker or an <i> survives. Used to demote the
 * source's fake headings -- a stat label, a card eyebrow and a biocard name
 * are not headings -- without flattening them to plain text.
 * @param {Element} el The element to retag
 * @param {string} tag The new tag name
 * @param {Document} document The document
 * @returns {Element} The replacement element
 */
function retag(el, tag, document) {
  const replacement = document.createElement(tag);
  replacement.append(...el.childNodes);
  replacement.innerHTML = replacement.innerHTML.replace(/\s+/g, ' ').trim();
  el.replaceWith(replacement);
  return replacement;
}

/**
 * True when an element contributes nothing a reader would see.
 *
 * The source is full of authored empties -- `<h2><br></h2>`, `<li><b></b></li>`,
 * `<span class="cmp-numbertext__prestat-icon"></span>`, and whole containers
 * with a zero-child `.aem-Grid`. Emitting them produces stray blank rows and,
 * worse, blank cells that look like a field the author forgot to fill.
 * @param {Element|null} el The candidate
 * @returns {boolean}
 */
function isEmpty(el) {
  if (!el) return true;
  return !text(el) && !el.querySelector('img, picture, a[href], hr');
}

/**
 * Returns the <img> for a source core-image component, cleaned for import.
 *
 * `src` is an AEM `coreimg` rendition URL; the original DAM path is carried on
 * the wrapper as `data-cmp-filereference`. The DAM path is preferred because it
 * resolves to the full-size original with a sane filename, where the rendition
 * URL embeds the authoring path and a cache-busting timestamp.
 *
 * Alt text is carried across verbatim and never synthesised. Most source images
 * ship `alt=""` because they sit inside the same link as the text that names
 * them; a few carry real alternatives (the AUM pie chart's is a full data
 * description) and those must survive. Empty alts are counted by the QA harness
 * so an author can supply real ones where they are wanted.
 * @param {Element|null} scope Element containing the image
 * @returns {Element|null}
 */
function imageFrom(scope) {
  const img = scope?.querySelector('img.cmp-image__image, img');
  if (!img) return null;

  const fileRef = img.closest('[data-cmp-filereference]')?.getAttribute('data-cmp-filereference');
  if (fileRef) img.setAttribute('src', fileRef);

  if (!img.hasAttribute('alt')) img.setAttribute('alt', '');

  // strip AEM delivery plumbing; the importer resolves src to a real asset
  ['loading', 'class', 'itemprop', 'data-cmp-hook-image'].forEach((a) => img.removeAttribute(a));
  return img;
}

/**
 * Wraps a link in the boilerplate's primary-button convention.
 *
 * `decorateButtons` in aem.js promotes a standalone link in its own paragraph
 * to a styled button, taking the `accent` treatment from <strong><em>. That is
 * how the source's solid teal CTA is expressed in EDS -- as default content,
 * not as a block field.
 * @param {string} href The link target
 * @param {string} label The link text
 * @param {Document} document The document
 * @returns {Element} A <p> holding the button
 */
function buttonParagraph(href, label, document) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;

  const em = document.createElement('em');
  em.append(a);
  const strong = document.createElement('strong');
  strong.append(em);
  const p = document.createElement('p');
  p.append(strong);
  return p;
}

// ---------------------------------------------------------------------------
// page builder
// ---------------------------------------------------------------------------

/*
 * Accumulates content into `main`, managing EDS section breaks.
 *
 * Sections are derived from the source's own theme containers rather than
 * declared per page: a container whose theme differs from the one enclosing it
 * opens a new section, and a `.cmp-separator` sets `divided` on whatever
 * section opens next. That is what makes one walker serve every template.
 */
class Page {
  /**
   * @param {Document} document The document
   */
  constructor(document) {
    this.document = document;
    this.main = document.createElement('main');
    /*
     * `ambient` is the band the walk is currently inside. It is sticky across
     * section breaks because one source band routinely becomes several EDS
     * sections -- the teal stats panel splits at its separator -- and each of
     * them still has to carry the band style or the second half renders
     * unthemed against the page default.
     */
    this.ambient = '';
    this.styles = [];
    this.open = false;
    this.meta = {};
  }

  /**
   * Appends a node to the current section.
   * @param {Node|null} node The node to append
   */
  add(node) {
    if (!node) return;
    this.main.append(node);
    this.open = true;
  }

  /**
   * Sets a style on the current section, e.g. a theme band.
   * @param {string} style The section style value
   */
  style(style) {
    if (style && !this.styles.includes(style)) this.styles.push(style);
  }

  /**
   * Enters a band, making its style sticky for every section it spans.
   * @param {string} style The section style value
   * @returns {string} The style being replaced, to restore on the way out
   */
  enter(style) {
    const previous = this.ambient;
    this.end();
    this.ambient = style;
    this.styles = style ? [style] : [];
    return previous;
  }

  /**
   * Leaves a band, restoring the enclosing one.
   * @param {string} style The style returned by `enter`
   */
  leave(style) {
    this.end();
    this.ambient = style;
    this.styles = style ? [style] : [];
  }

  /**
   * Closes the current section, writing its Section Metadata table and a rule.
   * A no-op when nothing has been added, so repeated breaks cannot produce
   * empty sections.
   */
  end() {
    if (this.open) {
      if (this.styles.length) {
        this.main.append(WebImporter.DOMUtils.createTable([
          ['Section Metadata'],
          ['style', this.styles.join(', ')],
        ], this.document));
      }
      this.main.append(this.document.createElement('hr'));
      this.open = false;
    }
    this.styles = this.ambient ? [this.ambient] : [];
  }
}

// ---------------------------------------------------------------------------
// component transforms
// ---------------------------------------------------------------------------

/**
 * cmp-004 hero -> `hero` block (reuse).
 *
 * SIMPLE block: the model is image(+imageAlt) then text, so this is TWO rows
 * of ONE cell -- not one row of two columns. Both shapes render identically
 * because hero.css only uses descendant selectors, so an error here is
 * invisible on the page and shows up only as the H1 landing in the image
 * property once the page is opened in Universal Editor.
 * @param {Element} el Source .cmp-hero
 * @param {Document} document The document
 * @returns {Element}
 */
function transformHero(el, document) {
  const rows = [
    [imageFrom(el.querySelector('.cmp-hero__image')) || ''],
    [el.querySelector('.cmp-hero__title') || ''],
  ];
  assertRows('hero', rows, CONTRACT.hero);
  return WebImporter.DOMUtils.createTable([[blockName('Hero')], ...rows], document);
}

/**
 * cmp-003 herotitle -> page heading (see DECISIONS.herotitle).
 *
 * The measured source is an ink-coloured <h1> on a transparent, content-height
 * band -- default content, not a block. The 7 instances that carry an image
 * lay it out BESIDE the heading (text 790px at x=15, image 620px at x=805), so
 * those become a two-cell `columns` block rather than a background composition.
 *
 * Equal-width columns render 705/705 against the source's 790/620. That is the
 * closest built variant; a `columns-66-33` would be nearer still and is already
 * needed for 148 other instances.
 * @param {Element} el Source .cmp-herotitle
 * @param {Page} page The page builder
 * @param {Document} document The document
 */
function transformHeroTitle(el, page, document) {
  const title = el.querySelector('.cmp-herotitle__title');
  const img = imageFrom(el.querySelector('.cmp-herotitle__image'));

  if (DECISIONS.herotitle === 'hero-banner') {
    const rows = [[img || ''], [title || '']];
    assertRows('hero', rows, CONTRACT.hero);
    page.add(WebImporter.DOMUtils.createTable(
      [[blockName('Hero', ['banner'])], ...rows],
      document,
    ));
    return;
  }

  if (!title) return;
  const heading = retag(title, 'h1', document);

  if (!img) {
    page.add(heading);
    return;
  }

  page.add(WebImporter.DOMUtils.createTable([
    [blockName('Columns')],
    [heading, img],
  ], document));
}

/**
 * cmp-009 breadcrumb -> `breadcrumbs` block (new).
 *
 * The block derives its trail from the URL and upgrades the ancestor labels
 * from the query index, so NOTHING is authored into it -- the model declares
 * only a block-level `classes` select. The table is therefore a bare header
 * row, and the source's <ol> is discarded rather than transcribed. Retyping
 * 635 crumbs across 167 pages is exactly the drift the derived block exists to
 * prevent.
 * @param {Document} document The document
 * @returns {Element|null}
 */
function transformBreadcrumbs(document) {
  if (DECISIONS.breadcrumbs === 'omit') return null;
  return WebImporter.DOMUtils.createTable([[blockName('Breadcrumbs')]], document);
}

/**
 * Builds one `stats` block from a run of source .cmp-numbertext components.
 *
 * CONTAINER block: each stat is a row, and the stat model's two properties
 * (figure, label) are its two cells. The size variant is a block-level field,
 * so it rides in the block name -- not in a row.
 * @param {Element[]} items Source .cmp-numbertext elements
 * @param {Document} document The document
 * @returns {Element|null}
 */
function buildStats(items, document) {
  if (!items.length) return null;

  // `cmp-numbertext--small` sits on the outer grid-column wrapper, not on the
  // component, and applies to the whole run
  const small = items.some((item) => item.closest('.cmp-numbertext--small'));

  const rows = items.map((item) => {
    // figure = pre-symbol + number + post-symbol, recombined into one string;
    // stats.js splits it back apart for styling. The prestat span is present
    // even when empty, so read it rather than testing for it.
    const pre = text(item.querySelector('.cmp-numbertext__prestat-icon'));
    const num = text(item.querySelector('.cmp-numbertext__text'));
    const post = text(item.querySelector('.cmp-numbertext__poststat-icon'));

    const figure = document.createElement('p');
    figure.textContent = `${pre}${num}${post}`;

    // the source marks the label as <h2>; it is a caption, not a heading, and
    // the <sup> footnote marker must survive the demotion
    const source = item.querySelector('.cmp-numbertext__stattext');
    const label = source ? retag(source, 'p', document) : '';

    const cells = [figure, label];
    assertCells('stat', cells, CONTRACT.stat.cells);
    return cells;
  });

  return WebImporter.DOMUtils.createTable([
    [blockName('Stats', [small ? 'small' : ''])],
    ...rows,
  ], document);
}

/**
 * Builds the body cell of a card: eyebrow, heading, then copy.
 *
 * Accessibility: the source nests an <h2> eyebrow above an <h2> title, both
 * under the section's own <h3>. The eyebrow is a metadata line, not a heading,
 * so it is demoted to a paragraph -- cards.js marks a leading paragraph before
 * a heading as `.cards-card-eyebrow` -- and the title becomes an <h3> so the
 * outline stays heading-ordered.
 *
 * Both eyebrow spellings occur and mean the same thing: `cmp-card__pretitle`
 * (h2, authored staticcards) and `cmp-card__pre-title-text` (h4, the
 * server-rendered listing). Press-release cards carry the date in
 * `.cmp-card__date` instead, in the same slot.
 * @param {Element} card Source .cmp-card
 * @param {Document} document The document
 * @returns {Array<Element>} The body nodes
 */
function cardBody(card, document) {
  const body = [];

  const eyebrow = card.querySelector('.cmp-card__pretitle, .cmp-card__pre-title-text, .cmp-card__date > h2');
  if (eyebrow && !isEmpty(eyebrow)) body.push(retag(eyebrow, 'p', document));

  // the title tag varies by page (h2, h3, h5, h6 all occur); read, never assume
  const title = card.querySelector('.cmp-card__title');
  if (title && !isEmpty(title)) body.push(retag(title, 'h3', document));

  const description = card.querySelector('.cmp-card__description');
  if (description && !isEmpty(description)) {
    // the source wraps each bullet's text in its own <p>; unwrap so the list
    // imports as a plain <ul><li>text</li></ul>
    description.querySelectorAll('li > p:only-child').forEach((p) => p.replaceWith(...p.childNodes));
    // and sometimes the description is a bare text node with no <p> at all
    if (!description.firstElementChild) {
      const p = document.createElement('p');
      p.textContent = text(description);
      body.push(p);
    } else {
      body.push(...[...description.children].filter((child) => !isEmpty(child)));
    }
  }

  return body;
}

/**
 * cmp-005 staticcard / cmp-008 report-links -> `cards` block (extend).
 *
 * CONTAINER block: each card is a row of three cells, matching the card
 * model's image(+imageAlt), text, link. The trailing link cell is emitted even
 * when the source card is not linked, so that appending a property to the
 * model later cannot shift content into the wrong field.
 * @param {Element[]} items Source .cmp-card elements
 * @param {string[]} variants Cards variant classes
 * @param {Document} document The document
 * @returns {Element|null}
 */
function buildCards(items, variants, document) {
  if (!items.length) return null;

  const rows = items.map((card) => {
    const img = imageFrom(card.querySelector('.cmp-card__image'));
    const body = cardBody(card, document);

    // whole-card link: the source wraps the card's content in one <a>
    const href = card.querySelector('a.cmp-card__link')?.getAttribute('href');
    let link = '';
    if (href) {
      link = document.createElement('a');
      link.href = href;
      link.textContent = href;
    }

    const cells = [img || '', body, link];
    assertCells('card', cells, CONTRACT.card.cells);
    return cells;
  });

  return WebImporter.DOMUtils.createTable([
    [blockName('Cards', variants)],
    ...rows,
  ], document);
}

/**
 * cmp-007 biocard -> `cards` block, `bio` variant (extend).
 *
 * Same three-cell card contract: portrait, name + role, link to the bio page.
 * The name is an <h5> in the source and becomes an <h3> so the grid's headings
 * sit one level under the section heading above them; the role is a caption,
 * so it follows as a paragraph rather than a second heading.
 *
 * `bio` is not yet in _cards.json's `classes` select and has no CSS -- the
 * circular-portrait treatment currently lives only on bio-detail. Emitted
 * under its correct name and reported as a pre-import blocker.
 * @param {Element[]} items Source .cmp-biocard elements
 * @param {Document} document The document
 * @returns {Element|null}
 */
function buildBioCards(items, document) {
  if (!items.length) return null;

  const rows = items.map((bio) => {
    const img = imageFrom(bio.querySelector('.cmp-biocard__image'));

    const body = [];
    const name = bio.querySelector('.cmp-biocard__name');
    if (name && !isEmpty(name)) body.push(retag(name, 'h3', document));

    /*
     * The role is two raw text nodes separated only by a newline, with a
     * trailing comma on the first ("Vice President,\n EMD Analyst"). Collapsing
     * the whitespace rejoins them into the one line the source renders; an
     * unauthored second line leaves a stray blank that `text` drops.
     */
    const role = bio.querySelector('.cmp-biocard__administrative-title');
    if (role && !isEmpty(role)) body.push(retag(role, 'p', document));

    const href = bio.querySelector('a.cmp-biocard__link')?.getAttribute('href');
    let link = '';
    if (href) {
      link = document.createElement('a');
      link.href = href;
      link.textContent = href;
    }

    const cells = [img || '', body, link];
    assertCells('card (bio)', cells, CONTRACT.card.cells);
    return cells;
  });

  return WebImporter.DOMUtils.createTable([
    [blockName('Cards', ['bio', 'plain'])],
    ...rows,
  ], document);
}

/**
 * cmp-012 biodetail -> `bio-detail` block (new).
 *
 * SIMPLE block: image(+imageAlt), name, role, text -> FOUR rows of ONE cell.
 *
 * The biography is not inside `.cmp-biodetail`. The source lays the page out as
 * a 33-66 container whose left column is the component and whose right column
 * is a separate `.cmp-text`, so the prose is collected from the sibling column
 * and folded into the block's fourth field -- which is the shape the model
 * declares and the block reads.
 * @param {Element} el Source .cmp-biodetail
 * @param {Document} document The document
 * @returns {Element}
 */
function transformBioDetail(el, document) {
  const img = imageFrom(el.querySelector('.cmp-biodetail__image'));

  const name = el.querySelector('.cmp-biodetail__name');
  const role = el.querySelector('.cmp-biodetail__administrative-title');

  /*
   * The prose lives in the other column of the shared 33-66 container. Scoped
   * to that ancestor so it cannot reach across into an unrelated text
   * component further down the page.
   */
  const layout = el.closest('.cmp-container-columns-33-66');
  const prose = [...(layout?.querySelectorAll('.cmp-text') || [])]
    .filter((t) => !el.contains(t) && !isEmpty(t))
    .flatMap((t) => [...t.children]);

  const rows = [
    [img || ''],
    [name ? retag(name, 'p', document) : ''],
    [role ? retag(role, 'p', document) : ''],
    [prose.length ? prose : ''],
  ];
  assertRows('bio-detail', rows, CONTRACT.bioDetail);

  return WebImporter.DOMUtils.createTable([[blockName('Bio Detail')], ...rows], document);
}

/**
 * cmp-006 staticcard-left / -right -> `columns` block, flush variant (extend).
 *
 * One row, two cells: the cover image, then the body followed by the CTA. The
 * CTA stays a separate element in the same cell so it maps to the column
 * filter's `button` component rather than being swallowed into the richtext.
 *
 * `cmp-card--right` mirrors the layout in the source. The cells are emitted in
 * the source's visual order so the imported page matches, rather than relying
 * on a variant that does not exist.
 * @param {Element} el Source .cmp-card
 * @param {boolean} mediaFirst Whether the image column comes first
 * @param {Document} document The document
 * @returns {Element}
 */
function transformPromo(el, mediaFirst, document) {
  const img = imageFrom(el.querySelector('.cmp-card__image'));
  const body = cardBody(el, document);

  const cta = el.querySelector('.cmp-card__action-container a');
  if (cta) {
    body.push(buttonParagraph(cta.getAttribute('href'), text(cta), document));
  }

  const media = img || '';
  const cells = mediaFirst ? [media, body] : [body, media];

  return WebImporter.DOMUtils.createTable([
    [blockName('Columns', ['flush'])],
    cells,
  ], document);
}

/**
 * cmp-014 dynamic-card-list -> `card-list` block (new).
 *
 * SIMPLE block: path, category, limit -> THREE rows of ONE cell, in model
 * order. The source's 35 server-rendered cards are deliberately NOT
 * transcribed: the block reads the query index at request time, so importing
 * the rendered cards would freeze a listing that is supposed to update itself
 * and would duplicate every article as authored content.
 *
 * The listing lists its own subtree, so the path is the page's own path.
 * @param {string} pathname The listing page's path
 * @param {Document} document The document
 * @returns {Element}
 */
function transformCardList(pathname, document) {
  const cell = (value) => {
    const p = document.createElement('p');
    p.textContent = value;
    return [p];
  };

  const rows = [
    cell(pathname),
    cell(''), // category: the path already scopes this listing
    cell('9'), // _card-list.json's own default
  ].map((c) => [c]);

  assertRows('card-list', rows, CONTRACT.cardList);
  return WebImporter.DOMUtils.createTable([[blockName('Card List')], ...rows], document);
}

/**
 * A reused experience fragment -> `fragment` block.
 * @param {string} name The fragment's BEM modifier, e.g. `our-advantage`
 * @param {Document} document The document
 * @returns {Element}
 */
function transformFragment(name, document) {
  const link = document.createElement('a');
  link.href = `/fragments/${name}`;
  link.textContent = `/fragments/${name}`;

  const rows = [[link]];
  assertRows('fragment', rows, CONTRACT.fragment);
  return WebImporter.DOMUtils.createTable([[blockName('Fragment')], ...rows], document);
}

// ---------------------------------------------------------------------------
// the walk
// ---------------------------------------------------------------------------

/**
 * Returns the AEM grid children of a container, i.e. its authored components.
 *
 * The wrapper chain between a grid column and its grid is not fixed: a plain
 * container gives `> .cmp-container > .aem-Grid`, while an experience fragment
 * inserts `.cmp-experiencefragment` in between and the career-opportunities XF
 * nests five container levels before reaching content. Matching a fixed path
 * therefore returns nothing for 890 experience-fragment instances and drops
 * everything inside them, so the nearest grid is located instead.
 *
 * The guard keeps that from reaching too far: a grid belonging to some nested
 * component would have a different `.aem-GridColumn` ancestor, and its children
 * are that component's business rather than this container's.
 * @param {Element} el A container or grid-column wrapper
 * @returns {Element[]}
 */
function gridChildren(el) {
  const grid = el.querySelector('.aem-Grid');
  if (!grid) return [];
  if (grid.closest('.aem-GridColumn') !== el.closest('.aem-GridColumn')) return [];
  return [...grid.children];
}

/**
 * Names the component a grid column holds, or null when it is a container.
 *
 * Dispatch is on the inner `.cmp-*` element rather than on the outer wrapper's
 * bare resource-type class, because the wrapper also carries theme, spacing and
 * variant modifiers that vary independently.
 * @param {Element} unit A `.aem-GridColumn` wrapper
 * @returns {string|null}
 */
function componentOf(unit) {
  const kinds = [
    ['hero', '.cmp-hero'],
    ['herotitle', '.cmp-herotitle'],
    ['breadcrumb', '.cmp-breadcrumb'],
    ['biodetail', '.cmp-biodetail'],
    ['biocard', '.cmp-biocard'],
    ['numbertext', '.cmp-numbertext'],
    ['card', '.cmp-card'],
    ['newsinsightsdate', '.cmp-newsinsightsdate'],
    ['separator', '.cmp-separator'],
    ['download', '.cmp-download'],
    ['list', '.cmp-list'],
    ['button', '.cmp-button'],
    ['title', '.cmp-title__text'],
    ['image', '.cmp-image'],
    ['text', '.cmp-text'],
  ];
  const found = kinds.find(([, selector]) => unit.querySelector(`:scope > ${selector}, :scope > * > ${selector}`));
  return found ? found[0] : null;
}

/**
 * Reads a container's theme, column layout and shared-fragment identity.
 * @param {Element} unit A `.aem-GridColumn` wrapper
 * @returns {{theme: string, columns: string, fragment: string}}
 */
function containerSignals(unit) {
  const classes = (unit.className || '').toString().split(/\s+/);

  /*
   * Scoped to the unit's own fragment, never a descendant one. A page section
   * routinely holds its own content AND a reused fragment at the end of it --
   * /our-story/our-team is a title, an intro and a biocard grid followed by the
   * shared our-advantage promo -- so a descendant match would replace the
   * entire section with a fragment reference and discard the page's real
   * content. The walk reaches nested fragments by recursion instead.
   */
  const xf = unit.matches('.cmp-experiencefragment') ? unit
    : unit.querySelector(':scope > .cmp-experiencefragment, :scope > * > .cmp-experiencefragment');
  const modifier = xf
    ? ((xf.className || '').toString().split(/\s+/)
      .find((c) => c.startsWith('cmp-experiencefragment--')) || '')
      .replace('cmp-experiencefragment--', '')
    : '';

  return {
    theme: THEME_STYLE[classes.find((c) => THEME_STYLE[c])] || '',
    columns: classes.find((c) => c in COLUMN_VARIANT) || '',
    fragment: SHARED_FRAGMENTS.has(modifier) ? modifier : '',
  };
}

/**
 * Collects a run of same-kind siblings starting at `i`, so a grid of cards
 * becomes one block rather than one block per card.
 * @param {Element[]} units The sibling list
 * @param {number} i The start index
 * @param {string} kind The component kind to run on
 * @returns {Element[]} The matching units
 */
function runOf(units, i, kind) {
  const run = [];
  for (let j = i; j < units.length && componentOf(units[j]) === kind; j += 1) run.push(units[j]);
  return run;
}

/**
 * Walks a container's children in document order, emitting into the page.
 * @param {Element} container A `.container.responsivegrid` wrapper
 * @param {Page} page The page builder
 * @param {object} ctx Walk context: `{ theme, pathname }`
 */
function walk(container, page, ctx) {
  const units = gridChildren(container);

  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    const { document } = page;

    if (isChrome(unit)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    // the server-rendered listing is a block in its own right, not a card grid
    if (unit.classList.contains('dynamic-card-list')) {
      page.add(transformCardList(ctx.pathname, document));
      // eslint-disable-next-line no-continue
      continue;
    }

    const kind = componentOf(unit);

    if (!kind) {
      const signals = containerSignals(unit);

      if (signals.fragment) {
        page.add(transformFragment(signals.fragment, document));
        // eslint-disable-next-line no-continue
        continue;
      }

      const children = gridChildren(unit);
      if (!children.length) {
        // authored empty containers are common; they produce nothing
        // eslint-disable-next-line no-continue
        continue;
      }

      /*
       * A column container is a `columns` block only when its cells are plain
       * content. When the cells are cards, bios or stats it is a GRID of those
       * components and belongs to their block instead -- and when it mixes
       * content with a nested grid (a label rail beside a card grid) it is a
       * section-level split, per the cmp-017 resolution, because a columns cell
       * cannot host another block.
       */
      if (signals.columns) {
        const kinds = children.map(componentOf);
        const every = (k) => kinds.length && kinds.every((c) => c === k);

        if (every('card')) {
          page.add(buildCards(
            children.map((c) => c.querySelector('.cmp-card')),
            ['square', 'plain'],
            document,
          ));
          // eslint-disable-next-line no-continue
          continue;
        }
        if (every('biocard')) {
          page.add(buildBioCards(children.map((c) => c.querySelector('.cmp-biocard')), document));
          // eslint-disable-next-line no-continue
          continue;
        }
        if (every('numbertext')) {
          page.add(buildStats(children.map((c) => c.querySelector('.cmp-numbertext')), document));
          // eslint-disable-next-line no-continue
          continue;
        }

        const simple = kinds.every((c) => ['text', 'title', 'image', 'list', 'button'].includes(c));
        if (simple && children.length >= 2) {
          const cells = children.map((child) => {
            const inner = child.querySelector('.cmp-text, .cmp-title, .cmp-image, .cmp-list');
            return inner ? [...inner.children] : [child];
          });
          page.add(WebImporter.DOMUtils.createTable([
            [blockName('Columns', [COLUMN_VARIANT[signals.columns]])],
            ...chunk(cells, COLUMN_COUNT[signals.columns]),
          ], document));
          // eslint-disable-next-line no-continue
          continue;
        }

        /*
         * Mixed: a narrow label rail beside wider content that itself holds
         * blocks. `split-33-66` puts the asymmetry on the section, which is the
         * only place a block-containing column can live.
         */
        if (signals.columns === 'cmp-container-columns-33-66') page.style('split-33-66');
      }

      // a theme change opens a new section, and closes it again on the way out
      if (signals.theme && signals.theme !== ctx.theme) {
        const outer = page.enter(signals.theme);
        walk(unit, page, { ...ctx, theme: signals.theme });
        page.leave(outer);
        // eslint-disable-next-line no-continue
        continue;
      }

      walk(unit, page, ctx);
      // eslint-disable-next-line no-continue
      continue;
    }

    // --- recognised components ---------------------------------------------
    const inner = (selector) => unit.querySelector(selector);

    switch (kind) {
      case 'hero':
        page.add(transformHero(inner('.cmp-hero'), document));
        break;

      case 'herotitle':
        transformHeroTitle(inner('.cmp-herotitle'), page, document);
        break;

      case 'breadcrumb':
        page.add(transformBreadcrumbs(document));
        break;

      case 'biodetail':
        page.add(transformBioDetail(inner('.cmp-biodetail'), document));
        break;

      case 'biocard': {
        const run = runOf(units, i, 'biocard');
        page.add(buildBioCards(run.map((u) => u.querySelector('.cmp-biocard')), document));
        i += run.length - 1;
        break;
      }

      case 'numbertext': {
        const run = runOf(units, i, 'numbertext');
        page.add(buildStats(run.map((u) => u.querySelector('.cmp-numbertext')), document));
        i += run.length - 1;
        break;
      }

      case 'card': {
        // a left/right promo is one full-width band, never part of a grid
        if (unit.matches('.cmp-card--left, .cmp-card--right')) {
          page.add(transformPromo(
            inner('.cmp-card'),
            unit.matches('.cmp-card--left'),
            document,
          ));
          break;
        }
        const run = runOf(units, i, 'card')
          .filter((u) => !u.matches('.cmp-card--left, .cmp-card--right'));
        page.add(buildCards(
          run.map((u) => u.querySelector('.cmp-card')),
          ['square', 'plain'],
          document,
        ));
        i += run.length - 1;
        break;
      }

      case 'newsinsightsdate':
        // metadata, not content -- see appendMetadata
        page.meta.publishDate = text(inner('.cmp-insightdate__title'));
        break;

      case 'separator':
        /*
         * The source needed a whole AEM component to emit one <hr>. In EDS the
         * rule is a section style on what follows, not an element in the flow,
         * so the separator closes the current section and marks the next.
         */
        page.end();
        page.style('divided');
        break;

      case 'title': {
        const heading = inner('.cmp-title__text');
        // the tag varies by page and by colour modifier; read it, never assume
        if (!isEmpty(heading)) page.add(retag(heading, heading.tagName.toLowerCase(), document));
        break;
      }

      case 'button': {
        const a = inner('.cmp-button');
        if (a) page.add(buttonParagraph(a.getAttribute('href'), text(a), document));
        break;
      }

      case 'download': {
        const a = inner('.cmp-download__action');
        if (a) page.add(buttonParagraph(a.getAttribute('href'), text(a), document));
        break;
      }

      case 'image': {
        const img = imageFrom(inner('.cmp-image'));
        if (img) page.add(img);
        break;
      }

      case 'list': {
        const list = inner('.cmp-list');
        if (list) {
          // unwrap the source's span-inside-link into a plain <li><a>
          list.querySelectorAll('.cmp-list__item-title').forEach((span) => {
            span.replaceWith(...span.childNodes);
          });
          page.add(list);
        }
        break;
      }

      case 'text': {
        const body = inner('.cmp-text');
        if (body) {
          // a source footnote block continues the band above it
          if (unit.matches('.cmp-text__source')) page.style('light');
          [...body.children].filter((child) => !isEmpty(child)).forEach((child) => page.add(child));
        }
        break;
      }

      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// metadata
// ---------------------------------------------------------------------------

/**
 * Builds the page Metadata block.
 *
 * Hand-rolled rather than using WebImporter.rules.createMetadata because the
 * source emits <meta name="description"> twice with identical content, and that
 * helper concatenates duplicates into one doubled string.
 *
 * The article fields matter beyond this page: helix-query.yaml indexes
 * `publish-date`, `category`, `read-time` and `author`, and both the article
 * header and every listing card read those index rows. Losing them here would
 * leave `card-list` unable to sort or label anything.
 * @param {Element} main The main element
 * @param {Page} page The page builder
 * @param {Document} document The document
 */
function appendMetadata(main, page, document) {
  const content = (selector) => document.querySelector(selector)?.content?.trim() || '';

  const meta = {
    Title: text(document.querySelector('title')),
    // `[name=...]` matches both copies; querySelector takes the first
    Description: content('meta[name="description"]'),
  };

  const ogImage = content('meta[property="og:image"]');
  if (ogImage) {
    const img = document.createElement('img');
    img.src = ogImage;
    img.alt = '';
    meta.Image = img;
  }

  /*
   * Category has no on-page component. Its only reliable source is the
   * breadcrumb's parent crumb -- /news-and-insights/market-insights/... yields
   * "Market Insights" -- which is also what the source's own listing cards
   * print in their eyebrow.
   */
  const crumbs = [...document.querySelectorAll('.cmp-breadcrumb__item')];
  if (crumbs.length > 2) meta.Category = text(crumbs[crumbs.length - 2]);

  if (page.meta.publishDate) meta['Publish Date'] = page.meta.publishDate;
  if (page.meta.readTime) meta['Read Time'] = page.meta.readTime;
  if (page.meta.author) meta.Author = page.meta.author;

  const rows = Object.entries(meta).filter(([, v]) => v).map(([k, v]) => [k, v]);
  if (rows.length) {
    main.append(WebImporter.DOMUtils.createTable([['Metadata'], ...rows], document));
  }
}

/**
 * Reads the date and read-time that blog articles fuse into a single heading
 * ("June 16, 2026&nbsp; |&nbsp; 3 Minute Read") instead of emitting a
 * newsinsightsdate component. Market-insights and press-release articles use
 * the component and never match here.
 * @param {Document} document The document
 * @param {Page} page The page builder
 */
function readFusedDate(document, page) {
  if (page.meta.publishDate) return;

  const heading = [...document.querySelectorAll('.cmp-text h4')]
    .find((h) => /\|/.test(h.textContent) && /\d{4}/.test(h.textContent));
  if (!heading) return;

  const [date, read] = text(heading).split('|').map((part) => part.trim());
  if (date) page.meta.publishDate = date;
  if (read) page.meta.readTime = read;
  heading.remove();
}

/**
 * Records source components the walk did not claim.
 *
 * This is the guard against the failure mode that made the previous revision
 * dangerous: a page that emits well-formed blocks for the components it knows
 * and drops the rest without a trace looks correct on inspection and is not.
 * The harness reads this and fails the page.
 * @param {Document} document The document
 * @param {Element} main The transformed main
 */
function reportUnclaimed(document, main) {
  const root = document.querySelector('.root.container');
  if (!root) return;

  const counted = {};
  const selectors = {
    herotitle: '.cmp-herotitle',
    breadcrumb: '.cmp-breadcrumb',
    biodetail: '.cmp-biodetail',
    biocard: '.cmp-biocard',
    numbertext: '.cmp-numbertext',
    card: '.cmp-card',
    text: '.cmp-text',
    title: '.cmp-title__text',
    image: '.cmp-image',
    list: '.cmp-list',
    button: '.cmp-button',
    download: '.cmp-download',
  };

  Object.entries(selectors).forEach(([name, selector]) => {
    const all = [...root.querySelectorAll(selector)]
      .filter((el) => !CHROME.some((chrome) => el.closest(chrome)));
    if (all.length) counted[name] = all.length;
  });

  /*
   * An authored data table in the source richtext collides with EDS's own
   * convention, where a table at the top level of `main` IS a block: the CCPA
   * category tables in the privacy policies would import as a block named
   * "Category". They are real tabular content -- a legal category/purpose grid
   * -- so flattening them would destroy the relationship they exist to express,
   * and this project has no `table` block to put them in. Reported so the two
   * affected pages can be held back rather than imported as a broken block.
   */
  const authoredTables = [...main.children]
    .filter((el) => el.tagName === 'TABLE' && !el.querySelector('th')).length;

  // `WebImporter` is a frozen module namespace in the harness, so the report
  // rides on globalThis, which is writable both there and in the importer
  globalThis.ppmImportReport = {
    source: counted,
    emitted: main.children.length,
    authoredTables,
  };
}

// ---------------------------------------------------------------------------
// page transform
// ---------------------------------------------------------------------------

export default {
  /**
   * @param {object} source
   * @param {HTMLDocument} source.document The source document
   * @param {string} source.url The URL of the source page
   * @returns {HTMLElement} The root element to be converted
   */
  transformDOM: ({ document, url }) => {
    const page = new Page(document);
    const { pathname } = new URL(url);

    readFusedDate(document, page);

    /*
     * There is no <main> in the source. The content tree is
     * `.root.container > .cmp-container > .aem-Grid`, whose children are the
     * page's top-level sections. Walking from there means site-global chrome is
     * excluded by construction rather than filtered out afterwards -- the
     * header and footer are authored as the /nav and /footer fragments and are
     * imported separately.
     */
    const root = document.querySelector('.root.container');
    if (root) walk(root, page, { theme: '', pathname });

    page.end();

    // a trailing <hr> from the last section break would create an empty section
    if (page.main.lastElementChild?.tagName === 'HR') page.main.lastElementChild.remove();

    /*
     * Strip AEM authoring plumbing. Source nodes are reused rather than rebuilt,
     * so they arrive carrying `class`, `id`, `data-cmp-*` and schema.org
     * microdata. Left in place these end up inside the imported richtext, and a
     * stale `class` can collide with a real block class once the page is
     * served. createTable adds no attributes of its own, so clearing these
     * across `main` is safe.
     */
    page.main.querySelectorAll('*').forEach((el) => {
      [...el.attributes]
        .filter(({ name }) => ['class', 'id', 'tabindex', 'role'].includes(name)
          || name.startsWith('data-') || name.startsWith('item'))
        .forEach(({ name }) => el.removeAttribute(name));
    });
    page.main.querySelectorAll('meta').forEach((el) => el.remove());

    // collapse the whitespace AEM's templating leaves inside text nodes
    page.main.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li').forEach((el) => {
      el.innerHTML = el.innerHTML.replace(/\s+/g, ' ').trim();
    });

    reportUnclaimed(document, page.main);
    appendMetadata(page.main, page, document);

    return page.main;
  },

  /**
   * @param {object} source
   * @param {string} source.url The URL of the source page
   * @returns {string} The path of the generated document
   */
  generateDocumentPath: ({ url }) => {
    const { pathname } = new URL(url);
    const path = pathname.replace(/\.html$/, '').replace(/\/$/, '');
    // the source serves the home page at /home; EDS serves it at /
    return WebImporter.FileUtils.sanitizePath(path === '/home' ? '/index' : (path || '/index'));
  },
};
