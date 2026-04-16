/**
 * health_check.js — LOOKLI
 * בודק בריאות סקרייפרים ושולח דוח לאדמין
 * הרצה: node health_check.js
 * נדרש: ADMIN_EMAIL, BREVO_API_KEY, DATABASE_URL
 */

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
});

const BREVO_KEY  = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'alerts@lookli.co.il';
const FROM_NAME  = 'LOOKLI מערכת';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// ─── שלח מייל ────────────────────────────────────────────
async function sendEmail(toEmail, subject, htmlBody) {
  if (!BREVO_KEY) { console.log('[HEALTH] BREVO_API_KEY חסר'); return false; }
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
    const e = await res.json(); console.error('  ❌ Brevo:', e); return false;
  } catch(e) { console.error('  ❌ שגיאה:', e.message); return false; }
}

// ─── לוגיקה ────────────────────────────────────────────
async function runHealthCheck() {
  if (!ADMIN_EMAIL) {
    console.log('[HEALTH] ADMIN_EMAIL לא מוגדר — יוצא');
    process.exit(0);
  }

  console.log('\n🏥 LOOKLI Health Check', new Date().toLocaleString('he-IL'));

  const { rows } = await pool.query(`
    SELECT
      store,
      COUNT(*)                                                         AS total,
      COUNT(*) FILTER (WHERE last_seen >= NOW() - INTERVAL '3 days')  AS fresh,
      MAX(last_seen)                                                   AS last_seen,
      COUNT(*) FILTER (WHERE image_url IS NULL OR image_url = '')     AS no_image,
      COUNT(*) FILTER (WHERE color IS NULL OR color = '')             AS no_color,
      COUNT(*) FILTER (WHERE sizes IS NULL
                          OR array_length(sizes,1) IS NULL
                          OR array_length(sizes,1) = 0)               AS no_sizes,
      COUNT(*) FILTER (WHERE category IS NULL OR category = '')       AS no_category,
      COUNT(*) FILTER (WHERE price = 0 OR price IS NULL)             AS zero_price,
      COUNT(*) FILTER (WHERE last_seen >= NOW() - INTERVAL '1 day'
                         AND (sizes IS NULL OR array_length(sizes,1) IS NULL
                              OR array_length(sizes,1) = 0))          AS new_no_stock
    FROM products
    GROUP BY store
    ORDER BY store
  `);

  function pct(n, total) {
    if (!total) return '0%';
    return Math.round((n / total) * 100) + '%';
  }

  function cell(val, total, warnPct = 10, critPct = 30) {
    if (!val || val == 0) return `<td style="color:#16a34a;text-align:center">✅</td>`;
    const p = total ? (val / total) * 100 : 0;
    const color = p >= critPct ? '#dc2626' : p >= warnPct ? '#d97706' : '#ca8a04';
    return `<td style="color:${color};font-weight:700;text-align:center">${val} (${pct(val,total)})</td>`;
  }

  function storeStatus(r) {
    if (r.fresh == 0 && r.total > 0) return '🔴'; // סקרייפר לא רץ 3+ ימים
    if (r.fresh < r.total) return '🟡';            // חלק לא עודכן
    if (r.no_image > 0 || r.zero_price > 0) return '🟡';
    if (r.no_color > 0 || r.no_sizes > 0 || r.no_category > 0 || r.new_no_stock > 0) return '🟡';
    return '🟢';
  }

  const hasRed    = rows.some(r => storeStatus(r) === '🔴');
  const hasYellow = rows.some(r => storeStatus(r) === '🟡');

  const tableRows = rows.map(r => {
    const lastDate = r.last_seen
      ? new Date(r.last_seen).toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '—';
    const dateColor = r.fresh == 0 ? '#dc2626' : r.fresh < r.total ? '#d97706' : '#16a34a';

    return `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 8px;font-weight:700">${storeStatus(r)} ${r.store}</td>
        <td style="text-align:center">${r.total}</td>
        <td style="text-align:center;color:${dateColor};font-weight:${dateColor !== '#16a34a' ? '700' : '400'}">${lastDate}</td>
        ${cell(r.no_image,    r.total, 5,  20)}
        ${cell(r.no_color,    r.total, 20, 50)}
        ${cell(r.no_sizes,    r.total, 10, 30)}
        ${cell(r.no_category, r.total, 20, 50)}
        ${cell(r.zero_price,  r.total, 5,  15)}
        <td style="text-align:center;color:${r.new_no_stock > 0 ? '#d97706' : '#16a34a'}">${r.new_no_stock > 0 ? r.new_no_stock : '✅'}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:Arial,sans-serif;direction:rtl">
  <div style="max-width:780px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#d191b0,#c48cb3);padding:22px 28px;text-align:center">
      <div style="font-size:26px;font-weight:900;color:#fff">LOOKLI — דוח סקרייפרים</div>
      <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:4px">
        ${new Date().toLocaleDateString('he-IL', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' })}
      </div>
    </div>
    <div style="padding:24px;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">
        <thead>
          <tr style="background:#f9fafb;font-size:12px;color:#6b7280">
            <th style="padding:10px 8px;text-align:right">חנות</th>
            <th style="text-align:center">סה"כ</th>
            <th style="text-align:center">עדכון אחרון</th>
            <th style="text-align:center">🖼️ תמונה</th>
            <th style="text-align:center">🎨 צבע</th>
            <th style="text-align:center">📏 מידה</th>
            <th style="text-align:center">🏷️ קטגוריה</th>
            <th style="text-align:center">💰 מחיר 0</th>
            <th style="text-align:center">🆕 ללא מלאי</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div style="margin-top:18px;font-size:12px;color:#9ca3af;line-height:1.9">
        <strong>מקרא:</strong> 🟢 הכל תקין &nbsp;|&nbsp; 🟡 אזהרה &nbsp;|&nbsp; 🔴 קריטי — סקרייפר לא רץ 3+ ימים<br/>
        ✅ = אין בעיות &nbsp;|&nbsp; % = אחוז מסה"כ מוצרי החנות
      </div>
    </div>
  </div>
</body>
</html>`;

  const emoji  = hasRed ? '🔴' : hasYellow ? '⚠️' : '✅';
  const status = hasRed ? 'קריטי' : hasYellow ? 'אזהרה' : 'הכל תקין';
  const subject = `${emoji} LOOKLI Scrapers — ${status} | ${new Date().toLocaleDateString('he-IL')}`;

  await sendEmail(ADMIN_EMAIL, subject, html);
  await pool.end();
}

runHealthCheck().catch(e => { console.error('שגיאה:', e.message); process.exit(1); });
