export default function decorate(block) {
  const cols = [...(block.firstElementChild?.children || [])];
  block.classList.add(`columns-${cols.length}-cols`);

  // setup image columns
  [...block.children].forEach((row) => {
    [...row.children].forEach((col) => {
      /*
       * The class belongs on the column itself, not on whichever div happens to
       * wrap the picture: in Universal Editor that wrapper is an inner image
       * component, so pic.closest('div') puts the class one level too deep and
       * every `.columns > div > .columns-img-col` rule silently stops matching.
       * Testing for an absence of text keeps "picture is the only content"
       * true on both surfaces regardless of how deeply it is wrapped.
       */
      if (col.querySelector('picture') && col.textContent.trim() === '') {
        col.classList.add('columns-img-col');
      }
    });
  });
}
