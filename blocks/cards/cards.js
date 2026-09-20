import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/*
 * Markup contract. `cards` is a container block, so its child items are the
 * rows on BOTH authoring surfaces and each item's field groups are its cells:
 *
 *   div.cards[.square]
 *     > div               card item
 *         > div           cell 1 — image (+ alt)
 *         > div           cell 2 — text richtext (eyebrow paragraph, heading, copy)
 *         > div           cell 3 — link (optional; wraps the whole card)
 */

/**
 * Returns the anchor when the cell's entire content is one link, else null.
 * Used to tell an authored card link apart from a link inside the body copy.
 * @param {Element} cell The candidate cell
 * @returns {HTMLAnchorElement|null}
 */
function soleLink(cell) {
  const anchors = cell.querySelectorAll('a[href]');
  if (anchors.length !== 1) return null;
  return cell.textContent.trim() === anchors[0].textContent.trim() ? anchors[0] : null;
}

/**
 * Marks a leading paragraph that precedes a heading as the card eyebrow, so it
 * can be styled as a pretitle while the heading stays the card's real heading.
 * @param {Element} body The card body cell
 */
function decorateEyebrow(body) {
  const first = body.firstElementChild;
  if (!first || first.tagName !== 'P') return;
  if (!first.nextElementSibling?.matches('h1, h2, h3, h4, h5, h6')) return;
  first.classList.add('cards-card-eyebrow');
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  /* change to ul, li */
  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    moveInstrumentation(row, li);
    while (row.firstElementChild) li.append(row.firstElementChild);

    // the link is the last field group, so only the trailing cell can be one
    const cells = [...li.children];
    const linkEl = cells.length > 1 ? soleLink(cells[cells.length - 1]) : null;
    if (linkEl) cells.pop().remove();

    cells.forEach((div) => {
      if (div.children.length === 1 && div.querySelector('picture')) {
        div.className = 'cards-card-image';
      } else {
        div.className = 'cards-card-body';
        decorateEyebrow(div);
      }
    });

    if (linkEl) {
      const anchor = document.createElement('a');
      anchor.className = 'cards-card-link';
      anchor.href = linkEl.href;
      anchor.append(...li.children);
      li.append(anchor);
    }

    ul.append(li);
  });
  ul.querySelectorAll('picture > img').forEach((img) => {
    const optimizedPic = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
    const optimizedImg = optimizedPic.querySelector('img');
    // createOptimizedPicture carries only src and alt, so keep the intrinsic size
    if (img.width && img.height) {
      optimizedImg.width = img.width;
      optimizedImg.height = img.height;
    }
    moveInstrumentation(img, optimizedImg);
    img.closest('picture').replaceWith(optimizedPic);
  });
  block.replaceChildren(ul);
}
