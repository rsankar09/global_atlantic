import { getMetadata, loadSections } from '../../scripts/aem.js';
// eslint-disable-next-line import/no-cycle
import { decorateMain } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/*
 * Fallback nav, used only when no `/nav` document can be loaded.
 *
 * The nav is normally authored content: `loadFragment()` fetches the document
 * named by the page's `nav` metadata, falling back to `/nav`. That remains the
 * source of truth — an authored document always wins over this constant, and
 * nothing here is reachable once one exists.
 *
 * This exists because the boilerplate treats a missing fragment as fatal:
 * `loadFragment` resolves to `null` on a non-ok fetch, and reading
 * `firstElementChild` off it throws out of decorate() before any markup is
 * produced. The block is then left empty with `data-block-status="loaded"`,
 * which reads as a broken header rather than as absent content.
 *
 * The shape mirrors what the /nav document must author, because it is fed
 * through the same decorateMain() pipeline: three sections in the order
 * header.js assigns them — brand, sections, tools — with the second level as
 * a nested <ul>, which becomes .nav-drop.
 *
 * Keep this in sync with drafts/ppm-nav.plain.html, or delete both once /nav
 * is authored in AEM.
 */
const DEFAULT_NAV = `
  <div>
    <p>
    <a href="/" title="PPM America">PPM America</a>
    <a class="cmp-image__link" data-cmp-clickable="" href="/home">
        <img src="/content/dam/gademo/ppmlogo.png" loading="lazy" class="cmp-image__image" itemprop="contentUrl" width="1108" height="167" alt="PPM Logo">
    </a>
    </p>
  </div>
  <div>
    <ul>
      <li>
        <a href="/investment-solutions">Investment Solutions</a>
        <ul>
          <li><a href="/investment-solutions/fixed-income">Public Fixed Income</a></li>
          <li><a href="/investment-solutions/commercial-real-estate-debt">Commercial Real Estate Debt</a></li>
          <li><a href="/investment-solutions/private-and-structured-credit">Private and Structured Credit</a></li>
          <li><a href="/investment-solutions/private-equity">Private Equity</a></li>
          <li><a href="/investment-solutions/collateralized-loan-obligations">Collateralized Loan Obligations</a></li>
        </ul>
      </li>
      <li>
        <a href="/news-and-insights">News and Insights</a>
        <ul>
          <li><a href="/news-and-insights/blog">Blog</a></li>
          <li><a href="/news-and-insights/market-insights">Market Insights</a></li>
          <li><a href="/news-and-insights/press-releases">Press Releases</a></li>
        </ul>
      </li>
      <li>
        <a href="/our-commitments">Our Commitments</a>
        <ul>
          <li><a href="/our-commitments/responsible-investment">Responsible Investment</a></li>
          <li><a href="/our-commitments/community-engagement">Community Engagement</a></li>
          <li><a href="/our-commitments/inclusion-and-engagement">Inclusion and Engagement</a></li>
        </ul>
      </li>
      <li>
        <a href="/our-story">Our Story</a>
        <ul>
          <li><a href="/our-story/our-values">Our Values</a></li>
          <li><a href="/our-story/our-team">Our Team</a></li>
          <li><a href="/our-story/careers">Careers</a></li>
          <li><a href="/our-story/contact-us">Contact Us</a></li>
        </ul>
      </li>
    </ul>
  </div>
  <div>
    <p><a href="/search" title="Search">Search</a></p>
  </div>`;

/**
 * Decorates a nav markup string through the same pipeline loadFragment() uses,
 * so the fallback and an authored document deliver an identical DOM — the
 * `.section` and `.default-content-wrapper` wrappers every nav CSS selector
 * depends on are produced by decorateMain(), not by this markup.
 * @param {string} html The nav markup
 * @returns {Promise<Element>} A decorated <main>
 */
async function buildFallbackNav(html) {
  const main = document.createElement('main');
  main.innerHTML = html;
  decorateMain(main);
  await loadSections(main);
  return main;
}

// media query match that indicates mobile/tablet width
let isDesktop = window.matchMedia('(min-width: 900px)');

/**
 * Re-points the desktop breakpoint at the themed `--nav-desktop-min`, so a
 * theme whose nav needs more room than the 900px default keeps the hamburger
 * until its items actually fit. Called once from decorate(), by which point
 * decorateTemplateAndTheme() has already put the theme class on <body>.
 */
function resolveDesktopBreakpoint() {
  const configured = getComputedStyle(document.body)
    .getPropertyValue('--nav-desktop-min')
    .trim();
  if (configured) isDesktop = window.matchMedia(`(min-width: ${configured})`);
}

function closeOnEscape(e) {
  if (e.code === 'Escape') {
    const nav = document.getElementById('nav');
    const navSections = nav.querySelector('.nav-sections');
    if (!navSections) return;
    const navSectionExpanded = navSections.querySelector('[aria-expanded="true"]');
    if (navSectionExpanded && isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleAllNavSections(navSections);
      navSectionExpanded.focus();
    } else if (!isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleMenu(nav, navSections);
      nav.querySelector('button').focus();
    }
  }
}

function closeOnFocusLost(e) {
  const nav = e.currentTarget;
  if (!nav.contains(e.relatedTarget)) {
    const navSections = nav.querySelector('.nav-sections');
    if (!navSections) return;
    const navSectionExpanded = navSections.querySelector('[aria-expanded="true"]');
    if (navSectionExpanded && isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleAllNavSections(navSections, false);
    } else if (!isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleMenu(nav, navSections, false);
    }
  }
}

function openOnKeydown(e) {
  const focused = document.activeElement;
  const isNavDrop = focused.className === 'nav-drop';
  if (isNavDrop && (e.code === 'Enter' || e.code === 'Space')) {
    const dropExpanded = focused.getAttribute('aria-expanded') === 'true';
    // eslint-disable-next-line no-use-before-define
    toggleAllNavSections(focused.closest('.nav-sections'));
    focused.setAttribute('aria-expanded', dropExpanded ? 'false' : 'true');
  }
}

function focusNavSection() {
  document.activeElement.addEventListener('keydown', openOnKeydown);
}

/**
 * A top-level nav item that is itself a link is a destination: clicking it has
 * to navigate rather than toggle its flyout, and it is already in the tab
 * order, so it must not also be made focusable as a disclosure. Such an item
 * opens its flyout from CSS (:hover / :focus-within) instead.
 * @param {Element} navSection The top-level <li>
 * @returns {Boolean} true when the item links somewhere
 */
function isDestination(navSection) {
  return !!navSection.querySelector(':scope > a[href]');
}

/**
 * Toggles all nav sections
 * @param {Element} sections The container element
 * @param {Boolean} expanded Whether the element should be expanded or collapsed
 */
function toggleAllNavSections(sections, expanded = false) {
  if (!sections) return;
  sections.querySelectorAll('.nav-sections .default-content-wrapper > ul > li').forEach((section) => {
    section.setAttribute('aria-expanded', expanded);
  });
}

/**
 * Toggles the entire nav
 * @param {Element} nav The container element
 * @param {Element} navSections The nav sections within the container element
 * @param {*} forceExpanded Optional param to force nav expand behavior when not null
 */
function toggleMenu(nav, navSections, forceExpanded = null) {
  const expanded = forceExpanded !== null ? !forceExpanded : nav.getAttribute('aria-expanded') === 'true';
  const button = nav.querySelector('.nav-hamburger button');
  document.body.style.overflowY = (expanded || isDesktop.matches) ? '' : 'hidden';
  nav.setAttribute('aria-expanded', expanded ? 'false' : 'true');
  toggleAllNavSections(navSections, expanded || isDesktop.matches ? 'false' : 'true');
  button.setAttribute('aria-label', expanded ? 'Open navigation' : 'Close navigation');
  // enable nav dropdown keyboard accessibility
  if (navSections) {
    const navDrops = navSections.querySelectorAll('.nav-drop');
    if (isDesktop.matches) {
      navDrops.forEach((drop) => {
        if (isDestination(drop)) return;
        if (!drop.hasAttribute('tabindex')) {
          drop.setAttribute('tabindex', 0);
          drop.addEventListener('focus', focusNavSection);
        }
      });
    } else {
      navDrops.forEach((drop) => {
        drop.removeAttribute('tabindex');
        drop.removeEventListener('focus', focusNavSection);
      });
    }
  }

  // enable menu collapse on escape keypress
  if (!expanded || isDesktop.matches) {
    // collapse menu on escape press
    window.addEventListener('keydown', closeOnEscape);
    // collapse menu on focus lost
    nav.addEventListener('focusout', closeOnFocusLost);
  } else {
    window.removeEventListener('keydown', closeOnEscape);
    nav.removeEventListener('focusout', closeOnFocusLost);
  }
}

/**
 * loads and decorates the header, mainly the nav
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  resolveDesktopBreakpoint();

  // load nav as fragment, falling back to DEFAULT_NAV when none is published
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  // const fragment = await loadFragment(navPath) || await buildFallbackNav(DEFAULT_NAV);
  const fragment = await buildFallbackNav(DEFAULT_NAV);

  // decorate nav DOM
  block.textContent = '';
  const nav = document.createElement('nav');
  nav.id = 'nav';
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);

  const classes = ['brand', 'sections', 'tools'];
  classes.forEach((c, i) => {
    const section = nav.children[i];
    if (section) section.classList.add(`nav-${c}`);
  });

  const navBrand = nav.querySelector('.nav-brand');
  const brandLink = navBrand.querySelector('.button');
  if (brandLink) {
    brandLink.className = '';
    brandLink.closest('.button-container').className = '';
  }

  const navSections = nav.querySelector('.nav-sections');
  if (navSections) {
    navSections.querySelectorAll(':scope .default-content-wrapper > ul > li').forEach((navSection) => {
      navSection.classList.toggle('nav-drop', !!navSection.querySelector('ul'));
      if (isDestination(navSection)) return;
      navSection.addEventListener('click', () => {
        if (isDesktop.matches) {
          const expanded = navSection.getAttribute('aria-expanded') === 'true';
          toggleAllNavSections(navSections);
          navSection.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        }
      });
    });
  }

  // hamburger for mobile
  const hamburger = document.createElement('div');
  hamburger.classList.add('nav-hamburger');
  hamburger.innerHTML = `<button type="button" aria-controls="nav" aria-label="Open navigation">
      <span class="nav-hamburger-icon"></span>
    </button>`;
  hamburger.addEventListener('click', () => toggleMenu(nav, navSections));
  nav.prepend(hamburger);
  nav.setAttribute('aria-expanded', 'false');
  // prevent mobile nav behavior on window resize
  toggleMenu(nav, navSections, isDesktop.matches);
  isDesktop.addEventListener('change', () => toggleMenu(nav, navSections, isDesktop.matches));

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);
}
