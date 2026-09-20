import { getMetadata } from '../../scripts/aem.js';

/*
 * Markup contract. The trail is derived from the URL rather than authored,
 * because it appears on 125 of the 169 migrated pages and retyping it on each
 * one guarantees drift. The block is authored empty:
 *
 *   div.breadcrumbs
 *
 * An author overrides the leaf label with the page's `breadcrumb-title`
 * metadata; everything above the leaf is named by the query index.
 *
 * Rendering is synchronous and needs no network: the trail is built from the
 * path immediately, then link labels are upgraded in place once the index
 * resolves. That ordering matters — breadcrumbs sit near the top of the page,
 * so blocking their first paint on a fetch would put a request in front of LCP.
 */

const INDEX_PATH = '/query-index.json';

/*
 * Segments that must not be sentence-cased when the trail falls back to the
 * URL. These are the abbreviations that actually occur in PPM's paths; the
 * query index replaces the guess as soon as it lands, so this list only has to
 * be good enough for the brief window before that happens.
 */
const ACRONYMS = new Set([
  'ai', 'cio', 'clo', 'cmbs', 'cre', 'em', 'emd', 'esg', 'etf',
  'igpc', 'ig', 'ldi', 'ma', 'us',
]);

let indexPromise;

/**
 * Turns one URL segment into a human label, e.g. `investment-solutions` into
 * `Investment Solutions`. A placeholder only — see refineLabels.
 * @param {string} segment A single decoded path segment
 * @returns {string} The fallback label
 */
function labelFromSegment(segment) {
  return segment
    .split('-')
    .map((word) => (ACRONYMS.has(word)
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * Fetches the query index once per page and reduces it to path -> title.
 * Failures resolve to an empty map so the derived labels simply stand.
 * @returns {Promise<Map<string, string>>}
 */
function fetchTitles() {
  if (!indexPromise) {
    indexPromise = fetch(INDEX_PATH)
      .then((resp) => (resp.ok ? resp.json() : { data: [] }))
      .then((json) => new Map(
        (json.data || [])
          .filter((row) => row.path && row.title)
          .map((row) => [row.path, row.title]),
      ))
      .catch(() => new Map());
  }
  return indexPromise;
}

/**
 * Replaces each derived ancestor label with the authored page title. Runs after
 * paint, so a slow or missing index degrades to the path-derived trail instead
 * of an empty one.
 * @param {Element} block The decorated block
 */
async function refineLabels(block) {
  const links = [...block.querySelectorAll('a[data-breadcrumb-path]')];
  if (!links.length) return;
  const titles = await fetchTitles();
  links.forEach((link) => {
    const title = titles.get(link.dataset.breadcrumbPath);
    if (title) link.textContent = title;
  });
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  block.textContent = '';

  const segments = window.location.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment.replace(/\.html$/, '')));

  // the home page is the root of the trail, so it has nothing to show
  if (!segments.length) return;

  const crumbs = [{ path: '/', label: 'Home' }];
  segments.forEach((segment, i) => {
    crumbs.push({
      path: `/${segments.slice(0, i + 1).join('/')}`,
      label: labelFromSegment(segment),
    });
  });

  // the leaf names the current page, which the page itself already knows
  const leafTitle = getMetadata('breadcrumb-title') || getMetadata('og:title');
  if (leafTitle) crumbs[crumbs.length - 1].label = leafTitle;

  const nav = document.createElement('nav');
  // distinguishes this landmark from the site nav for screen-reader users
  nav.setAttribute('aria-label', 'Breadcrumb');

  const list = document.createElement('ol');
  crumbs.forEach((crumb, i) => {
    const item = document.createElement('li');
    if (i === crumbs.length - 1) {
      /*
       * The current page is not a link — a link to where you already are is
       * noise in a screen reader's link list — but it must still be announced
       * as the current item, hence aria-current rather than a bare <span>.
       */
      const current = document.createElement('span');
      current.setAttribute('aria-current', 'page');
      current.textContent = crumb.label;
      item.append(current);
    } else {
      const link = document.createElement('a');
      link.href = crumb.path;
      link.textContent = crumb.label;
      link.dataset.breadcrumbPath = crumb.path;
      item.append(link);
    }
    list.append(item);
  });

  nav.append(list);
  block.append(nav);

  refineLabels(block);
}
