import 'dotenv/config';
import pkg from 'pg';
const {Client}=pkg;
const db=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();

// עמודות price_alerts
const r1=await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='price_alerts' ORDER BY ordinal_position");
console.log('price_alerts:', r1.rows.map(x=>x.column_name).join(', '));

// דוגמה של color_sizes
const r2=await db.query("SELECT title, color_sizes FROM products WHERE color_sizes IS NOT NULL AND color_sizes != '{}' LIMIT 3");
console.log('color_sizes sample:', JSON.stringify(r2.rows, null, 2));

await db.end();
