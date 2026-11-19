// אבחון חד-פעמי 4 (קריאה בלבד): מוצרי LEAA פעילים שה-valid_image_urls שלהם (תמונות מאושרות לנטפרי) לא תואם ל-images הנוכחי
import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;
const cs = process.env.DATABASE_URL;
const db = new Client({ connectionString: cs, ssl: cs && cs.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined });
await db.connect();
const r = await db.query(`
  SELECT id, title, sizes, images, valid_image_urls, has_valid_image, reviewed_at
  FROM products
  WHERE store = 'LEAA' AND (banned IS NULL OR banned = false) AND (hidden_stale IS NULL OR hidden_stale = false)
  ORDER BY id`);
let noValid = 0, matchAll = 0, stale = 0;
const samples = [];
for (const x of r.rows) {
  const v = x.valid_image_urls || [], im = x.images || [];
  if (v.length === 0) { noValid++; continue; }
  const notInImages = v.filter(u => !im.includes(u));
  if (notInImages.length === 0) matchAll++;
  else { stale++; if (samples.length < 6) samples.push({ x, notInImages }); }
}
console.log(`מוצרי LEAA פעילים: ${r.rows.length} | בלי valid_image_urls: ${noValid} | valid תואם ל-images: ${matchAll} | valid מכיל כתובות שלא קיימות ב-images: ${stale}`);
for (const { x, notInImages } of samples) {
  console.log(`- #${x.id} ${String(x.title).slice(0, 35)} | מידות: ${(x.sizes || []).length} | נסקר: ${x.reviewed_at ? new Date(x.reviewed_at).toISOString().slice(0, 10) : 'לא'}`);
  console.log(`  images[0]: ${decodeURIComponent((x.images || [])[0] || '').slice(-60)}`);
  console.log(`  valid[0] (לא ב-images): ${decodeURIComponent(notInImages[0]).slice(-70)}`);
}
await db.end();
process.exit(0);
