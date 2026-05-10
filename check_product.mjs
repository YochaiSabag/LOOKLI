import 'dotenv/config';
import pkg from 'pg';
const {Client}=pkg;
const db=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();

// כמה מוצרי ליצ'י יש עם color_sizes?
const r1=await db.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE color_sizes IS NOT NULL AND color_sizes != '{}') as with_colors FROM products WHERE store='LICHI'");
console.log('LICHI:', r1.rows[0]);

// דוגמה של מוצר ליצ'י עם כמה צבעים
const r2=await db.query(`SELECT title, source_url, colors, color_sizes FROM products WHERE store='LICHI' AND color_sizes IS NOT NULL AND color_sizes != '{}' LIMIT 3`);
console.log('\nמוצרים עם color_sizes:');
r2.rows.forEach(p => console.log(p.title, '->', JSON.stringify(p.color_sizes)));

await db.end();
