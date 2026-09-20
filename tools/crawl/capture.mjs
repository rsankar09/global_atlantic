/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
/**
 * EDS site crawl — capture bundle generator.
 *
 * Usage:
 *   node tools/crawl/capture.mjs <url> [<url> ...] [--out ./capture] [--bp 375,768,1440]
 *     [--urls urls.txt] [--delay 4000] [--resume]
 */
import { chromium } from '/Users/a10359614/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const urls = [];
let outDir = './capture';
let breakpoints = [375, 768, 1440];
let delayMs = 4000;
let resume = false;
let urlFile = null;

for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--out') { outDir = args[i += 1]; } else if (a === '--bp') {
    breakpoints = args[i += 1].split(',').map(Number);
  } else if (a === '--delay') { delayMs = Number(args[i += 1]); } else if (a === '--urls') {
    urlFile = args[i += 1];
  } else if (a === '--resume') { resume = true; } else { urls.push(a); }
}

if (urlFile) {
  const txt = await fs.readFile(urlFile, 'utf8');
  txt.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((l) => urls.push(l));
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/*
 * The origin sits behind a WAF that answers throttled requests with HTTP 200
 * and a "Restricted" body rather than a 429. A naive crawler therefore records
 * block pages as successful captures — the failure mode that poisoned the
 * first run of this bundle. Detect it by content, never by status code.
 */
const WAF_BLOCKED = () => /<title>\s*Restricted\s*<\/title>/i.test(document.documentElement.outerHTML)
  || /Access to this (page|site) (is|has been) restricted/i.test(document.body.innerText || '');

const TRACKING_PARAMS = /^(utm_|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|ref|igshid)/i;

function normalise(raw) {
  const u = new URL(raw);
  [...u.searchParams.keys()].forEach((k) => { if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k); });
  u.hash = '';
  return u.toString();
}

function slugify(raw) {
  const u = new URL(raw);
  const p = `${u.hostname}${u.pathname}`.replace(/\/$/, '');
  return p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'home';
}

// --- in-page helpers (stringified into the browser context) ---

/*
 * Consent and gate dismissal.
 *
 * Beyond the usual cookie-banner selectors, PPM's disclosure interstitial
 * carries no id, class or aria-label a selector can reach, so it is matched on
 * its button label instead. Two guards keep that from misfiring:
 *
 *   - the control must sit inside a dialog or a stacked fixed/absolute overlay,
 *     so an ordinary "Accept" button in page content is never clicked;
 *   - only ACCEPT is matched, never DECLINE -- declining leaves the content
 *     gated, which is the failure this is meant to prevent.
 *
 * The overlay test is repeated in HAS_BANNER rather than shared, because each
 * of these functions is stringified into the browser context on its own.
 */
const DISMISS = () => {
  const SELECTORS = [
    '#onetrust-accept-btn-handler',
    '.onetrust-close-btn-handler',
    '#truste-consent-button',
    'button[aria-label*="accept" i]',
    'button[id*="accept-cookie" i]',
    'button[class*="accept-cookie" i]',
    '[data-testid*="accept" i]',
    '.cookie-banner button',
    '#cookie-accept',
    /*
     * PPM's disclosure agreement. Measured from the captured DOM:
     *   div.cmp-modal_overlay > div.cmp-modal[role=dialog][data-decline-url]
     *     > ... > div.dialog_form_actions > div.button > button#accept_id
     * The id is stable across all 46 captured instances, so it is tried before
     * the label fallback below.
     */
    '#accept_id',
    '.cmp-modal .dialog_form_actions button.cmp-button',
  ];
  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) { el.click(); return sel; }
  }

  // label-matched modal gates, e.g. PPM's disclosure agreement
  const inOverlay = (start) => {
    for (let n = start; n && n !== document.body; n = n.parentElement) {
      if (n.tagName === 'DIALOG' || n.getAttribute('role') === 'dialog'
        || n.getAttribute('role') === 'alertdialog') return true;
      const s = getComputedStyle(n);
      if ((s.position === 'fixed' || s.position === 'absolute')
        && Number.parseInt(s.zIndex, 10) >= 100) return true;
    }
    return false;
  };
  const gate = [...document.querySelectorAll(
    'button, a[href], input[type="button"], input[type="submit"]',
  )].find((el) => {
    const label = (el.value || el.textContent || '').trim();
    if (!/^accept\b/i.test(label)) return false;
    if (el.offsetParent === null || el.getBoundingClientRect().height === 0) return false;
    return inOverlay(el);
  });
  if (gate) { gate.click(); return `label:accept (${gate.tagName.toLowerCase()})`; }

  return null;
};

const HAS_BANNER = () => {
  const LEFTOVER = ['#onetrust-banner-sdk', '#onetrust-consent-sdk .onetrust-pc-dark-filter', '.cookie-banner', '#truste-consent-track', '.cmp-modal_overlay', '.cmp-modal[aria-hidden="false"]'];
  if (LEFTOVER.some((s) => {
    const el = document.querySelector(s);
    return el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
  })) return true;

  // a label-matched gate still on screen means the dismiss did not take
  const inOverlay = (start) => {
    for (let n = start; n && n !== document.body; n = n.parentElement) {
      if (n.tagName === 'DIALOG' || n.getAttribute('role') === 'dialog'
        || n.getAttribute('role') === 'alertdialog') return true;
      const s = getComputedStyle(n);
      if ((s.position === 'fixed' || s.position === 'absolute')
        && Number.parseInt(s.zIndex, 10) >= 100) return true;
    }
    return false;
  };
  return [...document.querySelectorAll(
    'button, a[href], input[type="button"], input[type="submit"]',
  )].some((el) => {
    const label = (el.value || el.textContent || '').trim();
    if (!/^accept\b/i.test(label)) return false;
    if (el.offsetParent === null || el.getBoundingClientRect().height === 0) return false;
    return inOverlay(el);
  });
};

const AUTOSCROLL = async () => {
  await new Promise((resolve) => {
    let y = 0;
    const step = 400;
    const timer = setInterval(() => {
      window.scrollBy(0, step);
      y += step;
      if (y >= document.body.scrollHeight) { clearInterval(timer); resolve(); }
    }, 60);
    setTimeout(() => { clearInterval(timer); resolve(); }, 20000);
  });
  window.scrollTo(0, 0);
};

const LAZY_PENDING = () => [...document.images].filter((img) => {
  const src = img.getAttribute('src');
  return !src || /^data:image\/(gif|svg)/.test(src) || img.hasAttribute('data-src') && !img.complete;
}).length;

const COLLECT_STYLES = () => {
  const PROPS = [
    'color', 'background-color', 'background-image', 'font-family', 'font-size', 'font-weight',
    'line-height', 'letter-spacing', 'text-align', 'text-transform',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'display', 'position', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'grid-template-rows',
    'border-top-width', 'border-bottom-width', 'border-radius', 'border-color', 'border-style',
    'box-shadow', 'max-width', 'width', 'min-height', 'overflow',
  ];

  const selectorPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) { part += `#${node.id}`; parts.unshift(part); break; }
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
      if (cls.length) part += `.${cls.join('.')}`;
      const parent = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
      if (node === document.documentElement) break;
    }
    return parts.join(' > ');
  };

  const snapshot = (el, role, depth) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const computed = {};
    PROPS.forEach((p) => { computed[p] = cs.getPropertyValue(p); });
    return {
      role,
      depth,
      selector_path: selectorPath(el),
      tag: el.tagName.toLowerCase(),
      classes: (el.getAttribute('class') || '').trim(),
      id: el.id || null,
      text_preview: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160),
      child_count: el.children.length,
      computed,
      rect: {
        x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height),
      },
    };
  };

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TEMPLATE', 'BR']);
  const rendered = (el) => {
    if (SKIP.has(el.tagName)) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 || r.width > 0;
  };
  const kids = (el) => [...el.children].filter(rendered);

  /**
   * Find the real content root. Many CMS templates (AEM here) wrap the whole page in
   * one or more generic containers (div.root.container > div.responsivegrid > ...).
   * Walking body.children would yield only <script> tags + one mega-wrapper, so we
   * descend through single-child wrappers until we reach the node that actually
   * branches into sibling sections.
   */
  const findContentRoot = () => {
    const main = document.querySelector('main');
    let node = main || document.body;
    let guard = 0;
    while (guard < 12) {
      guard += 1;
      const children = kids(node).filter((c) => !['HEADER', 'NAV', 'FOOTER'].includes(c.tagName));
      if (children.length !== 1) break;
      const only = children[0];
      // only descend if the single child carries essentially all the height
      const nodeH = node.getBoundingClientRect().height;
      const childH = only.getBoundingClientRect().height;
      if (nodeH > 0 && childH / nodeH < 0.8) break;
      if (kids(only).length === 0) break;
      node = only;
    }
    return node;
  };

  const out = [];
  const seen = new Set();
  const push = (el, role, depth) => {
    if (!el || seen.has(el) || !rendered(el)) return;
    seen.add(el);
    out.push(snapshot(el, role, depth));
  };

  ['header', 'nav', 'footer'].forEach((tag) => {
    document.querySelectorAll(tag).forEach((el) => push(el, tag, 0));
  });

  const WRAPPER_CLASS = /(^|[\s-])(container|responsivegrid|aem-grid|grid|row|wrapper)([\s-]|$)/i;
  const SEMANTIC = new Set(['SECTION', 'ARTICLE', 'ASIDE', 'FIGURE', 'UL', 'OL', 'TABLE', 'FORM', 'PICTURE', 'VIDEO', 'BLOCKQUOTE']);

  const hasOwnText = (el) => [...el.childNodes]
    .some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);

  /** A pure layout wrapper carries no content of its own — it only positions children. */
  const isWrapper = (el) => {
    if (SEMANTIC.has(el.tagName)) return false;
    if (hasOwnText(el)) return false;
    if (el.tagName === 'IMG' || el.tagName === 'A' || el.tagName === 'BUTTON') return false;
    const cls = el.getAttribute('class') || '';
    const children = kids(el);
    if (children.length === 0) return false;
    if (children.length === 1) return true;
    return WRAPPER_CLASS.test(cls) && !/cmp-(teaser|text|image|title|button|carousel|card|list|tabs|accordion)/i.test(cls);
  };

  const root = findContentRoot();
  push(root, 'content-root', 0);

  /**
   * Capture every rendered element rather than guessing which nodes are "components"
   * at crawl time. Deciding that is eds-component-detect's job, and a wrong guess here
   * silently drops evidence it can't recover without a re-crawl. Each record carries
   * depth + is_layout so downstream can collapse wrappers itself.
   * `top_section` marks the first branching level, i.e. the page's visual bands.
   */
  const MAX = 1500;
  const topSections = new Set(kids(root));
  const walk = (el, depth) => {
    if (out.length > MAX || depth > 24) return;
    kids(el).forEach((child) => {
      if (out.length > MAX) return;
      const wrapper = isWrapper(child);
      let role = wrapper ? 'layout' : 'element';
      if (topSections.has(child)) role = 'section';
      push(child, role, depth);
      const rec = out[out.length - 1];
      if (rec && rec.selector_path) {
        rec.is_layout = wrapper;
        rec.top_section = topSections.has(child);
      }
      walk(child, depth + 1);
    });
  };
  walk(root, 1);
  if (out.length > MAX) out.push({ role: 'truncation-notice', note: `element walk capped at ${MAX} records` });
  return out;
};

const COLLECT_META = () => ({
  page_title: document.title,
  meta_description: document.querySelector('meta[name="description"]')?.content || null,
  lang: document.documentElement.lang || null,
  h1: [...document.querySelectorAll('h1')].map((h) => h.innerText.trim()),
  heading_outline: [...document.querySelectorAll('h1,h2,h3')].map((h) => ({ level: h.tagName, text: h.innerText.trim().slice(0, 120) })),
  internal_links: [...new Set([...document.querySelectorAll('a[href]')]
    .map((a) => a.href)
    .filter((h) => { try { return new URL(h).hostname === location.hostname && /^https?:/.test(h); } catch { return false; } })
    .map((h) => h.split('#')[0]))].sort(),
  image_count: document.images.length,
  body_text_length: (document.body.innerText || '').trim().length,
});

// --- main ---

async function capturePage(browser, rawUrl) {
  const url = normalise(rawUrl);
  const slug = slugify(url);
  const dir = path.join(outDir, slug);

  const result = {
    url, slug, dir, notes: [], jsErrors: [], status: null, ok: false,
  };

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => result.jsErrors.push(String(e).slice(0, 300)));

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    result.status = resp ? resp.status() : null;
    try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch { result.notes.push('networkidle timed out (30s) — captured anyway'); }

    // Bail out before writing anything if the WAF served a block page.
    if (await page.evaluate(WAF_BLOCKED)) {
      result.waf_blocked = true;
      result.notes.push('WAF_BLOCKED: origin returned a "Restricted" block page (HTTP 200) — nothing captured');
      return result;
    }

    // cookie / consent dismiss (retry: banners often mount late)
    let dismissed = null;
    for (let attempt = 0; attempt < 3 && !dismissed; attempt += 1) {
      dismissed = await page.evaluate(DISMISS);
      if (!dismissed) await page.waitForTimeout(1500);
    }
    result.consent_dismissed = dismissed;
    await page.waitForTimeout(800);
    if (await page.evaluate(HAS_BANNER)) result.notes.push('consent banner still visible after dismiss attempts — may appear in screenshots');

    // trigger lazy content
    await page.evaluate(AUTOSCROLL);
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { /* fine */ }
    await page.waitForTimeout(1000);

    let pending = await page.evaluate(LAZY_PENDING);
    if (pending > 0) {
      await page.evaluate(AUTOSCROLL);
      await page.waitForTimeout(2000);
      pending = await page.evaluate(LAZY_PENDING);
      if (pending > 0) result.notes.push(`${pending} image(s) still without a real src after two scroll passes`);
    }

    const pageMeta = await page.evaluate(COLLECT_META);
    Object.assign(result, pageMeta);

    // auth wall / empty body detection
    if (pageMeta.body_text_length < 200) result.notes.push('body text under 200 chars — page may be empty or JS-blocked');
    if (/log ?in|sign ?in|password/i.test(pageMeta.page_title) && pageMeta.body_text_length < 1500) result.notes.push('looks like a login/auth wall');

    // Only now that the page is known-good does the bundle directory get
    // created, so a blocked or failed page leaves no empty shell behind.
    await fs.mkdir(path.join(dir, 'screenshots'), { recursive: true });

    // screenshots per breakpoint
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp, height: Math.round(bp * 0.75) + 400 });
      await page.waitForTimeout(700);
      await page.evaluate(AUTOSCROLL);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(dir, 'screenshots', `${bp}.png`), fullPage: true });
    }

    // DOM + styles at desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
    await page.evaluate(AUTOSCROLL);
    await page.waitForTimeout(500);

    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const styles = await page.evaluate(COLLECT_STYLES);

    // Responsive markup check: compare like with like — a live element-count and a
    // structural tag signature taken the same way at both widths. If they differ, the
    // site swaps markup per breakpoint and one desktop DOM is NOT representative.
    const SIGNATURE = () => ({
      nodes: document.querySelectorAll('*').length,
      pictures: document.querySelectorAll('picture source').length,
      tagSig: [...document.querySelectorAll('*')].map((e) => e.tagName).join(',').length,
    });
    const desktopSig = await page.evaluate(SIGNATURE);
    await page.setViewportSize({ width: breakpoints[0], height: 700 });
    await page.waitForTimeout(1000);
    const mobileSig = await page.evaluate(SIGNATURE);

    const swapped = desktopSig.nodes !== mobileSig.nodes || desktopSig.tagSig !== mobileSig.tagSig;
    result.responsive_markup_swap = swapped;
    result.responsive_note = swapped
      ? `RESPONSIVE MARKUP SWAP DETECTED: ${desktopSig.nodes} elements at 1440px vs ${mobileSig.nodes} at ${breakpoints[0]}px. The desktop DOM is not representative of mobile — re-capture per breakpoint before relying on dom.json for mobile.`
      : `No responsive markup swap: element count and tag signature identical at ${breakpoints[0]}px and 1440px (${desktopSig.nodes} elements). Single desktop DOM capture is representative. ${desktopSig.pictures} <picture><source> entries.`;
    result.consent_banner_present = await page.evaluate(() => ['onetrust-banner-sdk', 'cookie-banner', 'truste-consent-track']
      .some((id) => document.querySelector(`#${id}, .${id}`)));

    await fs.writeFile(path.join(dir, 'dom.json'), JSON.stringify({ html }, null, 0));
    await fs.writeFile(path.join(dir, 'styles.json'), JSON.stringify(styles, null, 2));
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({
      url,
      crawled_at: new Date().toISOString(),
      breakpoints,
      page_title: pageMeta.page_title,
      meta_description: pageMeta.meta_description,
      lang: pageMeta.lang,
      http_status: result.status,
      truncated: false,
      consent_dismissed: dismissed,
      notes: result.notes,
      js_errors: result.jsErrors,
      heading_outline: pageMeta.heading_outline,
      h1: pageMeta.h1,
      image_count: pageMeta.image_count,
      body_text_length: pageMeta.body_text_length,
      dom_section_count: styles.filter((s) => s.role === 'section').length,
      style_record_count: styles.length,
      responsive_markup_swap: result.responsive_markup_swap,
      responsive_note: result.responsive_note,
      consent_banner_present: result.consent_banner_present,
      internal_links: pageMeta.internal_links,
    }, null, 2));

    result.ok = true;
    result.sections = styles.filter((s) => s.role === 'section').length;
  } catch (e) {
    result.notes.push(`FAILED: ${String(e).slice(0, 400)}`);
  } finally {
    await context.close();
  }
  return result;
}

const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const results = [];

for (const [i, u] of urls.entries()) {
  const slug = slugify(normalise(u));
  let alreadyCaptured = false;
  if (resume) {
    try {
      await fs.access(path.join(outDir, slug, 'meta.json'));
      alreadyCaptured = true;
      process.stderr.write(`↷ skip (already captured) ${u}\n`);
    } catch { /* not captured yet */ }
  }

  if (!alreadyCaptured) {
    process.stderr.write(`→ [${i + 1}/${urls.length}] ${u}\n`);
    let r = await capturePage(browser, u);

    /*
     * A WAF block is a throttling signal, not a page defect: back off hard and
     * retry rather than burning through the rest of the list collecting block
     * pages. Escalating waits give the rate-limit window time to roll over.
     */
    for (let attempt = 1; attempt <= 3 && r.waf_blocked; attempt += 1) {
      const backoff = 60000 * 2 ** (attempt - 1); // 1m, 2m, 4m
      process.stderr.write(`  ⚠ WAF block — backing off ${backoff / 1000}s (retry ${attempt}/3)\n`);
      await sleep(backoff);
      r = await capturePage(browser, u);
    }
    if (r.waf_blocked) process.stderr.write('  ✗ blocked after 3 retries — recorded as failed\n');

    results.push(r);
    if (i < urls.length - 1) await sleep(delayMs);
  }
}
await browser.close();

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'crawl-report.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map((r) => ({
  url: r.url, slug: r.slug, ok: r.ok, status: r.status, title: r.page_title, sections: r.sections, notes: r.notes, jsErrors: r.jsErrors?.length,
})), null, 2));
