/**
 * chemise_kids_cleanup.js — בדיקה חד-פעמית של מוצרי CHEMISE הקיימים ב-DB
 *
 * הבעיה: המידות הגולמיות (7,8,9,10,12,14...) שמזהות בגדי ילדים אף פעם לא נשמרו ב-DB —
 * רק המידות המנורמלות (S/M/L וכו') נשמרות, וכשמידה לא מוכרת (כמו "7") היא פשוט נופלת
 * ונשארת רשימת מידות ריקה. אי אפשר להבדיל מה-DB בין "מוצר ילדים" ל"מוצר מבוגרים שאזל
 * זמנית מהמלאי" — שניהם נראים אותו דבר (sizes = {}).
 *
 * הפתרון: נכנסים מחדש לדף המוצר האמיתי באתר, שולפים את המידות הגולמיות העדכניות,
 * ומריצים עליהן בדיוק את אותה פונקציה (isKidsSizeOnly) שכבר פועלת בסקרייפר הרגיל.
 * ככה הבדיקה מדויקת ולא מבוססת ניחוש.
 *
 * ברירת מחדל: DRY RUN בלבד — מדפיס ושומר רשימת מועמדים למחיקה, לא מוחק כלום.
 * הרצת מחיקה בפועל: CONFIRM_DELETE=true node ./scrapers/chemise_kids_cleanup.js
 *
 * הרצה:
 *   node ./scrapers/chemise_kids_cleanup.js                → תצוגה בלבד (בטוח)
 *   CONFIRM_DELETE=true node ./scrapers/chemise_kids_cleanup.js  → מוחק בפועל את מה שנמצא
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import pkg from 'pg';
import fs from 'fs';
import { loadScraperConfig } from './scraper_utils.js';

const { Client } = pkg;
const connStr = process.env.DATABASE_URL;
const useSSL = connStr && (connStr.includes('rlwy.net') || connStr.includes('amazonaws.com') || connStr.includes('supabase'));
const db = new Client({ connectionString: connStr, ssl: useSSL ? { rejectUnauthorized: false } : undefined });
await db.connect();

const { isKidsSizeOnly } = await loadScraperConfig(db);

const CONFIRM_DELETE = process.env.CONFIRM_DELETE === 'true';
console.log(CONFIRM_DELETE
  ? '⚠️  מצב מחיקה בפועל פעיל (CONFIRM_DELETE=true) — פריטים שיזוהו כילדים יימחקו מה-DB!'
  : '👀 מצב תצוגה בלבד (dry run) — שום דבר לא יימחק. להרצת מחיקה בפועל: CONFIRM_DELETE=true');

const { rows: products } = await db.query(
  `SELECT id, title, source_url FROM products WHERE store = 'CHEMISE' ORDER BY id`
);
console.log(`🔎 נבדקים ${products.length} מוצרי CHEMISE מול האתר החי...\n`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
});

const kidsFound = [];
const notFound404 = [];
let checked = 0, errors = 0;

for (const p of products) {
  checked++;
  const page = await context.newPage();
  try {
    const resp = await page.goto(p.source_url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (!resp || resp.status() === 404) {
      notFound404.push(p);
      console.log(`  [${checked}/${products.length}] ⚠️ 404/לא נטען: ${p.title?.substring(0, 40)}`);
      continue;
    }
    await page.waitForTimeout(800);

    const rawSizeLabels = await page.evaluate(() => {
      const raw = [];
      document.querySelectorAll('.variable-items-wrapper li, ul.variable-items-wrapper li').forEach(el => {
        const wrapper = el.closest('[data-attribute_name], [data-attribute-name]');
        const attrName = wrapper?.getAttribute('data-attribute_name') ||
                         wrapper?.getAttribute('data-attribute-name') ||
                         el.getAttribute('data-attribute_name') || '';
        const isColor = attrName.includes('color') || attrName.includes('צבע') ||
                        attrName.includes('pa_color') || attrName.includes('גוון') ||
                        el.querySelector('.variable-item-span-color') !== null;
        const isSize = !isColor && (attrName.includes('size') || attrName.includes('מידה') || attrName.includes('pa_size'));
        if (!isSize) return;
        const title = el.getAttribute('data-title') || el.getAttribute('title') ||
                      el.getAttribute('aria-label') || el.getAttribute('data-value') ||
                      el.querySelector('[title]')?.getAttribute('title') || '';
        if (title) raw.push(decodeURIComponent(title));
      });
      if (raw.length === 0) {
        document.querySelectorAll('select[name*="size"] option, select[name*="pa_size"] option, select[name*="מידה"] option').forEach(opt => {
          const val = opt.textContent?.trim();
          if (val && !val.includes('בחירת')) raw.push(val);
        });
      }
      return raw;
    });

    const isKids = isKidsSizeOnly(rawSizeLabels);
    console.log(`  [${checked}/${products.length}] ${isKids ? '🧒 ילדים' : '✓ תקין'} — מידות: [${rawSizeLabels.join(',') || '-'}] — ${p.title?.substring(0, 40)}`);

    if (isKids) {
      kidsFound.push({ ...p, rawSizeLabels });
      if (CONFIRM_DELETE) {
        await db.query('DELETE FROM products WHERE id = $1', [p.id]);
        console.log(`      🗑️  נמחק (id ${p.id})`);
      }
    }
  } catch (e) {
    errors++;
    console.log(`  [${checked}/${products.length}] ✗ שגיאה: ${e.message.substring(0, 60)} — ${p.title?.substring(0, 40)}`);
  } finally {
    await page.close();
  }
}

await browser.close();
await db.end();

console.log(`\n${'─'.repeat(50)}`);
console.log(`📊 סיכום: נבדקו ${checked} | זוהו כילדים ${kidsFound.length} | 404 ${notFound404.length} | שגיאות ${errors}`);

const reportPath = './chemise_kids_report.json';
fs.writeFileSync(reportPath, JSON.stringify({ checkedAt: new Date().toISOString(), deleted: CONFIRM_DELETE, kidsFound, notFound404 }, null, 2), 'utf-8');
console.log(`📄 דוח מלא נשמר ל-${reportPath}`);

if (!CONFIRM_DELETE && kidsFound.length > 0) {
  console.log(`\n👀 זה היה dry-run — שום דבר לא נמחק. אחרי שבדקת את הרשימה למעלה (או את ${reportPath}) ואישרת שהיא נכונה,`);
  console.log(`   הריצי שוב עם: CONFIRM_DELETE=true node ./scrapers/chemise_kids_cleanup.js`);
}
