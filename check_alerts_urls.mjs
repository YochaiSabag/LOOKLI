import 'dotenv/config';
import pkg from 'pg';
const {Client}=pkg;
const db=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();

// בדוק בדיוק איך נשמר source_url ב-DB
const r=await db.query("SELECT source_url FROM products WHERE store='MEKIMI' LIMIT 3");
r.rows.forEach(x=>console.log('DB URL:', x.source_url));

// האם URL עם lowercase encoding נמצא
const testUrl='https://mekimi.co.il/product/%d7%a7%d7%a8%d7%93%d7%99%d7%92%d7%9f-%d7%9b%d7%a4%d7%aa%d7%95%d7%a8%d7%95%d7%aa-%d7%9e%d7%a9%d7%95%d7%9c%d7%a9s262110/';
const r2=await db.query("SELECT title FROM products WHERE source_url=$1",[testUrl]);
console.log('\nExact lowercase:', r2.rows[0]?.title || 'לא נמצא');

// נסה decode
const decoded=decodeURIComponent(testUrl);
const r3=await db.query("SELECT title FROM products WHERE source_url=$1",[decoded]);
console.log('Decoded:', r3.rows[0]?.title || 'לא נמצא');

// חיפוש חלקי
const r4=await db.query("SELECT source_url,title FROM products WHERE source_url ILIKE '%s262110%' LIMIT 1");
console.log('ILIKE match:', r4.rows[0]?.title || 'לא נמצא');
console.log('ILIKE URL:', r4.rows[0]?.source_url);

await db.end();
