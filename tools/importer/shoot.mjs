/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
/*
 * Renders importer output through the local dev server and writes full-page
 * screenshots, for visual comparison against capture/<site>/screenshots.
 *
 * Each `.plain.html` fragment is wrapped in the EDS page shell (head.html plus
 * an empty header/main/footer) and dropped into drafts/ so that scripts.js
 * decorates it exactly as it would a real page. The wrappers are temporary and
 * removed afterwards, so nothing scratch is left in drafts/.
 *
 * Requires the dev server:
 *   npx @adobe/aem-cli up --no-open --html-folder drafts
 *
 * Usage: node tools/importer/shoot.mjs [fragment.plain.html ...]
 */
import { chromium } from '/Users/a10359614/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import {
  mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const outDir = join(here, 'out', 'shots');
mkdirSync(outDir, { recursive: true });

const breakpoints = [375, 768, 1440];
const head = readFileSync(join(root, 'head.html'), 'utf-8');

const fragments = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(join(here, 'out'))
    .filter((f) => f.endsWith('.plain.html'))
    .map((f) => join(here, 'out', f));

const pages = fragments.map((file) => {
  const name = `render-${basename(file).replace('.plain.html', '')}`;
  // resolve AEM-relative asset paths against the origin so the render is real
  const body = readFileSync(file, 'utf-8')
    .replace(/src="(\/content\/)/g, 'src="https://www.ppmamerica.com$1');
  writeFileSync(join(root, 'drafts', `${name}.html`), `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${name}</title>
${head}
</head>
<body><header></header><main>
${body}
</main><footer></footer></body>
</html>
`);
  return name;
});

const browser = await chromium.launch();

for (const name of pages) {
  for (const width of breakpoints) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const url = `http://localhost:3000/drafts/${name}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1200);

    const broken = await page.evaluate(() => [...document.querySelectorAll('img')]
      .filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
    const height = await page.evaluate(() => document.body.scrollHeight);

    await page.screenshot({ path: join(outDir, `${name}-${width}.png`), fullPage: true });
    console.log(`${name} @${width}  h=${height}px  broken-img=${broken.length}  js-err=${errors.length}`);
    broken.forEach((b) => console.log(`    BROKEN ${b}`));
    errors.forEach((e) => console.log(`    JSERR  ${e}`));
    await page.close();
  }
}

await browser.close();

// drafts/ is authored test content, not a scratch dir -- clean up the wrappers
pages.forEach((name) => rmSync(join(root, 'drafts', `${name}.html`), { force: true }));
