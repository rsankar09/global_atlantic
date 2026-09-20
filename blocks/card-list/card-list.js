import { createOptimizedPicture, loadCSS, toClassName } from '../../scripts/aem.js';

/*
 * Markup contract. Unlike `cards`, nothing here is authored per item — the
 * items come from the query index at request time, so the block authors only
 * the query. The model declares `path`, `category` and `limit`, three separate
 * field groups, which the two surfaces deliver very differently:
 *
 *   Universal Editor                    Document authoring
 *   div.card-list                       div.card-list
 *     > div > div  <a>/blog</a>           > div > div "Path"     > div "/blog"
 *     > div > div  "Blog"                 > div > div "Category" > div "Blog"
 *     > div > div  "9"                    > div > div "Limit"    > div "9"
 *     = 3 rows x 1 cell, model order      = 3 rows x 2 cells, key + value
 *
 * That difference is why this block cannot use readBlockConfig(): that helper
 * requires a second cell per row and returns {} when there is only one, so in
 * the editor the block would silently lose its path filter, its category and
 * its limit, and list the entire site index instead. It renders a perfectly
 * plausible grid while doing so, which is precisely why it needs asserting
 * rather than eyeballing.
 *
 * The rendered items reuse the `cards` markup contract and stylesheet rather
 * than carrying a second copy of it: the listing grid and the authored grid are
 * the same component visually, and letting them drift apart is the failure mode
 * worth designing against. That is why the block adds the `cards` and `plain`
 * classes to itself and loads cards.css.
 */

const INDEX_PATH = '/query-index.json';
const DEFAULT_LIMIT = 9;

let indexPromise;

/**
 * Reads a cell as plain trimmed text.
 * @param {Element} cell The source cell
 * @returns {string}
 */
function cellText(cell) {
  return (cell?.textContent || '').trim();
}

/**
 * Reads a cell as a site path. The editor's `aem-content` field delivers an
 * anchor rather than text, and an anchor's `href` property resolves to an
 * absolute URL — which would never prefix-match the site-relative paths the
 * query index stores, silently emptying the list. Normalising through URL
 * handles both the anchor and the plain-text cases.
 * @param {Element} cell The source cell
 * @returns {string} A site-relative path, or ''
 */
function cellPath(cell) {
  if (!cell) return '';
  const anchor = cell.querySelector('a[href]');
  const raw = (anchor ? anchor.getAttribute('href') : cell.textContent) || '';
  const value = raw.trim();
  if (!value) return '';
  try {
    return new URL(value, window.location.origin).pathname;
  } catch (e) {
    return value;
  }
}

/**
 * Reads the authored configuration from whichever shape the surface delivered.
 * @param {Element} block The block element
 * @returns {{path: string, category: string, limit: string}}
 */
function readConfig(block) {
  const rows = [...block.querySelectorAll(':scope > div')];

  // a key/value table has a second cell; the editor's one-cell rows do not
  if (rows.some((row) => row.children.length > 1)) {
    const byKey = {};
    rows.forEach((row) => {
      const [keyCell, valueCell] = row.children;
      if (valueCell) byKey[toClassName(cellText(keyCell))] = valueCell;
    });
    return {
      path: cellPath(byKey.path),
      category: cellText(byKey.category),
      limit: cellText(byKey.limit),
    };
  }

  // otherwise the cells are the model's fields, in the order it declares them
  const [path, category, limit] = rows.map((row) => row.firstElementChild);
  return {
    path: cellPath(path),
    category: cellText(category),
    limit: cellText(limit),
  };
}

/**
 * Fetches the query index once per page. A failure resolves to an empty list so
 * the block renders nothing rather than throwing into the section loader.
 * @returns {Promise<Array<object>>}
 */
function fetchIndex() {
  if (!indexPromise) {
    indexPromise = fetch(INDEX_PATH)
      .then((resp) => (resp.ok ? resp.json() : { data: [] }))
      .then((json) => json.data || [])
      .catch(() => []);
  }
  return indexPromise;
}

/**
 * Renders an index timestamp as a display date. The index stores seconds, and
 * an unparseable or missing value yields an empty string so the meta line
 * simply loses that segment.
 * @param {string|number} value The indexed timestamp
 * @returns {string} A formatted date, or ''
 */
function formatDate(value) {
  const seconds = Number(value);
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Builds the `CATEGORY | DATE | N MIN.` line the source prints above every card
 * title. Segments the index does not carry are dropped rather than left blank.
 * @param {object} row An index row
 * @returns {string} The assembled meta line
 */
function metaLine(row) {
  return [row.category, formatDate(row.publishDate), row.readTime]
    .map((part) => (part || '').toString().trim())
    .filter(Boolean)
    .join(' | ');
}

/**
 * Builds one card, matching the DOM that blocks/cards/cards.js produces.
 * @param {object} row An index row
 * @returns {HTMLLIElement} The card
 */
function buildCard(row) {
  const item = document.createElement('li');

  const link = document.createElement('a');
  link.className = 'cards-card-link';
  link.href = row.path;

  if (row.image) {
    const media = document.createElement('div');
    media.className = 'cards-card-image';
    /*
     * The card's accessible name comes from the title and copy inside the same
     * link, so the thumbnail is decorative here. Giving it the headline as alt
     * text would make a screen reader read the headline twice.
     */
    media.append(createOptimizedPicture(row.image, '', false, [{ width: '750' }]));
    link.append(media);
  }

  const body = document.createElement('div');
  body.className = 'cards-card-body';

  const meta = metaLine(row);
  if (meta) {
    const eyebrow = document.createElement('p');
    eyebrow.className = 'cards-card-eyebrow';
    eyebrow.textContent = meta;
    body.append(eyebrow);
  }

  const title = document.createElement('h3');
  title.textContent = row.title || '';
  body.append(title);

  if (row.description) {
    const description = document.createElement('p');
    description.textContent = row.description;
    body.append(description);
  }

  link.append(body);
  item.append(link);
  return item;
}

/**
 * Selects and orders the rows this block should show.
 * @param {Array<object>} rows Every index row
 * @param {object} config The authored block configuration
 * @returns {Array<object>} The matching rows, newest first
 */
function selectRows(rows, config) {
  const prefix = config.path;
  const category = config.category.toLowerCase();
  const here = window.location.pathname;

  return rows
    .filter((row) => row.path && row.path !== here)
    // a listing page sits at the root of the paths it lists, so exclude itself
    .filter((row) => !prefix || (row.path.startsWith(prefix) && row.path !== prefix))
    .filter((row) => !category || (row.category || '').toLowerCase() === category)
    .sort((a, b) => Number(b.publishDate || 0) - Number(a.publishDate || 0));
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const config = readConfig(block);
  const limit = Number.parseInt(config.limit, 10) || DEFAULT_LIMIT;

  block.textContent = '';
  /*
   * Borrow the cards presentation wholesale. `plain` is the borderless variant
   * the source's listing grid uses; the stylesheet is loaded explicitly because
   * the section loader only loads the stylesheet named after the block.
   */
  block.classList.add('cards', 'plain');
  await loadCSS(`${window.hlx.codeBasePath}/blocks/cards/cards.css`);

  const rows = selectRows(await fetchIndex(), config);

  const list = document.createElement('ul');
  block.append(list);

  /*
   * Result count lives in a polite live region: when "Load more" appends items
   * further down the page, a screen-reader user gets told what happened instead
   * of being left to discover it.
   */
  const status = document.createElement('p');
  status.className = 'card-list-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  let shown = 0;

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'button secondary card-list-more';
  more.textContent = 'Load more';

  const showNext = () => {
    const next = rows.slice(shown, shown + limit);
    // focus moves to the first newly revealed card so the keyboard does not
    // jump back to the top of the list
    const first = next.length ? buildCard(next[0]) : null;
    if (first) list.append(first);
    next.slice(1).forEach((row) => list.append(buildCard(row)));
    shown += next.length;

    status.textContent = `Showing ${shown} of ${rows.length}`;
    more.hidden = shown >= rows.length;
    return first;
  };

  showNext();

  more.addEventListener('click', () => {
    const first = showNext();
    const target = first?.querySelector('a');
    if (target) target.focus();
  });

  if (!rows.length) {
    status.textContent = 'No matching items.';
  }

  block.append(status);
  if (rows.length > limit) block.append(more);
}
