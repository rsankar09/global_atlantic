/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
/*
 * Page-level verification for the assembled draft (eds-page-assemble step 4).
 *
 * Every earlier check was component-scoped. This one loads the whole page,
 * chrome included, and asserts the things that only exist once the page is
 * composed:
 *
 *  - no horizontal overflow: documentElement.scrollWidth === the viewport.
 *    The cheapest assertion available, and the one that catches fixed-width
 *    tracks and released wrappers that look perfect in a screenshot.
 *  - every block reaches data-block-status="loaded", and the count matches
 *    the component list.
 *  - no console errors and no failed requests. Header and footer load through
 *    getMetadata('nav'/'footer') -> fragment, a path no component fixture
 *    exercises, so a /nav 404 is a finding here rather than background noise.
 *  - section geometry, so band adjacency can be diffed against the capture.
 *
 * Breakpoints are the captured set UNION the project's own CSS breakpoints.
 * Those two sets are disjoint here, which is exactly where responsive bugs
 * live: the capture at 375/768/1440 tests none of the 600/900 switches in
 * styles/ and blocks/.
 *
 * Requires the dev server:
 *   npx @adobe/aem-cli up --no-open --html-folder drafts
 *
 * Usage: node tools/crawl/page-verify.mjs [path] [--out dir]
 */
import { chromium } from '/Users/a10359614/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const args = process.argv.slice(2).filter((a) => a !== '--out');
const path = args[0]?.startsWith('/') ? args[0] : '/drafts/ppm-home';
const outDir = join(root, 'capture', 'assemble');
mkdirSync(outDir, { recursive: true });

// captured 375/768/1440 U project CSS 600/900, plus the 1200 content max-width
const BREAKPOINTS = [375, 600, 768, 900, 1200, 1440];

// one entry per inventory component with a `map` disposition, plus the chrome
const EXPECTED_BLOCKS = ['hero', 'columns', 'stats', 'stats', 'cards', 'columns', 'header', 'footer'];

const browser = await chromium.launch();
const results = {};

for (const width of BREAKPOINTS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  const failed = [];

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(`http://localhost:3000${path}`, { waitUntil: 'networkidle', timeout: 60000 });
  // the footer loads in the lazy phase, after loadSections resolves
  await page.waitForSelector('footer .footer[data-block-status="loaded"]', { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(800);

  const probe = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[data-block-name]')].map((b) => ({
      name: b.dataset.blockName,
      status: b.dataset.blockStatus,
      classes: b.className,
    }));
    const sections = [...document.querySelectorAll('main > .section')].map((s) => {
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      return {
        style: s.className.replace('section', '').trim(),
        y: Math.round(r.y + window.scrollY),
        h: Math.round(r.height),
        bg: cs.backgroundColor,
        pt: cs.paddingTop,
        pb: cs.paddingBottom,
        mt: cs.marginTop,
        mb: cs.marginBottom,
      };
    });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      pageHeight: document.documentElement.scrollHeight,
      headerHeight: Math.round(document.querySelector('header')?.getBoundingClientRect().height ?? 0),
      footerHeight: Math.round(document.querySelector('footer')?.getBoundingClientRect().height ?? 0),
      blocks,
      sections,
      brokenImages: [...document.querySelectorAll('img')]
        .filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
    };
  });

  await page.screenshot({ path: join(outDir, `ppm-home-${width}.png`), fullPage: true });
  await page.close();

  const overflow = probe.scrollWidth - probe.clientWidth;
  const loaded = probe.blocks.filter((b) => b.status === 'loaded').map((b) => b.name);
  const missing = [...EXPECTED_BLOCKS];
  loaded.forEach((n) => {
    const i = missing.indexOf(n);
    if (i >= 0) missing.splice(i, 1);
  });
  const unloaded = probe.blocks.filter((b) => b.status !== 'loaded');

  const fail = [];
  if (overflow > 0) fail.push(`horizontal overflow +${overflow}px (scrollWidth ${probe.scrollWidth})`);
  if (missing.length) fail.push(`blocks missing: ${missing.join(', ')}`);
  if (unloaded.length) fail.push(`blocks not loaded: ${unloaded.map((b) => `${b.name}=${b.status}`).join(', ')}`);
  if (probe.brokenImages.length) fail.push(`broken images: ${probe.brokenImages.length}`);
  if (consoleErrors.length) fail.push(`console errors: ${consoleErrors.length}`);
  if (pageErrors.length) fail.push(`page errors: ${pageErrors.length}`);
  if (failed.length) fail.push(`failed requests: ${failed.length}`);

  results[width] = {
    ...probe, overflow, consoleErrors, pageErrors, failed, fail,
  };

  console.log(`\n@${width}  height=${probe.pageHeight}px  header=${probe.headerHeight}px  footer=${probe.footerHeight}px`);
  console.log(`  overflow      ${overflow === 0 ? 'none' : `+${overflow}px`}`);
  console.log(`  blocks        ${loaded.length}/${EXPECTED_BLOCKS.length} loaded  [${loaded.join(' ')}]`);
  probe.sections.forEach((s) => console.log(`    y=${String(s.y).padStart(5)} h=${String(s.h).padStart(4)} pad=${s.pt}/${s.pb} mar=${s.mt}/${s.mb} bg=${s.bg}  ${s.style || '(plain)'}`));
  probe.brokenImages.forEach((i) => console.log(`  BROKEN-IMG    ${i}`));
  consoleErrors.forEach((e) => console.log(`  CONSOLE-ERR   ${e}`));
  pageErrors.forEach((e) => console.log(`  PAGE-ERR      ${e}`));
  failed.forEach((f) => console.log(`  REQ-FAIL      ${f}`));
  console.log(fail.length ? `  => FAIL: ${fail.join('; ')}` : '  => PASS');
}

await browser.close();
writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

const failed = Object.entries(results).filter(([, r]) => r.fail.length);
console.log(`\n${failed.length ? `${failed.length}/${BREAKPOINTS.length} breakpoint(s) failing: ${failed.map(([w]) => w).join(', ')}` : `all ${BREAKPOINTS.length} breakpoints pass`}`);
console.log('screenshots + results.json in capture/assemble/');
