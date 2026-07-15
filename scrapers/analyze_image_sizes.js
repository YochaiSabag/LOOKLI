// scrapers/analyze_image_sizes.js
//
// מריצים מהבית (עם נטפרי) עם דפדפן אמיתי (Playwright) — עובר על מדגם מוצרים מכל חנות,
// בודק את גודל התמונה הראשית שלהם בפועל, ומדפיס טבלה + 3 הקישורים הקטנים ביותר לבדיקה ידנית.
//
// הרצה:  node scrapers/analyze_image_sizes.js
// מדגם מותאם: node scrapers/analyze_image_sizes.js 30

import 'dotenv/config';
import { chromium } from 'playwright';
import pkg from 'pg';
const { Client } = pkg;

const SAMPLE_SIZE = parseInt(process.argv[2]) || 25;

const db = new Client({
  connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

async function getImageSizeKB(page, url) {
  try {
    const response = await page.goto(url, { timeout: 20000, waitUntil: 'commit' });
    if (!response || !response.ok()) return null;
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.startsWith('image/')) return null;
    const buf = await response.body();
    return buf.length / 1024;
  } catch (e) {
    return null;
  }
}

function median(arr) {
  const s = [...arr].sort((a,b)=>a-b);
  const mid = Math.floor(s.length/2);
  return s.length % 2 ? s[mid] : (s[mid-1]+s[mid])/2;
}

async function run() {
  await db.connect();
  const storesRes = await db.query(`SELECT DISTINCT store FROM products WHERE store IS NOT NULL ORDER BY store`);
  const stores = storesRes.rows.map(r => r.store);
  console.log(`📊 מנתח ${stores.length} חנויות, מדגם ${SAMPLE_SIZE} מוצרים כל אחת\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const store of stores) {
    const prodRes = await db.query(
      `SELECT image_url FROM products WHERE store=$1 AND image_url IS NOT NULL
       AND (banned IS NULL OR banned=false) AND (hidden_stale IS NULL OR hidden_stale=false)
       ORDER BY RANDOM() LIMIT $2`,
      [store, SAMPLE_SIZE]
    );
    const sizes = [];
    for (const row of prodRes.rows) {
      const kb = await getImageSizeKB(page, row.image_url);
      if (kb !== null) sizes.push({ kb, url: row.image_url });
    }
    if (!sizes.length) {
      console.log(`${store.padEnd(14)} — לא נמצאו תמונות תקינות לבדיקה`);
      continue;
    }
    const kbOnly = sizes.map(s => s.kb);
    const min = Math.min(...kbOnly), max = Math.max(...kbOnly);
    const avg = kbOnly.reduce((a,b)=>a+b,0)/kbOnly.length;
    const med = median(kbOnly);
    console.log(`\n${store.padEnd(14)} | דגימות: ${String(sizes.length).padStart(3)} | מינימום: ${min.toFixed(1).padStart(6)}KB | חציון: ${med.toFixed(1).padStart(6)}KB | ממוצע: ${avg.toFixed(1).padStart(6)}KB | מקסימום: ${max.toFixed(1).padStart(6)}KB`);

    const smallest3 = [...sizes].sort((a,b)=>a.kb-b.kb).slice(0,3);
    smallest3.forEach(s => console.log(`   🔍 ${s.kb.toFixed(1)}KB — ${s.url}`));
  }

  await browser.close();
  console.log(`\n${'='.repeat(50)}`);
  console.log('💡 טיפ: אם ה"מינימום" בחנות מסוימת נמוך משמעותית מה"חציון" שלה — כנראה יש שם גם תמונות חסומות במדגם.');
  await db.end();
}

run().catch(e => { console.error('❌ שגיאה:', e.message); process.exit(1); });
