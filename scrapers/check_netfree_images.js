// scrapers/check_netfree_images.js
//
// גרסה עם Playwright (דפדפן אמיתי) — אתרים רבים חוסמים בקשות "יבשות" (fetch) כי הן
// לא נראות כמו דפדפן אמיתי. עם Playwright זה בדיוק אותו דבר שהסקרייפרים שלך כבר עושים.
//
// הרצה:  node scrapers/check_netfree_images.js
// רק חנות מסוימת:  node scrapers/check_netfree_images.js CHEMISE

import 'dotenv/config';
import { chromium } from 'playwright';
import pkg from 'pg';
const { Client } = pkg;

const MIN_VALID_BYTES = 15000; // עדכני לפי מה שלמדתם מ-analyze_image_sizes.js
const CONCURRENCY = 4; // כמה עמודי דפדפן פתוחים במקביל
const storeFilter = process.argv[2] || null;

const db = new Client({
  connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

async function checkImageUrl(page, url) {
  if (!url) return false;
  try {
    const response = await page.goto(url, { timeout: 20000, waitUntil: 'commit' });
    if (!response || !response.ok()) return false;
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.startsWith('image/')) return false;
    const buf = await response.body();
    return buf.length >= MIN_VALID_BYTES;
  } catch (e) {
    return false;
  }
}

async function processProduct(page, p) {
  const images = (p.images?.length ? p.images : (p.image_url ? [p.image_url] : []));
  if (!images.length) return { id: p.id, valid: false };
  for (const img of images) {
    const ok = await checkImageUrl(page, img);
    if (ok) return { id: p.id, valid: true };
  }
  return { id: p.id, valid: false };
}

async function run() {
  await db.connect();
  console.log(storeFilter ? `🔎 בודק תמונות עבור חנות: ${storeFilter}` : '🔎 בודק תמונות עבור כל המוצרים');

  const sql = storeFilter
    ? `SELECT id, images, image_url FROM products WHERE store = $1 AND (banned IS NULL OR banned=false) AND (hidden_stale IS NULL OR hidden_stale=false)`
    : `SELECT id, images, image_url FROM products WHERE (banned IS NULL OR banned=false) AND (hidden_stale IS NULL OR hidden_stale=false)`;
  const { rows } = await db.query(sql, storeFilter ? [storeFilter] : []);
  console.log(`📦 סה"כ ${rows.length} מוצרים לבדיקה\n`);

  const browser = await chromium.launch({ headless: true });
  let checked = 0, validCount = 0, blockedCount = 0;
  const queue = [...rows];

  async function worker() {
    const page = await browser.newPage();
    while (queue.length) {
      const p = queue.shift();
      const result = await processProduct(page, p);
      await db.query('UPDATE products SET has_valid_image=$1 WHERE id=$2', [result.valid, result.id]);
      checked++;
      if (result.valid) validCount++; else blockedCount++;
      if (checked % 25 === 0) console.log(`  ...${checked}/${rows.length} (תקינים: ${validCount}, חסומים: ${blockedCount})`);
    }
    await page.close();
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`🏁 סיום: ${validCount} תקינים | ${blockedCount} חסומים (מתוך ${rows.length})`);
  console.log(`${'='.repeat(50)}`);
  await db.end();
}

run().catch(e => { console.error('❌ שגיאה:', e.message); process.exit(1); });
