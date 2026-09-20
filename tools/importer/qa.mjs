/*
 * Structural QA for the import transform.
 *
 * Reduces the imported output and the block-authoring fixture to a block /
 * row / cell skeleton and compares them component by component. This is the
 * decisive check for an xwalk import: cells are mapped to model properties by
 * POSITION, so a wrong cell count or order silently lands content in the wrong
 * field while the page still renders correctly.
 *
 * Usage: node tools/importer/qa.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const IMPORTED = join(here, 'out', 'www-ppmamerica-com.plain.html');
const FIXTURE = join(root, 'drafts', 'ppm-home.html');

/**
 * Reduces an EDS `.plain.html` document to a comparable skeleton.
 * @param {string} html The document markup
 * @returns {object[]} One entry per block, in document order
 */
function skeleton(html) {
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  const blocks = [];

  [...document.body.children].forEach((section, si) => {
    [...section.children].forEach((el) => {
      const cls = el.className.trim();
      if (!cls) {
        // default content in the section
        blocks.push({ section: si, block: `(default) ${el.tagName.toLowerCase()}`, rows: [] });
        return;
      }
      if (cls === 'section-metadata') {
        const style = el.querySelector('div > div:last-child')?.textContent.trim();
        blocks.push({ section: si, block: 'section-metadata', rows: [[style]] });
        return;
      }
      const rows = [...el.children].map((row) => [...row.children].map((cell) => {
        const tags = [...cell.children].map((c) => {
          const tag = c.tagName.toLowerCase();
          // a bare <img> and a hand-authored <picture><img> are the same cell:
          // aem.live wraps images in <picture> at delivery
          return tag === 'picture' ? 'img' : tag;
        });
        if (!tags.length) return cell.textContent.trim() ? 'text' : '(empty)';
        return tags.join('+');
      }));
      blocks.push({ section: si, block: cls, rows });
    });
  });

  return blocks;
}

/**
 * Renders a block skeleton as a single comparable line.
 * @param {object} b The block entry
 * @returns {string}
 */
const line = (b) => `${b.block} :: ${b.rows.map((r) => `[${r.join(' | ')}]`).join(' ')}`;

/**
 * Reads a fixture, unwrapping the page shell when there is one. The assembled
 * fixture is a whole page -- it needs a <head> for the nav/footer metadata and
 * a <header>/<footer> for the chrome to load into -- but only the content of
 * <main> is comparable against a `.plain.html` fragment.
 * @param {string} file Absolute path to the fixture
 * @returns {string} The body fragment
 */
function fixtureBody(file) {
  const html = readFileSync(file, 'utf-8');
  const main = html.match(/<main[^>]*>([\s\S]*)<\/main>/i);
  return main ? main[1] : html;
}

const imported = skeleton(readFileSync(IMPORTED, 'utf-8'));
const fixture = skeleton(fixtureBody(FIXTURE));

console.log('IMPORTED (tools/importer/out)');
imported.forEach((b) => console.log(`  s${b.section}  ${line(b)}`));
console.log('\nFIXTURE (drafts/ppm-home.html)');
fixture.forEach((b) => console.log(`  s${b.section}  ${line(b)}`));

// compare the blocks the fixture actually covers, matched by block class
console.log('\nPER-BLOCK COMPARISON');
let bad = 0;
const seen = new Set();
fixture.filter((b) => b.block !== 'section-metadata' && !b.block.startsWith('(default)'))
  .forEach((f) => {
    const key = `${f.block}#${[...seen].filter((s) => s === f.block).length}`;
    seen.add(f.block);
    const match = imported.filter((i) => i.block === f.block)[
      [...seen].filter((s) => s === f.block).length - 1
    ];
    if (!match) {
      bad += 1;
      console.log(`  MISSING  ${f.block}`);
      return;
    }
    const a = line(match);
    const b = line(f);
    if (a === b) {
      console.log(`  OK       ${key}  ${b}`);
    } else {
      bad += 1;
      console.log(`  DIFF     ${key}`);
      console.log(`    fixture:  ${b}`);
      console.log(`    imported: ${a}`);
    }
  });

const extra = imported.filter((i) => !fixture.some((f) => f.block === i.block));
extra.forEach((e) => console.log(`  EXTRA    ${line(e)}  (not in fixture)`));

console.log(`\n${bad ? `${bad} structural mismatch(es)` : 'all fixture blocks match structurally'}`);
