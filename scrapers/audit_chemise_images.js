// scrapers/audit_chemise_images.js
//
// כלי חד-פעמי: בודק את גודל כל תמונה שכבר הועלתה ל-Cloudinary עבור מוצרי שמיז.
// תמונות קטנות בצורה חשודה (מתחת ל-MIN_VALID_BYTES) הן כנראה גרסה חסומה/מפוקסלת
// של נטפרי שהועלתה בטעות בעבר. הכלי מנקה את שדה images רק למוצרים האלה -
// כך שבהרצה הרגילה הבאה של chemise_scraper.js (בלי FORCE_REIMAGE!) הם ייחשבו
// "בלי תמונות קיימות" ויועלו מחדש (דרך הפרוקסי, נקי הפעם) - בעוד שאר המוצרים
// התקינים לא נוגעים בהם בכלל ולא צורכים קרדיט מיותר.
//
// הרצה:  node scrapers/audit_chemise_images.js
// (לא דורש פרוקסי - רק קורא גדלי קבצים מ-Cloudinary, שאינו חסום)

import 'dotenv/config';
import https from 'https';
import pkg from 'pg';
const { Client } = pkg;

const MIN_VALID_BYTES = 15000; // אותו סף כמו check_netfree_images.js ו-chemise_scraper.js

const connStr = process.env.DATABASE_URL;
const useSSL = connStr && (connStr.includes('rlwy.net') || connStr.includes('amazonaws.com') || connStr.includes('supabase'));
const db = new Client({ connectionString: connStr, ssl: useSSL ? { rejectUnauthorized: false } : undefined });

function getContentLength(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', timeout: 15000 }, (res) => {
      const len = parseInt(res.headers['content-length'] || '0');
      resolve(res.statusCode === 200 ? len : 0);
    });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
    req.end();
  });
}

async function run() {
  await db.connect();
  console.log('🔎 בודק תמונות Cloudinary עבור CHEMISE...\n');

  const { rows } = await db.query(
    `SELECT id, title, source_url, images FROM products WHERE store='CHEMISE' AND images IS NOT NULL AND array_length(images,1) > 0`
  );
  console.log(`📦 סה"כ ${rows.length} מוצרים עם תמונות לבדיקה\n`);

  let checked = 0, suspectProducts = 0, suspectImages = 0;
  const suspectList = [];

  for (const p of rows) {
    let hasSuspect = false;
    for (const imgUrl of p.images) {
      const size = await getContentLength(imgUrl);
      checked++;
      if (size > 0 && size < MIN_VALID_BYTES) {
        hasSuspect = true;
        suspectImages++;
        console.log(`  ⚠️ ${p.title.substring(0,40)} — תמונה חשודה (${size} bytes): ${imgUrl.substring(0,70)}`);
      }
    }
    if (hasSuspect) {
      suspectProducts++;
      suspectList.push(p);
    }
    if (checked % 50 === 0) console.log(`  ...נבדקו ${checked} תמונות`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`🏁 סיום: ${suspectProducts} מוצרים עם תמונות חשודות (${suspectImages} תמונות מתוך ${checked} שנבדקו)`);
  console.log('='.repeat(50));

  if (suspectProducts === 0) {
    console.log('\n✅ לא נמצאו תמונות חשודות - אין צורך בפעולה נוספת.');
  } else if (process.env.CLEAN_SUSPECT === 'true') {
    console.log(`\n🧹 CLEAN_SUSPECT פעיל - מנקה את שדה images ל-${suspectProducts} המוצרים החשודים...`);
    for (const p of suspectList) {
      await db.query('UPDATE products SET images=NULL, image_url=NULL WHERE id=$1', [p.id]);
    }
    console.log(`✅ נוקה. בהרצה הרגילה הבאה של chemise_scraper.js (בלי FORCE_REIMAGE), רק ${suspectProducts} המוצרים האלה יעלו תמונות מחדש.`);
  } else {
    console.log(`\nℹ️  זו הייתה בדיקה בלבד - שום דבר לא נוקה. כדי לנקות בפועל את ${suspectProducts} המוצרים החשודים, הרץ עם:`);
    console.log(`    CLEAN_SUSPECT=true node scrapers/audit_chemise_images.js`);
  }

  await db.end();
}

run().catch(e => { console.error('❌ שגיאה:', e.message); process.exit(1); });
