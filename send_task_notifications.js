/**
 * send_task_notifications.js — LOOKLI
 * שולח מיילים על שינויי משימות מהתור
 * רץ בסוף כל הרצת סקרייפרים (דרך run_scrapers.js)
 */

import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('rlwy.net') ? { rejectUnauthorized: false } : undefined,
});

const BREVO_KEY  = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL  || 'alerts@lookli.co.il';
const FROM_NAME  = 'LOOKLI משימות';
const NOTIFY     = process.env.ADMIN_NOTIFY_EMAIL;
const SITE_URL   = process.env.SITE_URL    || 'https://lookli.co.il';

async function sendEmail(toEmails, subject, htmlBody) {
  if (!BREVO_KEY) { console.log('[TASKS] BREVO_API_KEY חסר'); return false; }
  const to = toEmails.split(',').map(e => ({ email: e.trim() })).filter(e => e.email);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: { name: FROM_NAME, email: FROM_EMAIL }, to, subject, htmlContent: htmlBody }),
    });
    if (res.ok) { console.log(`  ✅ מייל משימות נשלח`); return true; }
    const e = await res.json(); console.error('  ❌ Brevo:', e); return false;
  } catch(e) { console.error('  ❌ שגיאה:', e.message); return false; }
}

function buildHtml(changes) {
  const TYPE_LABEL = {
    created:     '✅ נוצרה',
    completed:   '🎉 הושלמה',
    deleted:     '🗑️ נמחקה',
    reassigned:  '👤 שויכה מחדש',
    progress:    '⚡ התקדמות',
    sub_added:   '➕ תת-משימה נוספה',
    sub_toggled: '☑️ תת-משימה עודכנה',
    sub_deleted: '🗑️ תת-משימה נמחקה',
    log_added:   '📝 לוג נוסף',
    log_deleted: '🗑️ לוג נמחק',
  };

  const rows = changes.map(c => {
    const label = TYPE_LABEL[c.type] || c.type;
    let extra = '';
    if (c.type === 'reassigned') extra = `<br><span style="color:#9ca3af;font-size:11px">מ-${c.from||'ללא'} ל-${c.to||'ללא'}</span>`;
    if (c.type === 'progress')   extra = `<br><span style="color:#9ca3af;font-size:11px">${c.val}%</span>`;
    if (['sub_added','sub_toggled','sub_deleted'].includes(c.type)) extra = `<br><span style="color:#9ca3af;font-size:11px">${c.subText||c.text||''}</span>`;
    if (c.type === 'log_added')  extra = `<br><span style="color:#9ca3af;font-size:11px">${c.text||''}</span>`;
    const person = c.person ? `<span style="color:#c084fc">${c.person}</span>` : '';
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #2a2a3a;font-size:13px">${label}${extra}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #2a2a3a;font-size:13px;font-weight:600">${c.taskTitle||''}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #2a2a3a;font-size:12px">${person}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Heebo',Arial,sans-serif;direction:rtl">
  <div style="max-width:580px;margin:30px auto;background:#12121a;border-radius:14px;overflow:hidden;border:1px solid #2a2a3a">
    <div style="background:linear-gradient(135deg,#c084fc,#818cf8);padding:20px 24px">
      <div style="font-size:22px;font-weight:900;color:#fff">LOOKLI</div>
      <div style="font-size:13px;color:rgba(255,255,255,.8)">עדכון משימות</div>
    </div>
    <div style="padding:20px 24px">
      <p style="color:#f1f0ff;font-size:14px;margin-bottom:16px">${changes.length} שינויים בוצעו:</p>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1a1a26">
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280">פעולה</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280">משימה</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280">אחראי</th>
        </tr></thead>
        <tbody style="color:#f1f0ff">${rows}</tbody>
      </table>
      <a href="${SITE_URL}/admin/tasks" style="display:inline-block;margin-top:18px;background:linear-gradient(135deg,#c084fc,#818cf8);color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none">פתח לוח משימות</a>
    </div>
  </div>
</body></html>`;
}

async function run() {
  if (!NOTIFY) { console.log('[TASKS] ADMIN_NOTIFY_EMAIL לא מוגדר — יוצא'); process.exit(0); }

  // שלוף נוטיפיקציות שלא נשלחו
  const { rows } = await pool.query(`
    SELECT id, changes FROM task_notifications_queue
    WHERE sent_at IS NULL
    ORDER BY created_at ASC
  `);

  if (!rows.length) { console.log('[TASKS] אין שינויים ממתינים'); await pool.end(); return; }

  // מזג את כל השינויים למייל אחד
  const allChanges = rows.flatMap(r => r.changes);
  const ids = rows.map(r => r.id);

  console.log(`[TASKS] שולח מייל עם ${allChanges.length} שינויים...`);
  const html = buildHtml(allChanges);
  const ok = await sendEmail(NOTIFY, `📋 עדכון משימות LOOKLI — ${allChanges.length} שינויים`, html);

  if (ok) {
    await pool.query(`UPDATE task_notifications_queue SET sent_at=NOW() WHERE id=ANY($1)`, [ids]);
  }

  await pool.end();
}

run().catch(e => { console.error('[TASKS] שגיאה:', e.message); process.exit(1); });
