/**
 * check_alerts.js — LOOKLI
 * מריץ אחרי כל סקרפר: בודק מחירים ומלאי ושולח מיילים
 * הרצה: node check_alerts.js
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
});

const BREVO_KEY  = process.env.BREVO_API_KEY;
const SITE_URL   = process.env.SITE_URL || 'https://lookli.co.il';
const FROM_EMAIL = process.env.FROM_EMAIL || 'alerts@lookli.co.il';
const FROM_NAME  = 'LOOKLI התראות';

// ─── שלח מייל דרך Brevo ───────────────────────────────────
async function sendEmail(toEmail, subject, htmlBody) {
  if (!BREVO_KEY) {
    console.log(`[ALERT] BREVO_API_KEY חסר — מייל לא נשלח ל-${toEmail}`);
    return false;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: toEmail }],
        subject,
        htmlContent: htmlBody,
      }),
    });
    if (res.ok) { console.log(`  ✅ מייל נשלח: ${toEmail}`); return true; }
    else { const e = await res.json(); console.error(`  ❌ Brevo error:`, e); return false; }
  } catch(e) { console.error('  ❌ שגיאת שליחה:', e.message); return false; }
}

// ─── תבנית מייל ───────────────────────────────────────────
function buildEmail({ type, title, image, store, oldVal, newVal, url }) {
  const isPrice = type === 'price';
  const headline = isPrice
    ? `🎉 המחיר ירד! ${title}`
    : `🔔 מידה ${newVal} חזרה למלאי! ${title}`;
  const body = isPrice
    ? `<p style="font-size:16px">המחיר של <strong>${title}</strong> ירד!</p>
       <p style="font-size:22px;color:#e0a1c0;font-weight:900">₪${newVal} <span style="text-decoration:line-through;font-size:14px;color:#999">₪${oldVal}</span></p>`
    : `<p style="font-size:16px">מידה <strong>${newVal}</strong> של <strong>${title}</strong> חזרה למלאי!</p>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:'Heebo',Arial,sans-serif;direction:rtl">
  <div style="max-width:520px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#d191b0,#c48cb3);padding:24px 28px;text-align:center">
      <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-.5px">LOOKLI</div>
      <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:4px">התראת מחיר ומלאי</div>
    </div>
    <div style="padding:28px">
      ${image ? `<img src="${image}" alt="${title}" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-bottom:20px"/>` : ''}
      <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">${store || ''}</div>
      ${body}
      <a href="${url}" target="_blank"
         style="display:block;margin-top:20px;background:linear-gradient(135deg,#d191b0,#c48cb3);color:#fff;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none">
         לרכישה באתר ←
      </a>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f3f4f6;text-align:center;font-size:11px;color:#9ca3af">
      קיבלת מייל זה כי הגדרת התראה ב-LOOKLI •
      <a href="${SITE_URL}" style="color:#c48cb3;text-decoration:none">לביטול כניסי לפרופיל</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── לוגיקה ראשית ─────────────────────────────────────────
async function checkAlerts() {
  console.log('\n🔔 LOOKLI — בדיקת התראות', new Date().toLocaleString('he-IL'));

  // שלוף כל ההתראות הפעילות + מידע נוכחי על המוצר + מייל משתמש
  const { rows: alerts } = await pool.query(`
    SELECT
      pa.id, pa.user_id, pa.product_source_url,
      pa.alert_price, pa.alert_size,
      pa.last_price, pa.last_sizes,
      pa.triggered_at,
      u.email AS user_email,
      p.price AS current_price,
      p.sizes AS current_sizes,
      p.title AS product_title,
      p.image_url AS product_image,
      p.store AS product_store
    FROM price_alerts pa
    JOIN users u ON u.id = pa.user_id
    LEFT JOIN products p ON p.source_url = pa.product_source_url
    WHERE pa.active = true
  `);

  console.log(`  סה"כ התראות פעילות: ${alerts.length}`);

  let sent = 0;

  for (const alert of alerts) {
    const {
      id, user_email, product_source_url,
      alert_price, alert_size,
      last_price, last_sizes,
      current_price, current_sizes,
      product_title, product_image, product_store,
    } = alert;

    // ── 1. התראת מחיר ──────────────────────────────────────
    if (alert_price && current_price && last_price) {
      const prev = parseFloat(last_price);
      const curr = parseFloat(current_price);
      if (curr < prev) {
        console.log(`  💰 מחיר ירד: ${product_title} ${prev}→${curr} (${user_email})`);
        const ok = await sendEmail(
          user_email,
          `💰 המחיר ירד! ${product_title}`,
          buildEmail({
            type: 'price', title: product_title,
            image: product_image, store: product_store,
            oldVal: prev.toFixed(0), newVal: curr.toFixed(0),
            url: product_source_url,
          })
        );
        if (ok) {
          sent++;
          // עדכן last_price
          await pool.query(
            "UPDATE price_alerts SET last_price=$1, triggered_at=NOW() WHERE id=$2",
            [current_price, id]
          );
        }
      }
    }

    // ── 2. התראת מידה ──────────────────────────────────────
    if (alert_size && current_sizes) {
      const prevSizes = last_sizes || [];
      const sizeBack = alert_size === 'any'
        ? current_sizes.some(s => !prevSizes.includes(s))   // כל מידה חדשה
        : current_sizes.includes(alert_size) && !prevSizes.includes(alert_size);

      if (sizeBack) {
        const sizeLabel = alert_size === 'any' ? 'חדשה' : alert_size;
        console.log(`  📦 מידה חזרה: ${product_title} מידה ${sizeLabel} (${user_email})`);
        const ok = await sendEmail(
          user_email,
          `📦 מידה חזרה למלאי! ${product_title}`,
          buildEmail({
            type: 'size', title: product_title,
            image: product_image, store: product_store,
            newVal: sizeLabel, url: product_source_url,
          })
        );
        if (ok) {
          sent++;
          await pool.query(
            "UPDATE price_alerts SET last_sizes=$1, triggered_at=NOW() WHERE id=$2",
            [current_sizes, id]
          );
        }
      }
    }

    // עדכן last_price/last_sizes גם אם לא נשלח (לנקודת ייחוס עדכנית)
    if (current_price || current_sizes) {
      await pool.query(
        "UPDATE price_alerts SET last_price=COALESCE($1,last_price), last_sizes=COALESCE($2,last_sizes) WHERE id=$3",
        [current_price || null, current_sizes || null, id]
      );
    }
  }

  console.log(`\n✅ נשלחו ${sent} התראות`);
  await pool.end();
}

checkAlerts().catch(e => { console.error('שגיאה:', e.message); process.exit(1); });