/* eslint-disable no-console */
/**
 * Opens the mobile menu from the keyboard and reports what a keyboard /
 * screen-reader user actually gets: the button's exposed state, whether focus
 * moves into the menu, whether the menu is escapable, and where focus lands.
 */
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:3000/drafts/ppm-home';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const state = () => page.evaluate(() => {
  const btn = document.querySelector('.nav-hamburger button');
  const nav = document.getElementById('nav');
  const sections = document.querySelector('.nav-sections');
  const active = document.activeElement;
  return {
    btnAriaExpanded: btn?.getAttribute('aria-expanded') ?? '(absent)',
    btnAriaLabel: btn?.getAttribute('aria-label'),
    navAriaExpanded: nav?.getAttribute('aria-expanded'),
    sectionsVisible: sections ? getComputedStyle(sections).display !== 'none'
      && getComputedStyle(sections).visibility !== 'hidden' : null,
    focused: active ? `<${active.tagName.toLowerCase()}> ${(active.getAttribute('aria-label') || active.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)}` : 'none',
    bodyOverflow: document.body.style.overflowY,
  };
});

console.log('--- closed ---');
console.log(await state());

// focus the hamburger and activate it with the keyboard
await page.keyboard.press('Tab');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
console.log('\n--- after Enter on hamburger ---');
console.log(await state());

// where does Tab go next?
const order = [];
for (let i = 0; i < 6; i += 1) {
  /* eslint-disable no-await-in-loop */
  await page.keyboard.press('Tab');
  order.push(await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `<${a.tagName.toLowerCase()}> ${(a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 45)}` : 'body';
  }));
}
console.log('\n--- next 6 tab stops with menu open ---');
order.forEach((o, i) => console.log(` ${i + 1}. ${o}`));

// Escape behaviour
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
console.log('\n--- after Escape ---');
console.log(await state());

await browser.close();
