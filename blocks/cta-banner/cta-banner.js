/*
 * Markup contract. A full-width prompt band: a heading, optional supporting
 * copy, and a call to action.
 *
 * The model declares `text` (richtext), `link` + `linkText`, and `classes`.
 * `linkText` is a companion of `link`, and `classes` is consumed as the block's
 * variant rather than emitted as content, so there are two field groups — and
 * therefore two cells, arriving in a different row structure on each surface:
 *
 *   Universal Editor                Document authoring
 *   div.cta-banner[.dark|.accent]   div.cta-banner[.dark|.accent]
 *     > div > div    text             > div > div   text
 *     > div > div    link                   > div   link
 *     = 2 rows x 1 cell                = 1 row x 2 cells
 *
 * So the cells are read directly and promoted to be the block's own children.
 * `.cta-banner` is the flex container and the cells are its flex items, so they
 * have to sit at that level; the row wrappers carry nothing worth keeping,
 * because for a simple (non-container) block the Universal Editor
 * instrumentation lives on the cell as `data-aue-prop`, not on the row.
 *
 * decorate() is never re-run on its own output: scripts/editor-support.js
 * inserts a fresh server-rendered block per content change and removes the old
 * one, so rebuilding the block's children here is safe.
 */

/**
 * Returns the anchor when the cell's entire content is one link, else null.
 * Distinguishes the authored call-to-action cell from a link inside the copy.
 * @param {Element} cell The candidate cell
 * @returns {HTMLAnchorElement|null}
 */
function soleLink(cell) {
  const anchors = cell.querySelectorAll('a[href]');
  if (anchors.length !== 1) return null;
  return cell.textContent.trim() === anchors[0].textContent.trim() ? anchors[0] : null;
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  const cells = [...block.querySelectorAll(':scope > div > div')];
  cells.forEach((cell) => cell.classList.add('cta-banner-cell'));
  block.replaceChildren(...cells);

  /*
   * Promote the trailing link ourselves rather than leaving it to
   * decorateButtons(): that function only buttonises a link the author wrapped
   * in <strong> or <em>, and the Universal Editor `link` field emits a bare
   * anchor with no such formatting. Relying on it would mean the call to
   * action renders as a plain link on every page authored in the editor.
   */
  const last = cells[cells.length - 1];
  const cta = cells.length > 1 && last ? soleLink(last) : null;
  if (cta) {
    last.classList.add('cta-banner-actions');
    cta.classList.add('button');
    /*
     * Document authoring delivers the link already inside a <p>; the editor's
     * reference field delivers a bare <a>. Wrap the bare case so both surfaces
     * end up with the same p.button-wrapper, and therefore the same spacing —
     * otherwise the editor loses the deliberate step above the button and the
     * band is measurably shorter there than on a published page.
     */
    let wrapper = cta.closest('p');
    if (!wrapper) {
      wrapper = document.createElement('p');
      cta.replaceWith(wrapper);
      wrapper.append(cta);
    }
    wrapper.classList.add('button-wrapper');
  }

  /*
   * The call to action is the entire point of the band, so it takes the
   * high-impact accent treatment regardless of how it was emphasised — both
   * the link promoted above and anything decorateButtons() already styled.
   */
  block.querySelectorAll('a.button').forEach((button) => {
    button.classList.remove('primary', 'secondary');
    button.classList.add('accent');
  });
}
