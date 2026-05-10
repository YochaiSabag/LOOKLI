import 'dotenv/config';
import pkg from 'pg';
const {Client}=pkg;
const db=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();

// בדוק שעמודת alert_color קיימת
const r1=await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='price_alerts' AND column_name='alert_color'");
console.log('alert_color קיימת:', r1.rows.length > 0 ? '✅' : '❌');

// בדוק דוגמאות של התראות
const r2=await db.query("SELECT id, alert_price, alert_size, alert_color, active FROM price_alerts WHERE active=true LIMIT 5");
console.log('התראות פעילות:', JSON.stringify(r2.rows, null, 2));

await db.end();
