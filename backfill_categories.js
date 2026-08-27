// backfill_categories.js
//
// סקריפט חד-פעמי: מריץ מחדש את זיהוי הקטגוריה (detectCategory) על מוצרים קיימים
// שה-category שלהם NULL, בלי לחכות שכל אחת מ-16 החנויות תיסרק מחדש.
//
// נחוץ בגלל שהוספנו קטגוריות חדשות (תכשיטים/אביזרים/נעליים) ל-DEFAULT_CATEGORIES
// ב-scraper_utils.js - הוספה הזו רק משפיעה על מוצרים חדשים/סריקות עתידיות.
// מוצרים שכבר בדאטה-בייס מלפני זה עדיין עם category=NULL, ולכן לא נכנסים
// לסינון ההסתרה (כי הסינון הוא "NOT IN (...)" ו-NULL תמיד עובר את זה).
//
// בטיחות:
// - נוגע רק במוצרים עם category IS NULL - אף פעם לא דורס קטגוריה קיימת
// - מכבד את הגנת tagged_fields (טריגר DB) - אם מוצר תויג ידנית עם category
//   הוא ממילא לא יהיה NULL, אז לא ניגע בו
// - הרצה יבשה (dry-run) כברירת מחדל - מדפיס מה היה משתנה בלי לגעת ב-DB.
//   להרצה אמיתית: node backfill_categories.js --apply
//
// הרצה: DATABASE_URL="<connection string מ-Railway>" node backfill_categories.js [--apply]

import 'dotenv/config';
import pkg from 'pg';
import { loadScraperConfig } from './scrapers/scraper_utils.js';

const { Pool } = pkg;

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.error('❌ חסר DATABASE_URL. הריצי עם: DATABASE_URL="..." node backfill_categories.js');
  process.exit(1);
}
const useSSL = connStr.includes('proxy.rlwy.net') || connStr.includes('rlwy.net');
const pool = new Pool({ connectionString: connStr, ssl: useSSL ? { rejectUnauthorized: false } : undefined });

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? '🔴 מצב הרצה אמיתית (--apply) - יבוצעו עדכונים בפועל' : '🟡 מצב בדיקה (dry-run) - לא יבוצע שום שינוי. הריצי עם --apply לביצוע בפועל');

  const { detectCategory } = await loadScraperConfig(pool);

  const { rows } = await pool.query(`SELECT id, title, store FROM products WHERE category IS NULL`);
  console.log(`נמצאו ${rows.length} מוצרים עם category=NULL לבדיקה`);

  const changes = {}; // category -> count
  let updated = 0;

  for (const p of rows) {
    const detected = detectCategory(p.title);
    if (!detected) continue;
    changes[detected] = (changes[detected] || 0) + 1;
    if (APPLY) {
      await pool.query(`UPDATE products SET category=$1 WHERE id=$2`, [detected, p.id]);
      updated++;
    }
  }

  console.log('\n📊 סיכום לפי קטגוריה שזוהתה:');
  for (const [cat, count] of Object.entries(changes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(APPLY ? `\n✅ עודכנו בפועל ${updated} מוצרים` : `\n(dry-run - שום דבר לא עודכן בפועל. להרצה אמיתית: node backfill_categories.js --apply)`);

  await pool.end();
}

main().catch(e => { console.error('שגיאה:', e.message); process.exit(1); });
