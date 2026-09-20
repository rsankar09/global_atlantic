import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
for (const width of [375, 1440]) {
  const p = await b.newPage({ viewport: { width, height: 900 } });
  await p.goto('http://localhost:3000/drafts/ppm-home', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(2500);
  const imgs = await p.evaluate(() => [...document.images].map(i => ({
    src: i.currentSrc.split('/').pop().slice(0, 40),
    loading: i.loading,
    complete: i.complete,
    nat: `${i.naturalWidth}x${i.naturalHeight}`,
    box: `${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}`,
  })));
  console.log(`\n=== ${width} ===`);
  imgs.forEach(i => console.log(`  ${i.complete && i.nat !== '0x0' ? 'OK ' : 'BAD'} ${i.src} loading=${i.loading} nat=${i.nat} box=${i.box}`));
  await p.close();
}
await b.close();
