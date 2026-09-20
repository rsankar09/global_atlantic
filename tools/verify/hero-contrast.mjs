import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:3000/drafts/ppm-home', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
const r = await p.evaluate(async () => {
  const img = document.querySelector('.hero img');
  const h1 = document.querySelector('.hero h1');
  const hb = document.querySelector('.hero').getBoundingClientRect();
  const tb = h1.getBoundingClientRect();
  const cv = document.createElement('canvas');
  cv.width = Math.round(hb.width); cv.height = Math.round(hb.height);
  const cx = cv.getContext('2d');
  // replicate object-fit: cover
  const s = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  cx.drawImage(img, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
  const x0 = Math.round(tb.left - hb.left), y0 = Math.round(tb.top - hb.top);
  const w = Math.round(tb.width), h = Math.round(tb.height);
  const lum = (R, G, B) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B);
  };
  // sample the text band in 8 horizontal slices
  const slices = [];
  for (let i = 0; i < 8; i += 1) {
    const sx = x0 + Math.round((w / 8) * i);
    const d = cx.getImageData(sx, y0, Math.round(w / 8), h).data;
    let L = 0, n = 0;
    for (let k = 0; k < d.length; k += 4 * 17) { L += lum(d[k], d[k + 1], d[k + 2]); n += 1; }
    const bgL = L / n;
    const ratio = (1.0 + 0.05) / (bgL + 0.05); // white text
    slices.push({ slice: i, xFrom: sx, bgLum: +bgL.toFixed(3), contrastVsWhite: +ratio.toFixed(2) });
  }
  return { textBox: { x: x0, y: y0, w, h }, slices };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
