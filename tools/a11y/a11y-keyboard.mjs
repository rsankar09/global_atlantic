/* eslint-disable no-console */
/**
 * Walks the page with Tab and records the focus order, whether each stop has a
 * visible focus indicator, and whether the nav flyouts actually open for a
 * keyboard user. These are the checks axe-core cannot perform.
 */
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:3000/drafts/ppm-home';
const width = Number(process.argv[3]) || 1440;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const stops = [];
for (let i = 0; i < 40; i += 1) {
  /* eslint-disable no-await-in-loop */
  await page.keyboard.press('Tab');
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const name = (el.getAttribute('aria-label')
      || (el.textContent || '').replace(/\s+/g, ' ').trim()
      || el.getAttribute('title') || '').slice(0, 55);
    // is the focused element itself rendered?
    const visible = rect.width > 0 && rect.height > 0
      && cs.visibility !== 'hidden' && cs.display !== 'none';
    // count submenu links currently displayed
    const openFlyouts = [...document.querySelectorAll('.nav-drop > ul')]
      .filter((ul) => getComputedStyle(ul).display !== 'none')
      .map((ul) => (ul.closest('li').querySelector(':scope > a')?.textContent || '').trim());
    return {
      tag: el.tagName.toLowerCase(),
      name,
      visible,
      offscreen: rect.bottom < 0 || rect.top > window.innerHeight,
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      boxShadow: cs.boxShadow === 'none' ? '' : 'shadow',
      openFlyouts,
    };
  });
  if (!info) break;
  stops.push(info);
}

console.log(`FOCUS ORDER @ ${width}px (${stops.length} stops)`);
stops.forEach((s, i) => {
  const ring = s.outline.startsWith('none') && !s.boxShadow ? '  ** NO FOCUS RING **' : '';
  const vis = s.visible ? '' : '  ** NOT VISIBLE **';
  console.log(`${String(i + 1).padStart(2)}. <${s.tag}> "${s.name}"${vis}${ring}`);
  if (s.openFlyouts.length) console.log(`      flyout open: ${s.openFlyouts.join(', ')}`);
});

await browser.close();
