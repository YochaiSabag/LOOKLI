import 'dotenv/config';
import pkg from 'pg';
const {Client}=pkg;
const db=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();

const url='https://mekimi.co.il/product/textured-floral-buttoned-blousew261050/';
console.log('Testing URL:', url);

// בדוק ב-price_alerts
const a=await db.query("SELECT id,product_id,product_source_url FROM price_alerts WHERE product_source_url ILIKE '%w261050%' LIMIT 1");
console.log('price_alerts match:', a.rows[0] || 'לא נמצא');

// בדוק ב-products
const p=await db.query("SELECT id,title,source_url,color_sizes,colors FROM products WHERE source_url ILIKE '%w261050%' LIMIT 1");
console.log('product match:', p.rows[0]?.title || 'לא נמצא');
console.log('product source_url:', p.rows[0]?.source_url);
console.log('product id:', p.rows[0]?.id);
console.log('colors:', p.rows[0]?.colors);
console.log('color_sizes:', JSON.stringify(p.rows[0]?.color_sizes));

await db.end();
