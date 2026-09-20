import { getMetadata, loadSections } from '../../scripts/aem.js';
// eslint-disable-next-line import/no-cycle
import { decorateMain } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/*
 * Fallback footer, used only when no `/footer` document can be loaded — the
 * same arrangement as blocks/header/header.js, and for the same reason: a
 * missing fragment otherwise throws out of decorate() and leaves the block
 * empty while still reporting `data-block-status="loaded"`.
 *
 * An authored document always wins. The two rows below are the contract
 * footer.css styles: logo / address / social, then copyright / policy links.
 *
 * Keep in sync with drafts/ppm-footer.plain.html, or delete both once
 * /footer is authored in AEM.
 */
const DEFAULT_FOOTER = `
  <div>
    <p><a href="/" title="PPM America">PPM America</a></p>
    <ul>
      <li>225 West Wacker Drive</li>
      <li>Suite 1200</li>
      <li>Chicago, IL 60606</li>
      <li><a href="tel:+13126342500">312-634-2500</a></li>
    </ul>
    <p><a href="https://www.linkedin.com/company/ppm-america" title="Visit our LinkedIn page">LinkedIn</a></p>
  </div>
  <div>
    <p>&copy; 2026 PPM America, Inc. All rights reserved.</p>
    <ul>
      <li><a href="/our-story/contact-us">Contact Us</a></li>
      <li><a href="/privacy-policy">Privacy Policy</a></li>
      <li><a href="/terms-and-conditions">Terms and Conditions</a></li>
      <li><a href="/social">Social</a></li>
    </ul>
  </div>`;

/**
 * Decorates a footer markup string through the same pipeline loadFragment()
 * uses, so the fallback and an authored document deliver an identical DOM —
 * footer.css addresses `.section:first-child` / `:last-child`, and those
 * wrappers come from decorateMain(), not from this markup.
 * @param {string} html The footer markup
 * @returns {Promise<Element>} A decorated <main>
 */
async function buildFallbackFooter(html) {
  const main = document.createElement('main');
  main.innerHTML = html;
  decorateMain(main);
  await loadSections(main);
  return main;
}

/**
 * loads and decorates the footer
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  // load footer as fragment, falling back to DEFAULT_FOOTER when none exists
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
  // const fragment = await loadFragment(footerPath) || await buildFallbackFooter(DEFAULT_FOOTER);
  const fragment =  await buildFallbackFooter(DEFAULT_FOOTER);

  // decorate footer DOM
  block.textContent = '';
  const footer = document.createElement('div');
  while (fragment.firstElementChild) footer.append(fragment.firstElementChild);

  block.append(footer);
}
