/*
 * Content-coverage QA for the import transform.
 *
 * `run.mjs` reports PASS when the transform throws no exception, which says
 * nothing about whether the page survived. The previous revision of import.js
 * reported PASS on all 14 captured pages while dropping 38-98% of their
 * content, and the pages it damaged worst were the ones that still looked
 * plausible. This measures what actually landed.
 *
 * For each capture it compares the source's visible page text against the
 * imported markdown, word by word, and reports the words the import lost. It
 * also reports the block skeleton, so a wrong cell count -- which renders fine
 * and mis-maps every later model property -- is visible rather than inferred.
 *
 * Usage: node tools/importer/coverage.mjs [capture-dir ...]
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const outDir = join(here, 'out');
const captureRoot = join(root, 'capture');

/*
 * Excluded from the source side because the transform excludes them by design,
 * not by accident: site chrome is authored as the /nav and /footer fragments,
 * and the disclosure interstitial (cmp-015) is an open legal decision rather
 * than page content. Counting them as "lost" would bury the real losses.
 */
const NOT_CONTENT = [
  '.header-sticky',
  '.cmp-experiencefragment--header',
  '.cmp-experiencefragment--footer',
  '.cmp-experiencefragment--breadcrumb',
  '.disclosureagreement',
  '.cmp-modal_overlay',
];

/*
 * Content the transform deliberately replaces with a reference rather than
 * transcribing. Both are correct behaviour that a naive text diff would score
 * as catastrophic loss:
 *
 *   shared fragments  one piece of content reused across many pages, imported
 *                     once to /fragments/<name> and referenced here
 *   dynamic-card-list a query-driven listing; the block reads the index at
 *                     request time, so its 35 server-rendered cards are not
 *                     authored content and must not be frozen into the page
 */
const BY_REFERENCE = [
  '.cmp-experiencefragment--our-insights',
  '.cmp-experiencefragment--our-advantage',
  '.cmp-experiencefragment--career-opportunities',
  '.cmp-experiencefragment--commercial-real-estate-debt',
  '.dynamic-card-list',
];

/**
 * Reduces text to comparable content words, dropping punctuation, casing and
 * the short function words that match by accident.
 * @param {string} value Raw text
 * @returns {Set<string>}
 */
function words(value) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[‘’“”]/g, "'")
      .replace(/[^a-z0-9$%'.-]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

/**
 * Returns the source page's visible content text, minus chrome and minus the
 * content the transform intentionally imports by reference.
 * @param {Document} document The source document
 * @returns {string}
 */
function sourceText(document) {
  const contentRoot = document.querySelector('.root.container');
  if (!contentRoot) return '';

  const clone = contentRoot.cloneNode(true);
  [...NOT_CONTENT, ...BY_REFERENCE].forEach((selector) => {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  });

  /*
   * Separate adjacent elements before reading text. `textContent` runs siblings
   * together, so a list of CLO funds reads as "1999-5serves" and a table row as
   * "finishcharacteristics" -- phantom terms that can never match the import
   * and that scored three correctly-imported pages as 7-8% content loss.
   */
  clone.innerHTML = clone.innerHTML.replace(/</g, ' <');
  return clone.textContent || '';
}

/**
 * Reads the block skeleton out of the emitted table markup.
 * @param {string} html The transform's `main` output
 * @returns {string[]} One line per block
 */
function skeleton(html) {
  const { document } = new JSDOM(html).window;
  return [...(document.querySelector('main')?.children || [])]
    .filter((el) => el.tagName === 'TABLE')
    .map((table) => {
      const rows = [...table.querySelectorAll('tr')];
      const name = rows[0].textContent.trim();
      const cells = rows.slice(1).map((tr) => tr.children.length);
      return `${name} :: ${cells.length} row(s) x [${[...new Set(cells)].join('/')}] cell(s)`;
    });
}

const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(captureRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(captureRoot, d.name))
    .filter((d) => existsSync(join(d, 'dom.json')));

const results = [];

for (const dir of dirs) {
  const name = basename(dir);
  const mdFile = join(outDir, `${name}.md`);
  const htmlFile = join(outDir, `${name}.html`);
  if (!existsSync(mdFile)) {
    results.push({ name, coverage: 0, lost: [], note: 'no output — run.mjs failed' });
    // eslint-disable-next-line no-continue
    continue;
  }

  const { html } = JSON.parse(readFileSync(join(dir, 'dom.json'), 'utf-8'));
  const { document } = new JSDOM(html).window;

  const source = words(sourceText(document));
  const imported = words(readFileSync(mdFile, 'utf-8'));

  const lost = [...source].filter((w) => !imported.has(w));
  const coverage = source.size ? Math.round(((source.size - lost.length) / source.size) * 100) : 100;

  results.push({
    name,
    coverage,
    lost,
    total: source.size,
    blocks: skeleton(readFileSync(htmlFile, 'utf-8')),
  });
}

results.sort((a, b) => a.coverage - b.coverage);

let failed = 0;
const THRESHOLD = 95;

results.forEach((r) => {
  const verdict = r.coverage >= THRESHOLD ? 'PASS' : 'FAIL';
  if (verdict === 'FAIL') failed += 1;
  console.log(`${verdict}  ${String(r.coverage).padStart(3)}%  ${r.name}${r.note ? `  (${r.note})` : ''}`);
  if (verdict === 'FAIL') {
    console.log(`         lost ${r.lost.length}/${r.total} terms: ${r.lost.slice(0, 18).join(' ')}`);
    (r.blocks || []).forEach((b) => console.log(`         ${b}`));
  }
});

const mean = Math.round(results.reduce((sum, r) => sum + r.coverage, 0) / results.length);
console.log(`\n${results.length} pages, mean coverage ${mean}%, ${failed} below ${THRESHOLD}%`);
