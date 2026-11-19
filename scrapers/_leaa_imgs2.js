// אבחון חד-פעמי 2 (קריאה בלבד): מוצרי LEAA שהתמונה השמורה שלהם היא png/jpg מקורי (ולא webp מוקטן)
import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;
const cs = process.env.DATABASE_URL;
const db = new Client({ connectionString: cs, ssl: cs && cs.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined });
await db.connect();
const r = await db.query(`
  SELECT source_url, image_url, last_seen, not_seen_count,
         COALESCE(array_length(images, 1), 0) AS n_images
  FROM products
  WHERE store = 'LEAA' AND (image_url LIKE '%.png' OR image_url LIKE '%.jpg' OR image_url LIKE '%.jpeg')
  ORDER BY last_seen DESC`);
console.log(`מוצרי LEAA עם תמונה ראשית png/jpg: ${r.rows.length}`);
for (const x of r.rows) {
  console.log(`- נראה: ${new Date(x.last_seen).toISOString().slice(0, 10)} | לא נראה ברצף: ${x.not_seen_count} | תמונות: ${x.n_images}`);
  console.log(`  עמוד:  ${decodeURIComponent(x.source_url).slice(0, 90)}`);
  console.log(`  תמונה: ${decodeURIComponent(x.image_url).slice(-80)}`);
}
await db.end();
process.exit(0);
