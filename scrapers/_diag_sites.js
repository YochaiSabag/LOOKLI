// כלי אבחון חד-פעמי — לא חלק מהסקרייפרים. מריצים ב-Railway (פקודת התחלה: node ./scrapers/_diag_sites.js)
// בודק לכל אתר שלוש דרכים: (A) HTTP ישיר, (B) Playwright ישיר, (C) HTTP דרך הפרוקסי — ומדפיס סטטוס/אורך/כמה קישורי מוצר.
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { chromium } from 'playwright';
import { getProxyConfig } from './scraper_utils.js';

const SITES = [
  ['ORDMAN', 'https://www.ordman.co.il/product-category/ordman/'],
  ['AVIYAH', 'https://aviyahyosef.com/product-category/new-collection/'],
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const cfg = getProxyConfig();
let agent = null;
if (cfg) {
  const [scheme, rest] = cfg.server.split('://');
  agent = new HttpsProxyAgent(`${scheme}://${encodeURIComponent(cfg.username || '')}:${encodeURIComponent(cfg.password || '')}@${rest}`);
}
console.log('פרוקסי מוגדר:', cfg ? cfg.server : 'לא');

function get(url, useProxy, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const opts = { timeout: timeoutMs, rejectUnauthorized: false, headers: { 'User-Agent': UA, 'Accept-Language': 'he-IL,he;q=0.9' } };
    if (useProxy && agent) opts.agent = agent;
    const req = https.get(url, opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf-8');
        const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
        resolve({ status: res.statusCode, len: html.length, links: (html.match(/\/product\//g) || []).length, title: title.trim().slice(0, 60), ms: Date.now() - t0 });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
  });
}

const fmt = (r) => r.error ? `❌ ${r.error} (${r.ms}ms)` : `status=${r.status} len=${r.len} productLinks=${r.links} title="${r.title}" (${r.ms}ms)`;

for (const [name, url] of SITES) {
  console.log(`\n===== ${name} — ${url}`);
  console.log('A) HTTP ישיר     :', fmt(await get(url, false)));

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext({ userAgent: UA, locale: 'he-IL' })).newPage();
    const t0 = Date.now();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => ({ title: document.title.slice(0, 60), links: document.querySelectorAll('a[href*="/product/"]').length }));
    console.log(`B) Playwright ישיר: status=${resp?.status()} productLinks=${info.links} title="${info.title}" (${Date.now() - t0}ms)`);
    await browser.close();
  } catch (e) { console.log('B) Playwright ישיר: ❌', e.message.slice(0, 80)); }

  if (agent) console.log('C) HTTP בפרוקסי  :', fmt(await get(url, true)));
  else console.log('C) HTTP בפרוקסי  : דילוג (אין פרוקסי)');
}
console.log('\nסיום אבחון');
process.exit(0);
