/*
 * Numeric verification for the PPM header and footer (eds-block-authoring
 * step 5), across the union of the captured breakpoints (375/768/1440) and
 * the project's own CSS breakpoints (600/900/1200).
 *
 * Header offsets are absolute (the header is at the top of the document).
 * Footer offsets are reported relative to the footer box, so they can be
 * compared with the capture even though the two pages differ in height.
 *
 * Source numbers to compare against, from capture/www-ppmamerica-com:
 *   header   1440  0,0,1440,106      brand img 20,32,270,41
 *                  nav link 1 290,42,295,28   search icon 1365,42,24,24
 *    (375/768 from screenshot pixel scans: band h=81, brand ink 126x16,
 *     search ink x=289/682 y=29 24x24, hamburger ink 26x17 ending at the
 *     right gutter)
 *   footer   1440  15,0,1410,160 (relative)  logo ink +15,+34,155,20
 *                  address ul +325,+29       social ink +1386,+29,24,21
 *                  copyright ink +15,+87     policy ink +912,+92
 */
import { chromium } from 'playwright';

const URL = process.env.PAGE_URL || 'http://localhost:3000/drafts/ppm-home';
const WIDTHS = (process.env.WIDTHS || '375,600,768,900,1200,1440').split(',').map(Number);

const browser = await chromium.launch({ channel: 'chrome' });
const rows = [];

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const data = await page.evaluate(() => {
    const abs = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height),
      };
    };
    const footerEl = document.querySelector('footer');
    const fBox = footerEl ? abs(footerEl) : null;
    const rel = (el) => {
      const a = abs(el);
      if (!a || !fBox) return a;
      return { ...a, y: a.y - fBox.y };
    };
    const q = (s) => document.querySelector(s);
    const vis = (el) => (el ? getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' : false);
    const css = (el, props) => {
      if (!el) return null;
      const c = getComputedStyle(el);
      return props.reduce((o, p) => ({ ...o, [p]: c[p] }), {});
    };

    const navLink = q('header .nav-sections .default-content-wrapper > ul > li > a');
    const searchLink = q('header .nav-tools a');
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      header: {
        box: abs(q('header')),
        wrapper: abs(q('header .nav-wrapper')),
        wrapperPosition: css(q('header .nav-wrapper'), ['position', 'borderBottomWidth', 'borderBottomColor']),
        brandImg: abs(q('header .nav-brand img')),
        navLink1: abs(navLink),
        navLinkCss: css(navLink, ['fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'color']),
        search: abs(searchLink),
        searchCss: css(searchLink, ['maskImage', 'backgroundColor', 'fontSize']),
        hamburger: abs(q('header .nav-hamburger')),
        hamburgerVisible: vis(q('header .nav-hamburger')),
        sectionsVisible: vis(q('header .nav-sections')),
      },
      footer: {
        box: fBox,
        logoImg: rel(q('footer .footer .section:first-child img')),
        addressUl: rel(q('footer .footer .section:first-child ul')),
        addressLi1: rel(q('footer .footer .section:first-child ul li')),
        addressCss: css(q('footer .footer .section:first-child ul'), ['fontSize', 'lineHeight', 'display']),
        social: rel(q('footer .footer a[href*="linkedin.com"] img')),
        copyright: rel(q('footer .footer .section:last-child p')),
        policyUl: rel(q('footer .footer .section:last-child ul')),
        policyOrder: css(q('footer .footer .section:last-child ul'), ['order']),
        copyrightOrder: css(q('footer .footer .section:last-child p'), ['order']),
      },
    };
  });

  rows.push({ width, ...data });
  await context.close();
}
await browser.close();

const fmt = (r) => (r ? `${r.x},${r.y},${r.w},${r.h}` : '(missing)');
for (const r of rows) {
  const overflow = r.scrollWidth > r.innerWidth;
  console.log(`\n=== ${r.width}px ===  overflow: ${overflow ? `YES ${r.scrollWidth}>${r.innerWidth}` : 'no'}`);
  console.log('  HEADER (absolute x,y,w,h)');
  console.log(`    header box   ${fmt(r.header.box)}`);
  console.log(`    nav-wrapper  ${fmt(r.header.wrapper)}  ${JSON.stringify(r.header.wrapperPosition)}`);
  console.log(`    brand img    ${fmt(r.header.brandImg)}`);
  console.log(`    nav link 1   ${fmt(r.header.navLink1)}  ${JSON.stringify(r.header.navLinkCss)}`);
  console.log(`    search       ${fmt(r.header.search)}  bg=${r.header.searchCss?.backgroundColor} fs=${r.header.searchCss?.fontSize}`);
  console.log(`    hamburger    ${fmt(r.header.hamburger)} visible=${r.header.hamburgerVisible}  sectionsVisible=${r.header.sectionsVisible}`);
  console.log('  FOOTER (y relative to footer box)');
  console.log(`    footer box   ${fmt(r.footer.box)}`);
  console.log(`    logo img     ${fmt(r.footer.logoImg)}`);
  console.log(`    address ul   ${fmt(r.footer.addressUl)}  ${JSON.stringify(r.footer.addressCss)}`);
  console.log(`    address li1  ${fmt(r.footer.addressLi1)}`);
  console.log(`    social img   ${fmt(r.footer.social)}`);
  console.log(`    copyright    ${fmt(r.footer.copyright)}  order=${r.footer.copyrightOrder?.order}`);
  console.log(`    policy ul    ${fmt(r.footer.policyUl)}  order=${r.footer.policyOrder?.order}`);
}
