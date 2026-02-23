/**
 * ניהול מוצרים ממומנים - LOOKLI
 * 
 * שימוש:
 *   node manage_sponsored.js add    --title "שמלה שחורה" --priority 10 --days 30
 *   node manage_sponsored.js list
 *   node manage_sponsored.js deactivate --id 5
 *   node manage_sponsored.js activate   --id 5
 *   node manage_sponsored.js delete     --id 5
 */

import pkg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Client } = pkg;

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.error("❌  חסר DATABASE_URL — הוסף לקובץ .env");
  process.exit(1);
}

const ssl = connStr.includes("rlwy.net") || connStr.includes("amazonaws.com")
  ? { rejectUnauthorized: false }
  : undefined;

const client = new Client({ connectionString: connStr, ssl });
await client.connect();

// ─── Windows PowerShell encoding fix ─────────────────────
// אם עברית לא עובדת, הרץ קודם: chcp 65001
// או השתמש ב: --product-id במקום --title
process.stdout.setEncoding && process.stdout.setEncoding('utf8');
process.stderr.setEncoding && process.stderr.setEncoding('utf8');

// ─── Parse args ───────────────────────────────────────────
const rawArgs = process.argv.slice(2);
// תמיכה ב-encoding בעיות Windows — נרמל את הארגומנטים
const args = rawArgs.map(a => {
  try { return Buffer.from(a, 'binary').toString('utf8'); } catch(e) { return a; }
});
const command = args[0];

function getArg(name) {
  const i = args.indexOf("--" + name);
  return i !== -1 ? args[i + 1] : null;
}

// ─── Commands ─────────────────────────────────────────────

if (command === "search") {
  // חיפוש מוצרים לפי חנות (עוזר למצוא product-id)
  const store = getArg("store");
  const limit = parseInt(getArg("limit") || "20");
  const offset = parseInt(getArg("page") || "0") * limit;
  
  if (!store) {
    console.error("❌  נדרש --store MEKIMI / LICHI / MIMA / AVIYAH / CHEMISE");
    process.exit(1);
  }

  const res = await client.query(
    `SELECT id, title, price, category FROM products 
     WHERE store = $1 
     ORDER BY last_seen DESC 
     LIMIT $2 OFFSET $3`,
    [store.toUpperCase(), limit, offset]
  );

  if (res.rows.length === 0) {
    console.log(`📭  אין מוצרים מחנות ${store}`);
  } else {
    console.log(`\n📦  מוצרים מחנות ${store.toUpperCase()} (עמוד ${getArg("page")||0}):\n`);
    console.log("ID    | מחיר  | קטגוריה   | כותרת");
    console.log("─".repeat(90));
    for (const r of res.rows) {
      const title = (r.title || "").substring(0, 50);
      const cat = (r.category || "").padEnd(9);
      console.log(`${String(r.id).padEnd(5)} | ₪${String(r.price||0).padEnd(4)} | ${cat} | ${title}`);
    }
    console.log(`\nטיפ: להוסיף ממומן: node manage_sponsored.js add --product-id <ID> --priority 10 --days 30`);
    console.log(`עמוד הבא: node manage_sponsored.js search --store ${store} --page ${(parseInt(getArg("page")||0)+1)}`);
  }

} else if (command === "list") {
  // הצג כל המוצרים הממומנים
  const res = await client.query(`
    SELECT 
      sp.id,
      sp.active,
      sp.priority,
      sp.price_paid,
      sp.expires_at,
      sp.notes,
      sp.created_at,
      p.title,
      p.store,
      p.price AS product_price,
      p.source_url
    FROM sponsored_products sp
    JOIN products p ON p.id = sp.product_id
    ORDER BY sp.active DESC, sp.priority DESC, sp.created_at DESC
  `);

  if (res.rows.length === 0) {
    console.log("📭  אין מוצרים ממומנים כרגע.");
  } else {
    console.log("\n📋  מוצרים ממומנים:\n");
    console.log("ID  | פעיל | עדיפות | שם מוצר                          | חנות     | מחיר שולם | תפוגה       | הערות");
    console.log("─".repeat(110));
    for (const r of res.rows) {
      const status = r.active ? "✅" : "❌";
      const exp = r.expires_at ? new Date(r.expires_at).toLocaleDateString("he-IL") : "ללא תפוגה";
      const title = (r.title || "").substring(0, 33).padEnd(33);
      const store = (r.store || "").padEnd(8);
      const paid = r.price_paid ? `₪${r.price_paid}`.padEnd(9) : "—".padEnd(9);
      console.log(`${String(r.id).padEnd(3)} | ${status}   | ${String(r.priority).padEnd(6)} | ${title} | ${store} | ${paid} | ${exp.padEnd(11)} | ${r.notes || ""}`);
    }
    console.log(`\nסה"כ: ${res.rows.length} רשומות`);
  }

} else if (command === "add") {
  // ─── הוספת מוצר ממומן ────────────────────────────────
  const urlArg    = getArg("url");
  const title     = getArg("title");
  const store     = getArg("store");
  const priority  = parseInt(getArg("priority") || "10");
  const days      = parseInt(getArg("days") || "0");
  const paid      = getArg("paid") || null;
  const notes     = getArg("notes") || null;
  const productId = getArg("product-id");

  if (!urlArg && !title && !productId) {
    console.error("\u274c  \u05e0\u05d3\u05e8\u05e9 \u05d0\u05d7\u05d3 \u05de: --url <\u05e7\u05d9\u05e9\u05d5\u05e8> | --product-id <\u05de\u05e1\u05e4\u05e8> | --title <\u05e9\u05dd>");
    process.exit(1);
  }

  let pid = productId ? parseInt(productId) : null;

  if (!pid && urlArg) {
    // חיפוש לפי URL — הכי מדויק, עובד עם כל שפה
    const cleanUrl = urlArg.trim().replace(/\/+$/, "");
    const found = await client.query(
      `SELECT id, title, store, price FROM products
       WHERE source_url = $1 OR source_url LIKE $2
       ORDER BY last_seen DESC LIMIT 5`,
      [cleanUrl, cleanUrl + "%"]
    );
    if (found.rows.length === 0) {
      console.error("\u274c  \u05dc\u05d0 \u05e0\u05de\u05e6\u05d0 \u05de\u05d5\u05e6\u05e8 \u05e2\u05dd \u05d4\u05e7\u05d9\u05e9\u05d5\u05e8 \u05d4\u05d6\u05d4");
      console.error("   " + cleanUrl);
      process.exit(1);
    }
    pid = found.rows[0].id;
    console.log("\u2705  \u05e0\u05de\u05e6\u05d0: [" + pid + "] " + found.rows[0].title + " (" + found.rows[0].store + ") - \u20aa" + found.rows[0].price);

  } else if (!pid) {
    // חיפוש לפי כותרת
    let searchQ = `SELECT id, title, store, price FROM products WHERE title ILIKE $1`;
    const searchParams = [`%${title}%`];
    if (store) { searchQ += " AND store = $2"; searchParams.push(store.toUpperCase()); }
    searchQ += " ORDER BY last_seen DESC LIMIT 10";
    const found = await client.query(searchQ, searchParams);
    if (found.rows.length === 0) {
      console.error("\u274c  \u05dc\u05d0 \u05e0\u05de\u05e6\u05d0 \u05de\u05d5\u05e6\u05e8. \u05e0\u05e1\u05d4: node manage_sponsored.js search --store MEKIMI");
      process.exit(1);
    }
    if (found.rows.length > 1) {
      console.log("\n\u{1F50D}  \u05e0\u05de\u05e6\u05d0\u05d5 " + found.rows.length + " \u05de\u05d5\u05e6\u05e8\u05d9\u05dd \u2014 \u05d1\u05d7\u05e8 \u05e2\u05dd --product-id:\n");
      console.log("ID    | \u05d7\u05e0\u05d5\u05ea     | \u05de\u05d7\u05d9\u05e8  | \u05db\u05d5\u05ea\u05e8\u05ea");
      console.log("\u2500".repeat(80));
      for (const r of found.rows) {
        console.log(String(r.id).padEnd(5) + " | " + (r.store||"").padEnd(8) + " | \u20aa" + String(r.price||0).padEnd(4) + " | " + r.title);
      }
      process.exit(0);
    }
    pid = found.rows[0].id;
    console.log("\u2705  \u05e0\u05d1\u05d7\u05e8: [" + pid + "] " + found.rows[0].title);
  }

  // חשב תפוגה
  let expiresAt = null;
  if (days > 0) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    expiresAt = d.toISOString();
  }

  // הוסף לטבלה
  const ins = await client.query(`
    INSERT INTO sponsored_products (product_id, store, priority, price_paid, expires_at, notes)
    SELECT $1, store, $2, $3, $4, $5 FROM products WHERE id = $1
    RETURNING id
  `, [pid, priority, paid, expiresAt, notes]);

  console.log("\n\u{1F3AF}  \u05de\u05d5\u05e6\u05e8 \u05de\u05de\u05d5\u05de\u05df \u05e0\u05d5\u05e1\u05e3! sponsored_id = " + ins.rows[0].id);
  if (expiresAt) console.log("   \u05ea\u05e4\u05d5\u05d2\u05d4: " + new Date(expiresAt).toLocaleDateString("he-IL"));
  else console.log("   \u05dc\u05dc\u05d0 \u05ea\u05e4\u05d5\u05d2\u05d4");


} else if (command === "deactivate") {
  const id = getArg("id");
  if (!id) { console.error("❌  נדרש --id"); process.exit(1); }
  await client.query("UPDATE sponsored_products SET active=false WHERE id=$1", [id]);
  console.log(`✅  מוצר ממומן #${id} כובה`);

} else if (command === "activate") {
  const id = getArg("id");
  if (!id) { console.error("❌  נדרש --id"); process.exit(1); }
  await client.query("UPDATE sponsored_products SET active=true WHERE id=$1", [id]);
  console.log(`✅  מוצר ממומן #${id} הופעל`);

} else if (command === "delete") {
  const id = getArg("id");
  if (!id) { console.error("❌  נדרש --id"); process.exit(1); }
  await client.query("DELETE FROM sponsored_products WHERE id=$1", [id]);
  console.log(`🗑️   מוצר ממומן #${id} נמחק לצמיתות`);

} else {
  console.log(`
📦  ניהול מוצרים ממומנים - LOOKLI
════════════════════════════════════

פקודות:

  הצגת כל הממומנים:
    node manage_sponsored.js list

  חיפוש מוצרים לפי חנות (מומלץ! עוקף בעיות עברית):
    node manage_sponsored.js search --store MEKIMI
    node manage_sponsored.js search --store MEKIMI --page 1

  הוספת מוצר ממומן לפי קישור (הכי קל!):
    node manage_sponsored.js add --url "https://mekimi.co.il/products/..." --priority 10 --days 30 --paid 150

  הוספת מוצר ממומן לפי ID:
    node manage_sponsored.js add --product-id 1234 --priority 10 --days 30 --paid 150

  הוספת מוצר ממומן לפי כותרת (עלול להיכשל ב-Windows עם עברית):
    node manage_sponsored.js add --title "שמלה שחורה" --priority 10 --days 30 --paid 150 --notes "קמפיין קיץ" 
    
  הוספה לפי ID ישיר:
    node manage_sponsored.js add --product-id 1234 --priority 10 --days 30

  כיבוי זמני:
    node manage_sponsored.js deactivate --id 5

  הפעלה מחדש:
    node manage_sponsored.js activate --id 5

  מחיקה לצמיתות:
    node manage_sponsored.js delete --id 5

פרמטרים:
  --url         קישור מדויק לדף המוצר באתר החנות (הכי מומלץ!)
  --title       חלק מהכותרת לחיפוש (עברית או אנגלית)
  --store       שם החנות לסינון: MEKIMI / LICHI / MIMA / AVIYAH / CHEMISE
  --product-id  ID מדויק של מוצר (מ-products table)
  --priority    עדיפות 0-100, גבוה יותר = מופיע ראשון (ברירת מחדל: 10)
  --days        מספר ימים עד תפוגה (0 = ללא תפוגה)
  --paid        כמה שולם בש"ח
  --notes       הערות פנימיות
`);
}

await client.end();
