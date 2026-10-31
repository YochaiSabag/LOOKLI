// אבחון חד-פעמי: האם הפרוקסי יכול לעבור את אתגר Cloudflare של אורדמן? בודק כמה וריאנטים (3 בקשות בלבד)
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxyConfig } from './scraper_utils.js';

const URL_ = 'https://www.ordman.co.il/product-category/ordman/';
const cfg = getProxyConfig();
if (!cfg) { console.log('אין פרוקסי מוגדר'); process.exit(0); }
const [scheme, rest] = cfg.server.split('://');
const agent = new HttpsProxyAgent(`${scheme}://${encodeURIComponent(cfg.username || '')}:${encodeURIComponent(cfg.password || '')}@${rest}`);

const VARIANTS = [
  ['רגיל', {}],
  ['javascript=true', { 'CrawlbaseAPI-Parameters': 'javascript=true' }],
  ['javascript=true + country=IL', { 'CrawlbaseAPI-Parameters': 'javascript=true&country=IL' }],
];
function get(headers) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get(URL_, { agent, timeout: 90000, rejectUnauthorized: false,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf-8');
        resolve(`status=${res.statusCode} len=${html.length} productLinks=${(html.match(/\/product\//g) || []).length} title="${((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim().slice(0, 50)}" pc_status=${res.headers['pc_status'] || '-'} (${Date.now() - t0}ms)`);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve(`❌ ${e.message}`));
  });
}
for (const [name, h] of VARIANTS) console.log(`${name.padEnd(30)}:`, await get(h));
console.log('סיום');
process.exit(0);
