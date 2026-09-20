/*
 * Page-level assembly check (eds-page-assemble step 4).
 *
 * Loads the composed draft page at the union of the captured breakpoints and
 * the project's own CSS breakpoints, and asserts the things that are only
 * observable once the whole page is composed:
 *   - no horizontal overflow
 *   - every block reaches data-block-status="loaded"
 *   - no console errors and no failed requests (chrome included)
 *   - full-page screenshot for diffing against the capture
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const URL = process.env.PAGE_URL || 'http://localhost:3000/drafts/ppm-home';
const OUT = process.env.OUT_DIR || '/tmp/assemble';
const WIDTHS = (process.env.WIDTHS || '375,600,768,900,1440').split(',').map(Number);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const results = [];

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  // let the lazy + delayed phases settle
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => { setTimeout(r, 600); });
    window.scrollTo(0, 0);
    await new Promise((r) => { setTimeout(r, 600); });
  });
  await page.waitForTimeout(800);

  const metrics = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[class][data-block-name], .block')];
    const blockInfo = blocks.map((b) => ({
      name: b.dataset.blockName || b.classList[0],
      status: b.dataset.blockStatus || '(none)',
      classes: b.className,
    }));
    const sections = [...document.querySelectorAll('main > .section')].map((s, i) => ({
      i,
      classes: s.className,
      top: Math.round(s.getBoundingClientRect().top + window.scrollY),
      height: Math.round(s.getBoundingClientRect().height),
    }));
    // find anything sticking out past the viewport
    const overflowing = [];
    if (document.documentElement.scrollWidth > window.innerWidth) {
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          overflowing.push({
            tag: el.tagName,
            cls: (el.className || '').toString().slice(0, 80),
            left: Math.round(r.left),
            right: Math.round(r.right),
          });
        }
      });
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      bodyScrollHeight: document.body.scrollHeight,
      docHeight: Math.round(document.documentElement.getBoundingClientRect().height),
      bodyAppear: document.body.classList.contains('appear'),
      bodyClasses: document.body.className,
      blocks: blockInfo,
      sections,
      overflowing: overflowing.slice(0, 12),
      headings: [...document.querySelectorAll('main h1,main h2,main h3,main h4,main h5,main h6')]
        .map((h) => `${h.tagName} ${h.textContent.trim().slice(0, 60)}`),
    };
  });

  await page.screenshot({ path: `${OUT}/built-${width}.png`, fullPage: true });

  results.push({
    width,
    ...metrics,
    consoleErrors,
    pageErrors,
    failedRequests: [...new Set(failedRequests)],
  });

  await context.close();
}

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));

// ---- report ----
for (const r of results) {
  const overflow = r.scrollWidth > r.innerWidth;
  const notLoaded = r.blocks.filter((b) => b.status !== 'loaded');
  console.log(`\n=== ${r.width}px ===`);
  console.log(`  page height      : ${r.bodyScrollHeight}px`);
  console.log(`  horizontal overflow: ${overflow ? `YES scrollWidth=${r.scrollWidth} vs ${r.innerWidth}` : 'no'}`);
  if (overflow) r.overflowing.forEach((o) => console.log(`      ${o.tag}.${o.cls} [${o.left} → ${o.right}]`));
  console.log(`  body.appear      : ${r.bodyAppear}  classes="${r.bodyClasses}"`);
  console.log(`  blocks (${r.blocks.length}): ${r.blocks.map((b) => `${b.name}:${b.status}`).join(', ')}`);
  if (notLoaded.length) console.log(`  NOT LOADED       : ${notLoaded.map((b) => b.name).join(', ')}`);
  console.log(`  console errors   : ${r.consoleErrors.length}`);
  r.consoleErrors.forEach((e) => console.log(`      ${e.slice(0, 200)}`));
  console.log(`  page errors      : ${r.pageErrors.length}`);
  r.pageErrors.forEach((e) => console.log(`      ${e.slice(0, 200)}`));
  console.log(`  failed requests  : ${r.failedRequests.length}`);
  r.failedRequests.forEach((e) => console.log(`      ${e.slice(0, 200)}`));
  console.log('  sections:');
  r.sections.forEach((s) => console.log(`      [${s.i}] y=${s.top} h=${s.height} "${s.classes}"`));
}
