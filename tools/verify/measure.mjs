/* Measure specific built elements at 1440 for comparison with the capture. */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000/drafts/ppm-home', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const pick = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return {
      text: el.textContent.trim().slice(0, 44),
      rect: { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      font: `${c.fontFamily.split(',')[0]} ${c.fontSize} ${c.fontWeight}`,
      color: c.color,
      bg: c.backgroundColor,
      tt: c.textTransform,
    };
  };
  const q = (s) => pick(document.querySelector(s));
  return {
    heroBlock: q('.hero'),
    heroH1: q('.hero h1'),
    heroPicture: q('.hero picture'),
    introH2: q('.columns-33-66 h2'),
    statNum: q('.stats p'),
    sectionTitle: q('.section.split-33-66 h2'),
    insightsH3: q('.cards-container h3'),
    cardEyebrow: q('.cards-card-eyebrow'),
    cardTitle: q('.cards .cards-card-body h3'),
    cardImg: q('.cards .cards-card-image img'),
    promoImg: q('.columns.flush .columns-img-col img'),
    promoText: q('.columns.flush > div > div:not(.columns-img-col)'),
    promoEyebrow: q('.columns.flush > div > div:not(.columns-img-col) p'),
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
