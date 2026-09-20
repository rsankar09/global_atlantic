/* eslint-disable no-console */
/**
 * Runs axe-core (WCAG 2.1 A/AA) against the local dev server and dumps the
 * decorated DOM outline, so the audit sees what the browser sees rather than
 * the pre-decoration fixture HTML.
 *
 * Usage: node tools/a11y-scan.mjs <url>
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';

const axePath = new URL('../../node_modules/axe-core/axe.min.js', import.meta.url);
const axeSource = readFileSync(axePath, 'utf8');

const url = process.argv[2] || 'http://localhost:3000/drafts/ppm-home';
const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const out = { url, viewports: {} };

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.addScriptTag({ content: axeSource });

  const results = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  }));

  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    wcag: v.tags.filter((t) => t.startsWith('wcag')).join(','),
    nodes: v.nodes.slice(0, 6).map((n) => ({
      target: n.target.join(' '),
      html: n.html.slice(0, 200),
      summary: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 300),
    })),
    count: v.nodes.length,
  }));

  // decorated structure the fixture cannot show
  const structure = await page.evaluate(() => {
    const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    return {
      lang: document.documentElement.lang,
      title: document.title,
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
        .map((h) => `${h.tagName} ${txt(h)}`),
      landmarks: [...document.querySelectorAll('header,nav,main,footer,aside,[role]')]
        .map((e) => `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : ''}`),
      images: [...document.querySelectorAll('img')].map((i) => ({
        src: (i.getAttribute('src') || '').split('?')[0].split('/').pop(),
        alt: i.getAttribute('alt'),
        hasAlt: i.hasAttribute('alt'),
        inLink: !!i.closest('a'),
        loading: i.getAttribute('loading'),
      })),
      links: [...document.querySelectorAll('a[href]')].map((a) => ({
        text: txt(a),
        href: a.getAttribute('href'),
        accName: txt(a) || a.getAttribute('aria-label') || a.getAttribute('title') || '',
      })),
      navDrops: [...document.querySelectorAll('.nav-drop')].map((d) => ({
        label: txt(d.querySelector(':scope > a')) || txt(d).slice(0, 30),
        ariaExpanded: d.getAttribute('aria-expanded'),
        tabindex: d.getAttribute('tabindex'),
        role: d.getAttribute('role'),
      })),
      buttons: [...document.querySelectorAll('button')].map((b) => ({
        label: b.getAttribute('aria-label') || txt(b),
        ariaExpanded: b.getAttribute('aria-expanded'),
        ariaControls: b.getAttribute('aria-controls'),
      })),
    };
  });

  out.viewports[vp.name] = { violations, structure, passes: results.passes.length };
  await page.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
