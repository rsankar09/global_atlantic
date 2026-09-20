import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const candidates = {
  'none (current)': '',
  'linear 90deg 65%->transparent': 'linear-gradient(90deg, rgb(0 0 0 / 65%) 0%, rgb(0 0 0 / 35%) 60%, transparent 100%)',
  'flat 50% black': 'rgb(0 0 0 / 50%)',
  'flat 55% black': 'rgb(0 0 0 / 55%)',
  'vertical 30->70%': 'linear-gradient(180deg, rgb(0 0 0 / 30%) 0%, rgb(0 0 0 / 70%) 100%)',
};
for (const w of [375, 1440]) {
  console.log(`\n===== ${w}px =====`);
  for (const [label, bg] of Object.entries(candidates)) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    await p.goto('http://localhost:3000/drafts/ppm-home', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    if (bg) {
      await p.addStyleTag({ content: `.hero::after{content:"";position:absolute;inset:0;z-index:-1;background:${bg};}` });
      await p.waitForTimeout(250);
    }
    // hide the text, screenshot exactly the H1 box, measure what is behind it
    const r = await p.evaluate(async () => {
      const h1 = document.querySelector('.hero h1');
      const box = h1.getBoundingClientRect();
      h1.style.visibility = 'hidden';
      return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
    });
    const buf = await p.screenshot({ clip: r });
    const stats = await p.evaluate(async (dataUrl) => {
      const img = new Image(); img.src = dataUrl;
      await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      let min = 99, below45 = 0, below3 = 0, tot = 0;
      for (let i = 0; i < d.length; i += 4) {
        const L = 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
        const ratio = 1.05 / (L + 0.05);
        if (ratio < min) min = ratio;
        if (ratio < 4.5) below45 += 1;
        if (ratio < 3) below3 += 1;
        tot += 1;
      }
      return { min: min.toFixed(2), pct45: ((below45 / tot) * 100).toFixed(1), pct3: ((below3 / tot) * 100).toFixed(1) };
    }, `data:image/png;base64,${buf.toString('base64')}`);
    console.log(`  ${label.padEnd(32)} worst ${String(stats.min).padStart(6)}:1   below4.5: ${String(stats.pct45).padStart(5)}%   below3: ${String(stats.pct3).padStart(5)}%`);
    await p.close();
  }
}
await b.close();
