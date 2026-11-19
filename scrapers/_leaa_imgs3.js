// אבחון חד-פעמי 3 (קריאה בלבד): מוצרי LEAA שבמערך התמונות שלהם יש png/jpg מקורי (לא רק בתמונה הראשית)
import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;
const cs = process.env.DATABASE_URL;
const db = new Client({ connectionString: cs, ssl: cs && cs.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined });
await db.connect();
const r = await db.query(`
  SELECT id, title, sizes, last_seen, not_seen_count, hidden_stale, image_url, images
  FROM products
  WHERE store = 'LEAA'
    AND EXISTS (SELECT 1 FROM unnest(images) u WHERE u LIKE '%.png' OR u LIKE '%.jpg' OR u LIKE '%.jpeg')
  ORDER BY last_seen DESC`);
console.log(`מוצרי LEAA שיש בהם png/jpg במערך התמונות: ${r.rows.length}`);
for (const x of r.rows) {
  const bad = (x.images || []).filter(u => /\.(png|jpe?g)$/i.test(u));
  console.log(`- #${x.id} ${String(x.title).slice(0, 40)} | מידות: ${(x.sizes || []).length} | נראה: ${new Date(x.last_seen).toISOString().slice(0, 10)} | לא נראה: ${x.not_seen_count} | מוסתר: ${x.hidden_stale} | תמונות: ${(x.images || []).length}`);
  console.log(`  ראשית: ${decodeURIComponent(x.image_url || '').slice(-60)}`);
  bad.slice(0, 2).forEach(u => console.log(`  png/jpg: ${decodeURIComponent(u).slice(-70)}`));
}
await db.end();
process.exit(0);
