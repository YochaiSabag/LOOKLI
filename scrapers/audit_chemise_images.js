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
//
// אם ההרצה נעצרת באמצע (קריסה/סגירת טרמינל) - פשוט מריצים שוב אותה פקודה,
// וההרצה החדשה תמשיך מאיפה שהקודמת הפסיקה (לפי קובץ התקדמות מקומי), לא מתחילה מחדש.
// למחוק את קובץ ההתקדמות (audit_chemise_progress.json) כדי להתחיל בדיקה מלאה מחדש.

import 'dotenv/config';
import https from 'https';
import fs from 'fs';
import pkg from 'pg';
const { Client } = pkg;

const MIN_VALID_BYTES = 9500; // עודכן לפי בדיקה ידנית של תמונות אמיתיות בשמיז - 15000 היה תופס תמונות תקינות בטעות
const PROGRESS_FILE = './scrapers/audit_chemise_progress.json';

const connStr = process.env.DATABASE_URL;
const useSSL = connStr && (connStr.includes('rlwy.net') || connStr.includes('amazonaws.com') || connStr.includes('supabase'));
const db = new Client({ connectionString: connStr, ssl: useSSL ? { rejectUnauthorized: false } : undefined });

function loadProgress() {
  try {
    const raw = fs.readFileSync(PROGRESS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { processedIds: [], suspectList: [], checked: 0, suspectImages: 0 };
  }
}

function saveProgress(progress) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
  } catch (e) {
    console.log(`  ⚠️ לא הצליח לשמור התקדמות: ${e.message}`);
  }
}

function getContentLength(url) {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) { resolve(0); return; }
    try {
      const req = https.request(url, { method: 'HEAD', timeout: 15000 }, (res) => {
        const len = parseInt(res.headers['content-length'] || '0');
        resolve(res.statusCode === 200 ? len : 0);
      });
      req.on('timeout', () => { req.destroy(); resolve(0); });
      req.on('error', () => resolve(0));
      req.end();
    } catch (e) {
      resolve(0);
    }
  });
}

async function run() {
  if (process.env.RESET_AUDIT === 'true') {
    try { fs.unlinkSync(PROGRESS_FILE); console.log('🔄 RESET_AUDIT פעיל - מוחק התקדמות קודמת, מתחיל סריקה מלאה מחדש\n'); } catch (e) {}
  }
  await db.connect();
  console.log('🔎 בודק תמונות Cloudinary עבור CHEMISE...\n');

  const { rows } = await db.query(
    `SELECT id, title, source_url, images FROM products WHERE store='CHEMISE' AND images IS NOT NULL AND array_length(images,1) > 0 ORDER BY id ASC`
  );
  console.log(`📦 סה"כ ${rows.length} מוצרים עם תמונות לבדיקה\n`);

  const progress = loadProgress();
  const processedSet = new Set(progress.processedIds);
  let { checked, suspectImages } = progress;
  const suspectList = progress.suspectList; // [{id, title, images: [urls]}]

  if (processedSet.size > 0) {
    console.log(`▶️  ממשיך מהרצה קודמת - ${processedSet.size}/${rows.length} מוצרים כבר נבדקו\n`);
  }

  const toProcess = processedSet.size >= rows.length ? [] : rows.filter(p => !processedSet.has(p.id));
  if (toProcess.length === 0 && processedSet.size > 0) {
    console.log(`✅ הסריקה כבר הושלמה בהרצה קודמת - משתמש בתוצאות השמורות (למחוק את ${PROGRESS_FILE} כדי לסרוק מחדש)\n`);
  }

  for (const p of toProcess) {
    let hasSuspect = false;
    const suspectUrls = [];
    for (const imgUrl of p.images) {
      const size = await getContentLength(imgUrl);
      checked++;
      if (size > 0 && size < MIN_VALID_BYTES) {
        hasSuspect = true;
        suspectImages++;
        suspectUrls.push(imgUrl);
        console.log(`  ⚠️ ${p.title.substring(0,40)} — תמונה חשודה (${size} bytes):`);
        console.log(`      ${imgUrl}`);
      }
    }
    if (hasSuspect) suspectList.push({ id: p.id, title: p.title, images: suspectUrls });

    processedSet.add(p.id);
    // שומר התקדמות אחרי כל מוצר - כך שקריסה בכל רגע לא מאבדת עבודה
    saveProgress({ processedIds: [...processedSet], suspectList, checked, suspectImages });

    if (processedSet.size % 25 === 0) console.log(`  ...נבדקו ${processedSet.size}/${rows.length} מוצרים`);
  }

  const suspectProducts = suspectList.length;
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

  // קובץ ההתקדמות נשאר קיים בכוונה (לא נמחק אוטומטית) - כך שריצה שנייה
  // (למשל עם CLEAN_SUSPECT=true אחרי שראית את התוצאות) לא סורקת הכל מחדש.
  // למחיקה מפורשת ולסריקה מלאה חדשה: RESET_AUDIT=true

  await db.end();
}

run().catch(e => { console.error('❌ שגיאה:', e.message); console.log('  ℹ️  ההתקדמות נשמרה - הרץ שוב את אותה פקודה כדי להמשיך מכאן.'); process.exit(1); });
