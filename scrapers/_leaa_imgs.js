// אבחון חד-פעמי (קריאה בלבד): מצב תמונות LEAA ב-DB — כמה כתובות שבורות (404) ומה סוג הכתובות
import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;
const cs = process.env.DATABASE_URL;
const db = new Client({ connectionString: cs, ssl: cs && cs.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined });
await db.connect();

const s = await db.query(`
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE last_seen > NOW() - make_interval(days => 7))::int AS seen_7d,
         COUNT(*) FILTER (WHERE image_url LIKE '%-400x600.%')::int AS resized_400x600,
         COUNT(*) FILTER (WHERE image_url LIKE '%.png')::int AS png,
         COUNT(*) FILTER (WHERE image_url LIKE '%.webp')::int AS webp,
         COUNT(*) FILTER (WHERE image_url LIKE '%.jpg' OR image_url LIKE '%.jpeg')::int AS jpg,
         MAX(last_seen) AS last_seen_max
  FROM products WHERE store = 'LEAA'`);
console.log('סיכום LEAA:', s.rows[0]);

const rows = (await db.query(`SELECT source_url, image_url, last_seen FROM products WHERE store = 'LEAA' AND image_url <> '' ORDER BY random() LIMIT 25`)).rows;
let ok = 0, bad = 0, err = 0;
for (const r of rows) {
  try {
    const res = await fetch(r.image_url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(20000) });
    if (res.ok) ok++; else { bad++; console.log(`  ✗ ${res.status}  ${decodeURIComponent(r.image_url).slice(-70)}  (נראה לאחרונה: ${new Date(r.last_seen).toISOString().slice(0, 10)})`); }
  } catch (e) { err++; console.log(`  ⚠ ${e.message.slice(0, 40)}  ${r.image_url.slice(-50)}`); }
}
console.log(`בדיקת ${rows.length} תמונות אקראיות: תקינות=${ok} שבורות=${bad} שגיאת רשת=${err}`);
await db.end();
process.exit(0);
