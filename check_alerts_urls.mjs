import 'dotenv/config';
import pkg from 'pg';
const {Client}=pkg;
const db=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();

// השווה URL מהתראה לURL ב-DB
const alert=await db.query("SELECT product_source_url FROM price_alerts WHERE active=true LIMIT 1");
const url=alert.rows[0].product_source_url;
console.log('Alert URL:', url);

const prod=await db.query("SELECT source_url,title FROM products WHERE source_url=$1 LIMIT 1",[url]);
console.log('Exact match:', prod.rows[0]?.title || 'לא נמצא');

const prod2=await db.query("SELECT source_url,title FROM products WHERE source_url LIKE $1 LIMIT 1",[url+'%']);
console.log('Like match:', prod2.rows[0]?.title || 'לא נמצא');
console.log('Like URL:', prod2.rows[0]?.source_url);

await db.end();
