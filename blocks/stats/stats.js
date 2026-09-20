/*
 * Stats block — a row of figure/label pairs on a full-bleed band.
 *
 * Markup contract. `stats` is a container block, so its child items are the
 * rows on BOTH authoring surfaces and each item's field groups are its cells:
 *
 *   div.stats[.small]
 *     > div                 stat item (one per `stat` child component)
 *         > div             cell 1 — figure, e.g. "$101", "53%", "110"
 *         > div             cell 2 — label richtext, may contain <sup>
 *
 * The band colour and the optional heading beside the stats are section-level
 * concerns (`dark`, `split-33-66`), not fields on this block.
 */

/**
 * Splits an authored figure into its symbol and numeral so the symbol can be
 * set at a smaller size, e.g. "$101" -> <span>$</span><span>101</span>.
 * Leaves the element untouched when no numeral is present.
 * @param {Element} cell The figure cell
 */
function splitFigure(cell) {
  // operate on the innermost text holder so authoring instrumentation survives
  const holder = cell.querySelector('p') || cell;
  // \s covers the non-breaking space authors often paste into a figure
  const match = holder.textContent.trim().match(/^(\D*)(\d[\d.,\s]*)(\D*)$/);
  if (!match) return;

  const [, before, numeral, after] = match;
  const span = (className, text) => {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  };

  holder.textContent = '';
  if (before.trim()) holder.append(span('stats-symbol', before.trim()));
  holder.append(span('stats-numeral', numeral.trim()));
  if (after.trim()) holder.append(span('stats-symbol', after.trim()));
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  [...block.children].forEach((item) => {
    const cells = [...item.children];
    if (!cells.length) return;

    item.classList.add('stats-item');

    const [figure, label] = cells;
    figure.classList.add('stats-figure');
    splitFigure(figure);

    // an author may leave the label empty; the figure still renders
    if (label) label.classList.add('stats-label');
  });
}
