import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/*
 * Markup contract. One person, in the order the model declares them.
 *
 * The model's fields are `image` + `imageAlt`, `name`, `role` and `text`.
 * `imageAlt` is a companion of `image`, so there are four field groups — and
 * therefore four cells, arriving in a different row structure on each surface:
 *
 *   Universal Editor              Document authoring
 *   div.bio-detail                div.bio-detail
 *     > div > div   image           > div > div   image
 *     > div > div   name                  > div   name
 *     > div > div   role                  > div   role
 *     > div > div   biography             > div   biography
 *     = 4 rows x 1 cell             = 1 row x 4 cells
 *
 * Reading the cells directly is what makes both shapes work. Anchoring to the
 * rows instead would yield a single cell on a document-authored page, and
 * because this block rebuilds its own children the name, role and biography
 * would not merely go unstyled — they would be dropped from the page.
 *
 * The portrait is found by looking for the picture rather than by position, so
 * the remaining cells keep their order whether or not an image was supplied.
 * Every field after that is optional and guarded: Universal Editor emits an
 * empty cell for a field the author left blank, and a document-authored page
 * may simply stop early.
 *
 * A profile link lives inside the biography rather than in a field of its own:
 * the block is capped at four cells, and of the five things a bio needs, the
 * link is the only one a richtext field can already express.
 *
 * Rebuilding the children is safe: scripts/editor-support.js inserts a fresh
 * server-rendered block per content change and removes the old one, so
 * decorate() never runs on its own output.
 */

/**
 * True when the cell holds no content the reader would see. Empty cells arrive
 * from Universal Editor for every unfilled field, and rendering them would
 * leave stray gaps in the layout.
 * @param {Element} cell The candidate cell
 * @returns {boolean}
 */
function isEmpty(cell) {
  return !cell || (!cell.textContent.trim() && !cell.querySelector('picture, a[href]'));
}

/**
 * Re-tags a cell's content as `tag`, carrying the authoring instrumentation
 * across so the field stays editable in place.
 * @param {Element} cell The source cell
 * @param {string} tag The element name to produce
 * @param {string} className The class to apply
 * @returns {Element} The new element
 */
function retag(cell, tag, className) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = cell.textContent.trim();
  moveInstrumentation(cell, el);
  return el;
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  const cells = [...block.querySelectorAll(':scope > div > div')];

  const portraitCell = cells.find((cell) => cell.querySelector('picture'));
  const [nameCell, roleCell, bioCell] = cells
    .filter((cell) => cell !== portraitCell);

  const portrait = document.createElement('div');
  portrait.className = 'bio-detail-portrait';
  if (portraitCell) {
    const img = portraitCell.querySelector('picture > img');
    if (img) {
      const optimized = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
      const optimizedImg = optimized.querySelector('img');
      // createOptimizedPicture carries only src and alt, so keep the intrinsic size
      if (img.width && img.height) {
        optimizedImg.width = img.width;
        optimizedImg.height = img.height;
      }
      moveInstrumentation(img, optimizedImg);
      portrait.append(optimized);
    }
  }

  /*
   * Name and role sit in the left rail UNDER the portrait, not beside it with
   * the biography. Measured from the capture at 1440: the portrait, the name
   * and the role all share x=15 w=376, stacked (portrait 194-576, name 605,
   * role 644), while the biography alone occupies the right column at x=515
   * w=910. Putting the name in the right column would read as a heading for
   * the body copy rather than a caption for the portrait.
   */
  const rail = document.createElement('div');
  rail.className = 'bio-detail-rail';
  rail.append(portrait);

  if (!isEmpty(nameCell)) {
    /*
     * The person's name is the subject of a bio page, so it is that page's h1.
     * It drops to an h2 when the page already has an h1 — a banner above the
     * block, say — because two h1s is worse than a slightly demoted name.
     */
    const level = document.querySelector('main h1') ? 'h2' : 'h1';
    rail.append(retag(nameCell, level, 'bio-detail-name'));
  }

  if (!isEmpty(roleCell)) {
    rail.append(retag(roleCell, 'p', 'bio-detail-role'));
  }

  const panes = [rail];
  if (!isEmpty(bioCell)) {
    bioCell.className = 'bio-detail-bio';
    panes.push(bioCell);
  }

  /*
   * The panes stay the block's own children: `.bio-detail` is the grid
   * container, so wrapping them in anything else would give it a single child
   * and collapse the two-column layout.
   */
  block.replaceChildren(...panes);
}
