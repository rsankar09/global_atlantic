/* global WebImporter */

/*
 * PPM America -> EDS import transform.
 *
 * Emits the table shape the *xwalk* importer expects, which mirrors the MODEL
 * in each block's `_{block}.json`, not the visual shape of the source page:
 *
 *   simple block     one row per property (or property group), ONE cell each
 *   container block  one row per child item, that item's properties as cells
 *
 * Companion fields (`imageAlt`) collapse into their base property and never
 * get a cell of their own. Cells are positional, so every cell is emitted even
 * when the source has nothing for it -- a skipped cell shifts every later
 * property up by one and the content lands silently in the wrong field.
 *
 * Block contracts asserted in this file (property order taken from the model
 * files, which are the source of truth):
 *
 *   hero     blocks/hero/_hero.json       image(+imageAlt), text
 *                                         -> 2 rows x 1 cell   SIMPLE
 *   columns  blocks/columns/_columns.json columns/v1/columns
 *                                         -> 1 row x N cells
 *   stats    blocks/stats/_stats.json     item: figure, label
 *                                         -> 1 row per stat x 2 cells
 *   cards    blocks/cards/_cards.json     item: image(+imageAlt), text, link
 *                                         -> 1 row per card x 3 cells
 */

// ---------------------------------------------------------------------------
// contracts
// ---------------------------------------------------------------------------

/*
 * Cell counts derived from the model files. Kept next to the transforms so a
 * model change that is not mirrored here fails loudly at import time instead
 * of silently shifting content into the wrong property.
 */
const CONTRACT = {
  hero: { rows: 2, cells: 1 },
  stat: { cells: 2 },
  card: { cells: 3 },
  // columns is authored, not fixed -- but _columns.json templates columns="2",
  // rows="1", and both occurrences on this page are 2-up, so hold that shape.
  columns: { cells: 2 },
};

/**
 * Throws when an emitted row does not match the contract taken from the model.
 * @param {string} name Contract key
 * @param {Array} cells The row about to be emitted
 * @param {number} expected Expected cell count
 */
function assertCells(name, cells, expected) {
  if (cells.length !== expected) {
    throw new Error(`[import] ${name}: expected ${expected} cells, got ${cells.length}`);
  }
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
 * Replaces an element's tag while keeping its child nodes, so inline markup
 * such as a <sup> footnote marker survives. Used to demote the source's fake
 * headings (a stat label and a card eyebrow are not headings) without
 * flattening them to plain text.
 * @param {Element} el The element to retag
 * @param {string} tag The new tag name
 * @param {Document} document The document
 * @returns {Element} The replacement element
 */
function retag(el, tag, document) {
  const replacement = document.createElement(tag);
  replacement.append(...el.childNodes);
  el.replaceWith(replacement);
  return replacement;
}

/**
 * Returns the <img> for a source core-image component.
 *
 * Alt text is carried across verbatim and never synthesised. Every image on
 * this page ships `alt=""` because each one sits next to, or inside the same
 * link as, the text that names it -- copying that title into the alt would
 * make a screen reader announce it twice. Empty alts are reported by the QA
 * harness so an author can supply real alternatives where they are wanted.
 * @param {Element} scope Element containing the image
 * @returns {Element|null}
 */
function imageFrom(scope) {
  const img = scope?.querySelector('img.cmp-image__image, img');
  if (!img) return null;
  if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
  // strip AEM delivery plumbing; the importer resolves src to a real asset
  ['loading', 'class', 'itemprop', 'data-cmp-hook-image'].forEach((a) => img.removeAttribute(a));
  return img;
}

/**
 * Builds the page Metadata block.
 *
 * Hand-rolled rather than using WebImporter.rules.createMetadata because the
 * source emits <meta name="description"> twice with identical content, and
 * that helper concatenates duplicates into one doubled string.
 * @param {Element} main The main element
 * @param {Document} document The document
 */
function appendMetadata(main, document) {
  const content = (selector) => document.querySelector(selector)?.content?.trim() || '';

  const meta = {
    Title: document.querySelector('title')?.textContent.trim() || '',
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

  const rows = Object.entries(meta).filter(([, v]) => v).map(([k, v]) => [k, v]);
  if (rows.length) {
    main.append(WebImporter.DOMUtils.createTable([['Metadata'], ...rows], document));
  }
}

/**
 * Strips AEM authoring plumbing from the emitted markup.
 *
 * Source nodes are reused rather than rebuilt, so they arrive carrying
 * `class`, `id`, `data-cmp-*` and schema.org microdata. Left in place these
 * end up inside the imported richtext, and a stale `class` can collide with a
 * real block class once the page is served. createTable adds no attributes of
 * its own, so clearing these across `main` is safe.
 * @param {Element} main The main element
 */
function sanitize(main) {
  main.querySelectorAll('*').forEach((el) => {
    [...el.attributes]
      .filter(({ name }) => name === 'class' || name === 'id' || name.startsWith('data-')
        || name.startsWith('item'))
      .forEach(({ name }) => el.removeAttribute(name));
  });

  // collapse the whitespace AEM's templating leaves inside text nodes
  main.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li').forEach((el) => {
    el.innerHTML = el.innerHTML.replace(/\s+/g, ' ').trim();
  });
}

/**
 * Creates a section break (<hr>) plus an optional Section Metadata table.
 * @param {Element} parent Element to append to
 * @param {string[]} styles Section style values
 * @param {Document} document The document
 */
function endSection(parent, styles, document) {
  if (styles.length) {
    parent.append(WebImporter.DOMUtils.createTable([
      ['Section Metadata'],
      ['style', styles.join(', ')],
    ], document));
  }
  parent.append(document.createElement('hr'));
}

// ---------------------------------------------------------------------------
// component transforms
// ---------------------------------------------------------------------------

/**
 * cmp-002 hero -> `hero` block (reuse).
 *
 * SIMPLE block: the model is image(+imageAlt) then text, so this is TWO rows
 * of ONE cell -- not one row of two columns. Both shapes render identically
 * because hero.css only uses descendant selectors, so an error here is
 * invisible on the page and only shows up as the H1 landing in the image
 * property once the page is opened in Universal Editor.
 * @param {Element} el Source .cmp-hero
 * @param {Document} document The document
 * @returns {Element|null}
 */
function transformHero(el, document) {
  const title = el.querySelector('.cmp-hero__title');
  const img = imageFrom(el.querySelector('.cmp-hero__image'));

  const rows = [
    [img || ''],
    [title || ''],
  ];
  assertCells('hero', rows, CONTRACT.hero.rows);
  rows.forEach((row) => assertCells('hero row', row, CONTRACT.hero.cells));

  return WebImporter.DOMUtils.createTable([[blockName('Hero')], ...rows], document);
}

/**
 * cmp-003 intro-text-columns -> `columns` block, 33-66 variant (extend).
 *
 * One row, two cells: heading in the narrow column, body copy in the wide one.
 * The source marks the offset with aem-GridColumn--offset--default--4 on the
 * second text component; the variant class carries that intent in EDS.
 * @param {Element} el Source .cmp-container-columns-33-66
 * @param {Document} document The document
 * @returns {Element|null}
 */
function transformIntroColumns(el, document) {
  const texts = [...el.querySelectorAll(':scope .cmp-text')];
  if (texts.length < 2) return null;

  // the source pads the heading cell with a &nbsp; paragraph; drop it
  texts[0].querySelectorAll('p').forEach((p) => {
    if (!p.textContent.replace(/\u00a0/g, '').trim() && !p.querySelector('img, picture')) p.remove();
  });

  // pass the children, not the .cmp-text wrapper, so no AEM div survives
  const cells = [[...texts[0].children], [...texts[1].children]];
  assertCells('columns (33-66)', cells, CONTRACT.columns.cells);

  return WebImporter.DOMUtils.createTable([
    [blockName('Columns', ['columns-33-66'])],
    cells,
  ], document);
}

/**
 * Builds one `stats` block from a row of source .cmp-numbertext components.
 *
 * CONTAINER block: each stat is a row, and the stat model's two properties
 * (figure, label) are its two cells. The size variant is a block-level field,
 * so it goes in the block name -- not in a row.
 * @param {Element[]} items Source .cmp-numbertext elements
 * @param {boolean} small Whether this is the small size variant
 * @param {Document} document The document
 * @returns {Element|null}
 */
function buildStats(items, small, document) {
  if (!items.length) return null;

  const rows = items.map((item) => {
    // figure = pre-symbol + number + post-symbol, recombined into one string;
    // stats.js splits it back apart for styling
    const pre = item.querySelector('.cmp-numbertext__prestat-icon')?.textContent.trim() || '';
    const num = item.querySelector('.cmp-numbertext__text')?.textContent.trim() || '';
    const post = item.querySelector('.cmp-numbertext__poststat-icon')?.textContent.trim() || '';

    const figure = document.createElement('p');
    figure.textContent = `${pre}${num}${post}`;

    // the source marks the label as <h2>; it is a caption, not a heading, and
    // the <sup> footnote marker must survive the demotion
    const source = item.querySelector('.cmp-numbertext__stattext');
    let label = '';
    if (source) {
      label = retag(source, 'p', document);
      label.innerHTML = label.innerHTML.trim();
    }

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
 * cmp-005 staticcard -> `cards` block (extend).
 *
 * CONTAINER block: each card is a row of three cells, matching the card
 * model's image(+imageAlt), text, link. The trailing link cell is emitted
 * even when the source card is not linked, so that appending a property to
 * the model later cannot shift content into the wrong field.
 * @param {Element[]} items Source .cmp-card elements
 * @param {Document} document The document
 * @returns {Element|null}
 */
function buildCards(items, document) {
  if (!items.length) return null;

  const rows = items.map((card) => {
    const eyebrow = card.querySelector('.cmp-card__pretitle');
    const title = card.querySelector('.cmp-card__title');
    const img = imageFrom(card.querySelector('.cmp-card__image'));

    // accessibility: the source nests <h2> eyebrow + <h2> title under the
    // section's <h3>. Demote the eyebrow to a paragraph and make the title
    // an <h3> so the outline is heading-ordered; cards.css styles the
    // leading paragraph as the pretitle.
    const body = [];
    if (eyebrow) body.push(retag(eyebrow, 'p', document));
    if (title) body.push(retag(title, 'h3', document));

    // whole-card link: the source wraps the card in one <a>
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
    [blockName('Cards', ['square', 'plain'])],
    ...rows,
  ], document);
}

/**
 * cmp-006 staticcard-left -> `columns` block, flush variant (extend).
 *
 * One row, two cells: the cover image, then the body (eyebrow, bullet list)
 * followed by the CTA. The CTA stays a separate element in the same cell so
 * it maps to the column filter's `button` component rather than being
 * swallowed into the text richtext.
 * @param {Element} el Source .cmp-card inside .cmp-card--left
 * @param {Document} document The document
 * @returns {Element|null}
 */
function transformPromo(el, document) {
  const eyebrow = el.querySelector('.cmp-card__pretitle');
  const img = imageFrom(el.querySelector('.cmp-card__image'));

  const body = [];
  if (eyebrow) body.push(retag(eyebrow, 'p', document));

  const description = el.querySelector('.cmp-card__description');
  if (description) {
    // the source wraps every bullet's text in its own <p>; unwrap so the list
    // imports as a plain <ul><li>text</li></ul>
    description.querySelectorAll('li > p:only-child').forEach((p) => p.replaceWith(...p.childNodes));
    body.push(...description.children);
  }

  // CTA -> the boilerplate's strong+em button convention (primary button)
  const cta = el.querySelector('.cmp-card__action-container a');
  if (cta) {
    const a = document.createElement('a');
    a.href = cta.getAttribute('href');
    a.textContent = cta.textContent.trim();
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    const em = document.createElement('em');
    em.append(a);
    strong.append(em);
    p.append(strong);
    body.push(p);
  }

  const cells = [img || '', body];
  assertCells('columns (flush)', cells, CONTRACT.columns.cells);

  return WebImporter.DOMUtils.createTable([
    [blockName('Columns', ['flush'])],
    cells,
  ], document);
}

// ---------------------------------------------------------------------------
// page transform
// ---------------------------------------------------------------------------

export default {
  /**
   * @param {object} source
   * @param {HTMLDocument} source.document The source document
   * @returns {HTMLElement} The root element to be converted
   */
  transformDOM: ({ document }) => {
    const main = document.createElement('main');

    // --- section 1: hero ---------------------------------------------------
    const hero = document.querySelector('.cmp-hero');
    if (hero) {
      const table = transformHero(hero, document);
      if (table) {
        main.append(table);
        endSection(main, [], document);
      }
    }

    // --- section 2: intro ---------------------------------------------------
    const intro = document.querySelector('.cmp-container-columns-33-66');
    if (intro && intro.querySelector('.cmp-text')) {
      const table = transformIntroColumns(intro, document);
      if (table) {
        main.append(table);
        endSection(main, [], document);
      }
    }

    // --- sections 3 & 4: the teal stats band --------------------------------
    /*
     * One source panel, two EDS sections. The teal panel holds a large 4-up
     * row, a separator, then a heading beside a small 4-up row. Splitting at
     * the separator lets each row be one `stats` block and turns the source's
     * <hr> and its 33/66 heading layout into section styles (`divided`,
     * `split-33-66`) rather than block markup.
     */
    const band = document.querySelector('.cmp-container--teal-theme');
    if (band) {
      const groups = [...band.querySelectorAll('.cmp-container-columns-4-equal')];
      groups.forEach((group, i) => {
        const items = [...group.querySelectorAll('.cmp-numbertext')];
        const small = items.some((n) => n.closest('.cmp-numbertext--small'));

        // a heading that sits beside this row (source: the 33/66 container)
        const beside = group.closest('.cmp-container-columns-33-66')?.querySelector('.cmp-title__text');
        if (beside) main.append(retag(beside, 'h2', document));

        const table = buildStats(items, small, document);
        if (!table) return;
        main.append(table);

        const styles = ['dark'];
        // every row after the first replaces the source separator with a rule
        if (i > 0) styles.push('divided');
        if (beside) styles.push('split-33-66');
        endSection(main, styles, document);
      });
    }

    // --- section 5: insights cards ------------------------------------------
    const cardGrid = document.querySelector('.cmp-container-columns-3-equal');
    if (cardGrid) {
      /*
       * The "Our Insights" H3 sits above the grid in the source and the
       * inventory drew the component boundary around it, so lift it out as
       * section default content rather than folding it into the block.
       * Scoped to the shared parent of the title and the grid so it cannot
       * pick up a title belonging to some other part of the page.
       */
      const heading = cardGrid.parentElement?.querySelector(':scope > .title .cmp-title__text');
      if (heading) main.append(retag(heading, 'h3', document));

      const table = buildCards([...cardGrid.querySelectorAll('.cmp-card')], document);
      if (table) {
        main.append(table);
        endSection(main, [], document);
      }
    }

    // --- section 6: our advantage promo -------------------------------------
    const promo = document.querySelector('.cmp-card--left .cmp-card');
    if (promo) {
      const table = transformPromo(promo, document);
      if (table) {
        main.append(table);
        endSection(main, ['light', 'flush'], document);
      }
    }

    // --- trailing disclaimer -------------------------------------------------
    /*
     * Plain default content; no block needed. It still needs its own section
     * metadata: the footnotes continue the light band started by the promo
     * above, and without the style the section renders unthemed against the
     * page default.
     */
    const disclaimer = document.querySelector('.cmp-text__source .cmp-text');
    if (disclaimer) {
      main.append(...disclaimer.childNodes);
      endSection(main, ['light'], document);
    }

    // a trailing <hr> from the last endSection would create an empty section
    if (main.lastElementChild?.tagName === 'HR') main.lastElementChild.remove();

    sanitize(main);
    appendMetadata(main, document);

    /*
     * cmp-001 header and cmp-007 footer never reach `main`: this transform
     * selects the page components it wants rather than filtering a copy of the
     * body, so site-global chrome is excluded by construction. Both are
     * authored as the /nav and /footer fragments and are imported separately.
     */

    return main;
  },

  /**
   * @param {object} source
   * @param {string} source.url The URL of the source page
   * @returns {string} The path of the generated document
   */
  generateDocumentPath: ({ url }) => {
    const { pathname } = new URL(url);
    const path = pathname.replace(/\.html$/, '').replace(/\/$/, '');
    return WebImporter.FileUtils.sanitizePath(path || '/index');
  },
};
