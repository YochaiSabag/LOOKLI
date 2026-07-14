// scrapers/check_netfree_images.js
//
// סקריפט עצמאי — לא נוגע בשום סקרייפר קיים.
// מריצים אותו ממחשב עם נטפרי (או כל רשת חוסמת אחרת). הוא עובר על כל התמונות
// של כל המוצרים, בודק אם התמונה נחסמה (קובץ קטן מדי / לא תמונה בכלל),
// ומעדכן את העמודה has_valid_image ב-DB: true אם יש למוצר לפחות תמונה אחת תקינה,
// false אם כל התמונות שלו חסומות.
//
// הרצה:  node scrapers/check_netfree_images.js
// אפשר גם להריץ רק על חנות מסוימת:  node scrapers/check_netfree_images.js CHEMISE

import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;

const MIN_VALID_BYTES = 35000; // מתחת לזה = כנראה חסום (תמונת מוצר אמיתית תמיד גדולה בהרבה)
const CONCURRENCY = 5;        // כמה תמונות בודקים במקביל
const storeFilter = process.argv[2] || null;

const db = new Client({
  connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

async function checkImageUrl(url) {
  if (!url) return false;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return false;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return false; // חזר HTML/שגיאה במקום תמונה = בוודאות חסום
    const buf = await resp.arrayBuffer();
    return buf.byteLength >= MIN_VALID_BYTES;
  } catch (e) {
    return false; // timeout/שגיאת רשת — לא סומכים, מסמנים כלא-תקין (עדיף לפספס מוצר מאשר להראות תמונה חסומה)
  }
}

async function processProduct(p) {
  const images = (p.images?.length ? p.images : (p.image_url ? [p.image_url] : []));
  if (!images.length) return { id: p.id, valid: false };
  for (const img of images) {
    const ok = await checkImageUrl(img);
    if (ok) return { id: p.id, valid: true }; // מספיקה תמונה אחת תקינה
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

  let checked = 0, validCount = 0, blockedCount = 0;
  const queue = [...rows];

  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      const result = await processProduct(p);
      await db.query('UPDATE products SET has_valid_image=$1 WHERE id=$2', [result.valid, result.id]);
      checked++;
      if (result.valid) validCount++; else blockedCount++;
      if (checked % 25 === 0) console.log(`  ...${checked}/${rows.length} (תקינים: ${validCount}, חסומים: ${blockedCount})`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n${'='.repeat(50)}`);
  console.log(`🏁 סיום: ${validCount} תקינים | ${blockedCount} חסומים (מתוך ${rows.length})`);
  console.log(`${'='.repeat(50)}`);
  await db.end();
}

run().catch(e => { console.error('❌ שגיאה:', e.message); process.exit(1); });
