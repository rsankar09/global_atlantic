/*
 * Local QA harness for tools/importer/import.js.
 *
 * Runs the transform against the captured DOM in capture/<site>/dom.json using
 * the real WebImporter from @adobe/helix-importer, so what is exercised here
 * is the same code path the AEM Importer runs -- not a hand-written stub.
 *
 * Usage: node tools/importer/run.mjs [capture-dir ...]
 * Output: tools/importer/out/<name>.html  (block tables, ready to eyeball)
 *         tools/importer/out/<name>.md    (markdown, what the importer stores)
 */

import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import * as importer from '@adobe/helix-importer';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const outDir = join(here, 'out');

// the transform reads WebImporter off the global, as it does in the importer
globalThis.WebImporter = importer;

const captureRoot = join(root, 'capture');
/*
 * A page capture is a directory holding a dom.json. Select on that rather than
 * denylisting the pipeline's own working dirs (_detect, _map, assemble,
 * verify), which a denylist silently falls behind every time one is added.
 */
const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(captureRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(captureRoot, d.name))
    .filter((d) => existsSync(join(d, 'dom.json')));

mkdirSync(outDir, { recursive: true });

const { default: transform } = await import(join(here, 'import.js'));

/**
 * Converts importer table markup into the div markup aem.live serves as
 * `.plain.html`, so the result can be dropped into drafts/ and rendered, and
 * diffed row-for-row against the fixture the block-authoring step produced.
 * @param {Element} main The transformed main element
 * @param {Document} document The document
 * @returns {string}
 */
function tablesToDivs(main, document) {
  const out = document.createElement('div');
  let section = document.createElement('div');

  const flush = () => {
    if (section.childNodes.length) out.append(section);
    section = document.createElement('div');
  };

  [...main.children].forEach((el) => {
    if (el.tagName === 'HR') {
      flush();
      return;
    }
    if (el.tagName !== 'TABLE') {
      section.append(el);
      return;
    }

    const rows = [...el.querySelectorAll(':scope > tbody > tr, :scope > tr')];
    const name = rows[0].textContent.trim();
    if (name === 'Metadata') return; // page metadata, not rendered content

    // "Cards (square, plain)" -> class="cards square plain"
    const [, base, variants = ''] = name.match(/^([^(]+?)\s*(?:\(([^)]*)\))?$/);
    const classes = [base.trim().toLowerCase().replace(/\s+/g, '-')]
      .concat(variants.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));

    const block = document.createElement('div');
    block.className = classes.join(' ');
    rows.slice(1).forEach((tr) => {
      const row = document.createElement('div');
      [...tr.children].forEach((td) => {
        const cell = document.createElement('div');
        cell.append(...td.childNodes);
        row.append(cell);
      });
      block.append(row);
    });
    section.append(block);
  });
  flush();

  /*
   * aem.live wraps every content image in a <picture> on delivery. Several
   * blocks depend on that -- hero.css positions `.hero picture`, and
   * columns.js only marks a cell as an image column when it finds a
   * `picture` -- so a harness that leaves bare <img> renders the page wrong
   * and reports defects that the real pipeline would not produce.
   */
  out.querySelectorAll('img').forEach((img) => {
    const picture = document.createElement('picture');
    img.replaceWith(picture);
    picture.append(img);
  });

  return [...out.children].map((s) => s.outerHTML).join('\n');
}

let failed = 0;

for (const dir of dirs) {
  const name = basename(dir);
  const { html } = JSON.parse(readFileSync(join(dir, 'dom.json'), 'utf-8'));
  const { url } = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));

  // transformDOM mutates the document, so each pass gets its own parse
  const parse = () => new JSDOM(html, { url }).window.document;

  try {
    // 1. block tables, for eyeballing and diffing against the draft fixture
    const document = parse();
    const main = transform.transformDOM({ document, url, html });
    writeFileSync(join(outDir, `${name}.html`), main.outerHTML);

    // report images the source left without alt text, for an authoring pass
    // (before tablesToDivs, which moves nodes out of `main`)
    const imgs = [...main.querySelectorAll('img')];
    const noAlt = imgs.filter((i) => !i.getAttribute('alt')).length;

    // renderable EDS div markup, for drafts/ and for diffing against the fixture
    writeFileSync(join(outDir, `${name}.plain.html`), tablesToDivs(main, document));

    if (noAlt) {
      console.log(`      ${noAlt}/${imgs.length} images have empty alt -> needs an authoring pass`);
    }

    // 2. the full importer pipeline, which is what actually gets stored
    const res = await importer.html2md(url, parse(), transform, {
      createDocumentFromString: (s) => new JSDOM(s).window.document,
    });
    writeFileSync(join(outDir, `${name}.md`), res.md);

    console.log(`PASS  ${name}  -> ${res.path}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${name}: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
  }
}

process.exit(failed ? 1 : 0);
