import { decorateMain } from '../../scripts/scripts.js';
import { loadSections } from '../../scripts/aem.js';

const DEFAULT_NAV = `
<div>
  <p>
    /home
      <imgns/ppm-logo.svg
    </a>
  </p>
</div>

<div>
  <ul>
    <li>
      <a vestment-solutionsInvestment Solutions</a>
      <ul>
        <li>/investment-solutions/fixed-incomePublic Fixed Income</a></li>
        <li><a href="/investments/commercial-real-estate-debtCommercial Real Estate Debt</a></li>
        <li>/investment-solutions/private-and-structured-creditPrivate and Structured Credit</a></li>
        <li>/investment-solutions/private-equityPrivate Equity</a></li>
        <li>/investment-solutions/collateralized-loan-obligationsCollateralized Loan Obligations</a></li>
      </ul>
    </li>

    <li>
      /news-and-insightsNews & Insights</a>
      <ul>
        <li>/news-and-insights/blogBlog</a></li>
        <li>/news-and-insights/market-insightsMarket Insights</a></li>
        <li>/news-and-insights/press-releasesPress Releases</a></li>
      </ul>
    </li>

    <li>
      /our-commitmentsOur Commitments</a>
      <ul>
        <li>/our-commitments/responsible-investmentResponsible Investment</a></li>
        <li>/our-commitments/community-engagementCommunity Engagement</a></li>
        <li>/our-commitments/inclusion-and-engagementInclusion and Engagement</a></li>
      </ul>
    </li>

    <li>
      <a href="/our-story">Our      <ul>
        <li>/our-story/our-valuesOur Values</a></li>
        <li>/our-story/our-teamOur Team</a></li>
        <li>/our-story/careersCareers</a></li>
        <li>/our-story/contact-usContact Us</a></li>
      </ul>
    </li>
  </ul>
</div>

<div>
  <p>/searchSearch</a></p>
</div>
`;

async function buildNav() {
  const main = document.createElement('main');
  main.innerHTML = DEFAULT_NAV;
  decorateMain(main);
  await loadSections(main);
  return main;
}

export default async function decorate(block) {
  const fragment = await buildNav();

  block.textContent = '';

  const nav = document.createElement('nav');
  nav.id = 'nav';

  while (fragment.firstElementChild) {
    nav.append(fragment.firstElementChild);
  }

  const classes = ['brand', 'sections', 'tools'];

  classes.forEach((name, index) => {
    if (nav.children[index]) {
      nav.children[index].classList.add(`nav-${name}`);
    }
  });

  const hamburger = document.createElement('div');

  hamburger.className = 'nav-hamburger';

  hamburger.innerHTML = `
    <button
      type="button"
      aria-controls="nav"
      aria-label="Open navigation">
      <span class="nav-hamburger-icon"></span>
    </button>
  `;

  nav.prepend(hamburger);

  hamburger.querySelector('button').addEventListener('click', () => {
    const expanded = nav.getAttribute('aria-expanded') === 'true';

    nav.setAttribute(
      'aria-expanded',
      expanded ? 'false' : 'true',
    );
  });

  nav.setAttribute('aria-expanded', 'false');

  const wrapper = document.createElement('div');

  wrapper.className = 'nav-wrapper';

  wrapper.append(nav);

  block.append(wrapper);
}