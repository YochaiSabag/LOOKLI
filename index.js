console.log("BOOT DEBUG ROUTE VERSION 1");
import 'dotenv/config';
import express from "express";
import compression from "compression";
import pkg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { createHmac, randomBytes } from "crypto";
import { GoogleAuth } from "google-auth-library";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pkg;
const app = express();

// escape בטוח לטקסט המוזרק ל-HTML גולמי (כותרות/תיאורי מוצרים שמקורם בסריקה חיצונית — לא סומכים על התוכן)
function escapeHtmlAttr(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
app.set('trust proxy', 1); // Railway רץ מאחורי proxy
app.use(compression()); // gzip לכל התגובות — מקטין את גודל ההעברה משמעותית (HTML/CSS/JS/JSON)

// Google Sign In — דורש COOP מסוים
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ===== Rate Limiting =====
// API כללי — 100 בקשות לדקה
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'יותר מדי בקשות — נסה שוב בעוד דקה' }
});

// חיפוש — 30 בקשות לדקה
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'יותר מדי חיפושים — נסה שוב בעוד דקה' }
});

// login/register — 10 ניסיונות לדקה (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { error: 'יותר מדי ניסיונות כניסה — נסה שוב בעוד דקה' }
});

app.use('/api/', apiLimiter);
app.use('/api/products', searchLimiter);
app.use('/api/ai-search', searchLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ===== הגנת API =====

// חסימת בוטים ידועים
const BOT_AGENTS = ['python-requests', 'scrapy', 'wget', 'curl/', 'go-http', 'java/', 'okhttp', 'axios/0', 'node-fetch', 'httpx'];
app.use('/api/', (req, res, next) => {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (BOT_AGENTS.some(b => ua.includes(b))) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
});

// Origin check — רק lookli.co.il יכול לקרוא לAPI
app.use('/api/', (req, res, next) => {
  // דלג על admin routes
  if (req.path.startsWith('/admin')) return next();
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const allowed = ['lookli.co.il', 'www.lookli.co.il', 'lookli-production.up.railway.app', 'localhost'];
  const isAllowed = !origin || allowed.some(d => origin.includes(d)) || allowed.some(d => referer.includes(d));
  if (!isAllowed) return res.status(403).json({ error: 'Access denied' });
  next();
});

// ===== SEO helpers (robots.txt + sitemap.xml) =====
const SITE_URL = process.env.SITE_URL || "https://lookli.co.il";

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Sitemap: ${SITE_URL}/sitemap.xml
`);
});

// ================================================

app.get("/api/debug/version", (req, res) => {
  res.json({
    version: "v1-debug-2026-02-06-01",
    hasDatabaseUrl: !!process.env.DATABASE_URL,
  });
});
const PORT = process.env.PORT || 3000;

// Database connection - supports both DATABASE_URL and individual vars
// Database connection (Railway/Prod MUST use DATABASE_URL)
const connStr = process.env.DATABASE_URL;

if (!connStr) {
  // Fail fast so we never silently connect to localhost in Railway
  throw new Error("DATABASE_URL is missing. Set it in Railway > LOOKLI > Variables.");
}

const useSSL = connStr.includes("proxy.rlwy.net") || connStr.includes("rlwy.net");

const pool = new Pool({
  connectionString: connStr,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  max: 20,                       // ברירת המחדל של pg היא רק 10 — זה היה יכול לגרום לתורים תחת עומס
  idleTimeoutMillis: 30000,      // משחרר חיבורים לא פעילים חזרה למאגר אחרי 30 שניות
  connectionTimeoutMillis: 5000, // אם ה-pool מלא, נכשל מהר (5 שניות) במקום להיתקע לנצח
});

app.use(express.json({ limit: '5mb' }));

// POST /api/contact-form — קולט פניות מטופס "צור קשר" ושולח מייל
app.post('/api/contact-form', async (req, res) => {
  try {
    const { type, name, email, phone, storeName, storeUrl, subject, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'שם, אימייל והודעה הם שדות חובה' });
    }
    if (!process.env.RESEND_API_KEY) {
      console.error('[contact-form] RESEND_API_KEY חסר');
      return res.status(500).json({ error: 'שגיאת שרת — נסו שוב מאוחר יותר' });
    }

    const TYPE_LABELS = { store: 'בקשת הצטרפות לאתר', update: 'עדכון פרטי חנות', question: 'שאלה כללית', bug: 'דיווח על באג/תקלה', suggestion: 'הצעה לשיפור', product: 'בעיה עם מוצר ספציפי', other: 'אחר' };
    const typeLabel = TYPE_LABELS[type] || TYPE_LABELS[subject] || 'פנייה כללית';

    const rows = [
      ['סוג פנייה', typeLabel],
      ['שם', name],
      ['אימייל', email],
      ['טלפון', phone || '—'],
    ];
    if (storeName) rows.push(['שם חנות', storeName]);
    if (storeUrl)  rows.push(['כתובת אתר', storeUrl]);

    const rowsHtml = rows.map(([label, val]) =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;font-weight:600">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px">${String(val).replace(/</g,'&lt;')}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:'Heebo',Arial,sans-serif;direction:rtl">
  <div style="max-width:580px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);border:1px solid #e5e7eb">
    <div style="background:linear-gradient(135deg,#d191b0,#c48cb3);padding:20px 24px">
      <div style="font-size:22px;font-weight:900;color:#fff">LOOKLI</div>
      <div style="font-size:13px;color:rgba(255,255,255,.8)">📩 פנייה חדשה מטופס "צור קשר" — ${typeLabel}</div>
    </div>
    <div style="padding:20px 24px">
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:16px">
        <tbody>${rowsHtml}</tbody>
      </table>
      <div style="font-size:12px;color:#6b7280;font-weight:600;margin-bottom:6px">הודעה:</div>
      <div style="padding:14px;background:#f9fafb;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap">${String(message).replace(/</g,'&lt;')}</div>
      <a href="mailto:${email}" style="display:inline-block;margin-top:18px;background:linear-gradient(135deg,#d191b0,#c48cb3);color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none">השב ל-${name}</a>
    </div>
  </div>
</body></html>`;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'LOOKLI טופס יצירת קשר <noreply@lookli.co.il>',
        to: ['lookli2015@gmail.com'],
        reply_to: email,
        subject: `📩 ${typeLabel} — ${name}`,
        html,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[contact-form] Resend error:', JSON.stringify(data));
      return res.status(500).json({ error: 'שליחת המייל נכשלה — נסו שוב' });
    }
    console.log(`[contact-form] ✅ מייל נשלח: ${typeLabel} מ-${name} (${email})`);
    res.json({ ok: true });
  } catch(e) {
    console.error('[contact-form] שגיאה:', e.message);
    res.status(500).json({ error: 'שגיאת שרת — נסו שוב מאוחר יותר' });
  }
});

// ===== נעילת אתר — רק דרך קישור זמני =====
const SITE_LOCKED = process.env.SITE_LOCKED === 'true';

async function isValidPreviewToken(token) {
  if (!token) return false;
  try {
    const r = await pool.query(
      `SELECT 1 FROM preview_tokens WHERE token=$1 AND expires_at > NOW()`,
      [token]
    );
    return r.rows.length > 0;
  } catch(e) { return false; }
}

if (SITE_LOCKED) {
  app.use(async (req, res, next) => {
    if (
      req.path.startsWith('/admin') ||
      req.path.startsWith('/api/') ||
      req.path.match(/\.(js|css|png|jpg|svg|ico|webp|woff2?)$/)
    ) return next();

    const cookieToken = (req.headers.cookie || '').match(/preview_token=([a-f0-9]+)/)?.[1];
    const queryToken = req.query.preview;
    const token = queryToken || cookieToken;

    if (token && await isValidPreviewToken(token)) {
      if (queryToken) {
        // קרא את תוקף הטוקן מה-DB לcookie
        const r = await pool.query(`SELECT expires_at FROM preview_tokens WHERE token=$1`, [token]);
        const maxAge = r.rows[0] ? Math.floor((new Date(r.rows[0].expires_at) - Date.now()) / 1000) : 86400;
        res.setHeader('Set-Cookie', `preview_token=${token}; Path=/; Max-Age=${maxAge}`);
      }
      return next();
    }

    res.status(403).send(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>LOOKLI</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0f;color:#f1f0ff;text-align:center}.box{padding:40px}.logo{font-size:32px;font-weight:900;background:linear-gradient(135deg,#c084fc,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:16px}.msg{color:#6b7280;font-size:15px}</style></head><body><div class="box"><div class="logo">LOOKLI</div><div class="msg">האתר בשלבי בנייה — נחזור בקרוב ✨</div></div></body></html>`);
  });
}

// sitemap.xml דינמי — חייב לפני express.static
app.get("/sitemap.xml", async (req, res) => {
  try {
    const base = process.env.SITE_URL || 'https://lookli.co.il';
    const products = await pool.query(
      `SELECT id, title, last_seen FROM products
       WHERE title IS NOT NULL
         AND (banned IS NULL OR banned = false)
         AND (hidden_stale IS NULL OR hidden_stale = false)
       ORDER BY last_seen DESC`
    );

    const staticUrls = [
      { loc: `${base}/`, priority: '1.0', changefreq: 'daily' },
      { loc: `${base}/about`, priority: '0.5', changefreq: 'monthly' },
      { loc: `${base}/contact`, priority: '0.5', changefreq: 'monthly' },
      { loc: `${base}/advertise`, priority: '0.5', changefreq: 'monthly' },
    ];

    const productUrls = products.rows.map(p => {
      const slug = (p.title || '').trim()
        .replace(/\s+/g, '-')
        .replace(/[^\u05D0-\u05EAa-zA-Z0-9\-]/g, '')
        .toLowerCase()
        .replace(/-+/g, '-')
        .replace(/^-|-$/, '');
      const lastmod = p.last_seen ? new Date(p.last_seen).toISOString().split('T')[0] : '';
      return { loc: `${base}/product/${slug || p.id}`, priority: '0.8', changefreq: 'weekly', lastmod };
    });

    const allUrls = [...staticUrls, ...productUrls];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('sitemap error:', err.message);
    res.status(500).send('Error generating sitemap');
  }
});

// עמודים סטטיים — URL נקי בלי .html
app.get("/about", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "about.html"));
});
app.get("/contact", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "contact.html"));
});
app.get("/advertise", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "advertise.html"));
});
// הפניות 301 מהכתובות הישנות עם .html — לשמירה על SEO וקישורים קיימים
app.get("/about.html", (req, res) => res.redirect(301, "/about"));
app.get("/contact.html", (req, res) => res.redirect(301, "/contact"));
app.get("/advertise.html", (req, res) => res.redirect(301, "/advertise"));

app.use(express.static(path.join(__dirname, "public"), {
  maxAge: '7d',        // תמונות, CSS, JS — cache שבוע
  etag: true,
  setHeaders: (res, filePath) => {
    // index.html — אל תכניס לcache (תמיד עדכני)
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
// שים לב: אין כאן static(__dirname) — admin קבצים מוגנים בסיסמה

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// SPA route — מוצר לפי slug או ID (עם SSR למטא-טאגים)
app.get("/product/:slug", async (req, res) => {
  const slug = req.params.slug;
  try {
    // חפש מוצר לפי ID או slug
    let product = null;
    if (/^\d+$/.test(slug)) {
      const r = await pool.query('SELECT * FROM products WHERE id=$1', [parseInt(slug)]);
      product = r.rows[0];
    } else {
      const r = await pool.query(
        `SELECT * FROM products WHERE lower(regexp_replace(title, '[^\\u05D0-\\u05EAa-zA-Z0-9]+', '-', 'g')) = $1 LIMIT 1`,
        [slug.toLowerCase()]
      );
      product = r.rows[0];
    }

    if (product && (product.banned || product.hidden_stale)) product = null;

    if (!product) return res.sendFile(path.join(__dirname, "public", "index.html"));

    // בנה HTML עם OG tags מלאים
    const base = process.env.SITE_URL || 'https://lookli.co.il';
    const title = product.title || 'מוצר';
    const desc = product.description || `${title} ב-${product.store} — ₪${product.price}`;
    const img = (product.images?.[0]) || product.image_url || '';
    const url = `${base}/product/${slug}`;

    const html = await res.sendFile(path.join(__dirname, "public", "index.html"), {}, async (err) => {});

    // קרא את ה-index.html והזרק meta tags
    const fs = await import('fs');
    let indexHtml = fs.readFileSync(path.join(__dirname, "public", "index.html"), 'utf8');
    indexHtml = indexHtml.replace(
      '</head>',
      `<meta property="og:title" content="${escapeHtmlAttr(title)} – LOOKLI"/>
<meta property="og:description" content="${escapeHtmlAttr(desc.substring(0,200))}"/>
<meta property="og:image" content="${escapeHtmlAttr(img)}"/>
<meta property="og:url" content="${escapeHtmlAttr(url)}"/>
<meta property="og:type" content="product"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtmlAttr(title)} – LOOKLI"/>
<meta name="twitter:image" content="${escapeHtmlAttr(img)}"/>
<title>${escapeHtmlAttr(title)} – LOOKLI</title>
</head>`
    );
    // תוכן אמיתי הנקרא בגוף ה-HTML הגולמי (לא רק meta tags) — כדי שגוגל יראה תוכן ממשי בלי להסתמך על ריצת JS.
    // ממוקם ממש לפני סגירת body כדי לא להפריע ויזואלית לתצוגה האינטראקטיבית הרגילה של הדף.
    const ssrBlock = `
<div id="ssr-product-seo" style="max-width:800px;margin:40px auto;padding:0 20px;">
  <h1>${escapeHtmlAttr(title)}</h1>
  ${img ? `<img src="${escapeHtmlAttr(img)}" alt="${escapeHtmlAttr(title)}" style="max-width:100%;height:auto;border-radius:8px;"/>` : ''}
  <p>${escapeHtmlAttr(desc)}</p>
  <p>מחיר: ₪${product.price || ''}${product.store ? ` | חנות: ${escapeHtmlAttr(product.store)}` : ''}</p>
</div>`;
    indexHtml = indexHtml.replace('</body>', `${ssrBlock}\n</body>`);
    res.send(indexHtml);
  } catch(err) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Image Proxy — מגיש תמונות חיצוניות עם cache (מאיץ נייד)
// GET /ic?u=URL — proxy בזמן אמת לchemise.co.il (ללא אחסון בDB)
app.get('/ic', async (req, res) => {
  const url = req.query.u;
  if (!url) return res.status(400).end();
  try {
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://chemise.co.il/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/*,*/*;q=0.8',
      }
    });
    if (!response.ok) return res.status(404).end();
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch(e) { res.status(500).end(); }
});

app.get("/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  try {
    // וודא שה-URL מאתר מותר
    const allowed = ['mekimi.co.il','lichi-shop.com','wixstatic.com','aviyahyosef.com',
                     'chemise.co.il','ordman.co.il','rare.co.il','avivit-weizman.co.il',
                     'cdn.2all.co.il','amazonaws.com','wp-content'];
    const isAllowed = allowed.some(d => url.includes(d));
    if (!isAllowed) return res.status(403).send('Not allowed');

    // נסה ללא Referer תחילה (חלק מ-hotlink protection מאפשר גישה ישירה)
    let imgRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'image/*,*/*' }
    });
    // אם נחסם — נסה עם Referer של האתר המקורי
    if (!imgRes.ok) {
      const domain = new URL(url).origin;
      imgRes = await fetch(url, {
        headers: { 'Referer': domain + '/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'image/*,*/*', 'Accept-Language': 'he-IL,he;q=0.9', 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-origin' }
      });
    }
    if (!imgRes.ok) return res.status(imgRes.status).send('Failed');

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800'); // cache שבוע
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch(e) {
    res.status(500).send('Error');
  }
});

const validColors = ['שחור', 'לבן', 'שמנת', 'כחול', 'תכלת', 'נייבי', 'אדום', 'בורדו', 'ירוק', 'זית', 'חאקי', 'חום', 'קאמל', 'בז׳', 'ניוד', 'אפור', 'ורוד', 'סגול', 'לילך', 'צהוב', 'חרדל', 'כתום', 'זהב', 'כסף', 'פרחוני', 'צבעוני', 'מנטה', 'אפרסק', 'אבן', 'בהיר', 'אחר'];

const shippingInfo = {
  'MEKIMI': { cost: 25, threshold: 300 },
  'LICHI': { cost: 30, threshold: 350 },
  'MIMA': { cost: 30, threshold: 450 },
  'AVIYAH': { cost: 30, threshold: 500 },
  'CHEMISE': { cost: 30, threshold: 350 }
};

function calculateShipping(store, price) {
  const info = shippingInfo[store] || { cost: 30, threshold: 300 };
  const isFree = price >= info.threshold;
  return { cost: isFree ? 0 : info.cost, isFree, threshold: info.threshold };
}

// קאש פשוט בזיכרון למצב ברירת המחדל של /api/filters (בלי שום פילטר נבחר) —
// זה המקרה הנפוץ ביותר (רץ כמעט בכל טעינת עמוד), ומתעדכן מעצמו כל 3 דקות
let filtersDefaultCache = null;
let filtersDefaultCacheTime = 0;
const FILTERS_CACHE_TTL_MS = 3 * 60 * 1000;

app.get("/api/filters", async (req, res) => {
  try {
    const { store, category, color, size, style, fit, fabric, pattern, design } = req.query;
    const isDefaultState = !store && !category && !color && !size && !style && !fit && !fabric && !pattern && !design;
    if (isDefaultState && filtersDefaultCache && (Date.now() - filtersDefaultCacheTime < FILTERS_CACHE_TTL_MS)) {
      return res.json(filtersDefaultCache);
    }
    let baseWhere = '(banned IS NULL OR banned = false) AND (hidden_stale IS NULL OR hidden_stale = false)';
    const baseParams = [];
    let paramIndex = 1;
    
    if (store) { baseWhere += ` AND store = $${paramIndex++}`; baseParams.push(store); }
    if (category) { 
      const cats = category.split(',').filter(Boolean);
      if (cats.length === 1) {
        baseWhere += ` AND (category = $${paramIndex} OR title ILIKE $${paramIndex + 1})`; baseParams.push(cats[0], `%${cats[0]}%`); paramIndex += 2;
      } else {
        baseWhere += ` AND category = ANY($${paramIndex}::text[])`; baseParams.push(cats); paramIndex++;
      }
    }
    if (style) { 
      const styles = style.split(',').filter(Boolean);
      if (styles.length > 1) {
        baseWhere += ` AND style = ANY($${paramIndex}::text[])`; baseParams.push(styles); paramIndex++;
      } else if (styles[0] === 'יום חול') {
        baseWhere += ` AND (style = $${paramIndex} OR style = 'יומיומי' OR title ILIKE '%יום חול%' OR title ILIKE '%יומיומי%' OR title ILIKE '%יום יום%' OR description ILIKE '%יום חול%' OR description ILIKE '%יומיומי%')`;
        baseParams.push(styles[0]); paramIndex++;
      } else if (styles[0] === 'שבת/ערב') {
        baseWhere += ` AND (style IN ('ערב','חגיגי','אלגנטי','שבת') OR title ILIKE '%שבת%' OR title ILIKE '%ערב%' OR title ILIKE '%חגיג%' OR title ILIKE '%אלגנט%')`;
      } else {
        baseWhere += ` AND (style = $${paramIndex} OR title ILIKE $${paramIndex + 1})`; baseParams.push(styles[0], `%${styles[0]}%`); paramIndex += 2;
      }
    }
    if (fit) {
      const fits = fit.split(',').filter(Boolean);
      if (fits.length > 1) {
        baseWhere += ` AND fit = ANY($${paramIndex}::text[])`; baseParams.push(fits); paramIndex++;
      } else if (fits[0] === '\u05d0\u05e8\u05d5\u05db\u05d4') {
        baseWhere += ` AND (fit = $${paramIndex} OR fit = '\u05d0\u05e8\u05d5\u05da' OR title ILIKE '%\u05de\u05e7\u05e1\u05d9%' OR title ILIKE '%maxi%')`;
        baseParams.push(fits[0]); paramIndex++;
      } else if (fits[0] === '\u05de\u05d9\u05d3\u05d9') {
        baseWhere += ` AND (fit = $${paramIndex} OR title ILIKE '%\u05de\u05d9\u05d3\u05d9%' OR title ILIKE '%midi%' OR title ILIKE '%\u05d0\u05de\u05e6\u05e2%')`;
        baseParams.push(fits[0]); paramIndex++;
      } else {
        baseWhere += ` AND (fit = $${paramIndex} OR title ILIKE $${paramIndex + 1})`;
        baseParams.push(fits[0], `%${fits[0]}%`); paramIndex += 2;
      }
    }
    if (color) { 
      const LIGHT_COLORS = ['אבן', 'לבן', 'שמנת', 'תכלת', 'צהוב', 'אפרסק', 'מנטה'];
      let colors = color.split(',').filter(Boolean);
      // "בהיר" → הרחב לכל הצבעים הבהירים
      if (colors.includes('בהיר')) {
        colors = [...new Set([...colors.filter(c => c !== 'בהיר'), ...LIGHT_COLORS])];
      }
      if (colors.length === 1) {
        baseWhere += ` AND (color = $${paramIndex} OR $${paramIndex} = ANY(colors))`; baseParams.push(colors[0]); paramIndex++;
      } else {
        baseWhere += ` AND (color = ANY($${paramIndex}::text[]) OR colors && $${paramIndex}::text[])`; baseParams.push(colors); paramIndex++;
      }
    }
    if (size) { 
      const sizes = size.split(',').filter(Boolean);
      if (sizes.length === 1) {
        baseWhere += ` AND $${paramIndex} = ANY(sizes)`; baseParams.push(sizes[0]); paramIndex++;
      } else {
        baseWhere += ` AND sizes && $${paramIndex}::text[]`; baseParams.push(sizes); paramIndex++;
      }
    }
    
    const [storesRes, sizesRes, colorsRes, stylesRes, fitsRes, categoriesRes, maxPriceRes, patternsRes, fabricsRes, designRes] = await Promise.all([
      pool.query(`SELECT DISTINCT store FROM products WHERE ${baseWhere} AND store IS NOT NULL ORDER BY store`, baseParams),
      pool.query(`SELECT DISTINCT unnest(sizes) AS size FROM products WHERE ${baseWhere} AND sizes IS NOT NULL`, baseParams),
      pool.query(`SELECT DISTINCT c AS color FROM (SELECT color AS c FROM products WHERE ${baseWhere} AND color IS NOT NULL AND color != '' UNION SELECT unnest(colors) AS c FROM products WHERE ${baseWhere} AND colors IS NOT NULL) sub ORDER BY c`, [...baseParams, ...baseParams]),
      pool.query(`SELECT DISTINCT style FROM products WHERE ${baseWhere} AND style IS NOT NULL AND style != '' ORDER BY style`, baseParams),
      pool.query(`SELECT DISTINCT fit FROM products WHERE ${baseWhere} AND fit IS NOT NULL AND fit != '' ORDER BY fit`, baseParams),
      pool.query(`SELECT DISTINCT category FROM products WHERE ${baseWhere} AND category IS NOT NULL AND category != '' ORDER BY category`, baseParams),
      pool.query(`SELECT MAX(price) as max_price FROM products WHERE ${baseWhere} AND price > 0`, baseParams),
      pool.query(`SELECT DISTINCT pattern FROM products WHERE ${baseWhere} AND pattern IS NOT NULL AND pattern != '' ORDER BY pattern`, baseParams),
      pool.query(`SELECT DISTINCT fabric FROM products WHERE ${baseWhere} AND fabric IS NOT NULL AND fabric != '' ORDER BY fabric`, baseParams),
      pool.query(`SELECT DISTINCT unnest(design_details) AS detail FROM products WHERE ${baseWhere} AND design_details IS NOT NULL`, baseParams)
    ]);

    // ערכים תקפים מ-scraper_config — רק מה שמוגדר שם יופיע בפילטרים
    const cfgRows = await pool.query(
      `SELECT type, name, color_hex FROM scraper_config ORDER BY name`
    );
    const cfgByType = {};
    const colorHexFromDB = {};
    cfgRows.rows.forEach(r => {
      if (!cfgByType[r.type]) cfgByType[r.type] = new Set();
      cfgByType[r.type].add(r.name);
      if (r.type === 'color' && r.color_hex) colorHexFromDB[r.name] = r.color_hex;
    });

    // פונקציית סינון: מציג רק ערכים שגם מוגדרים ב-config וגם קיימים בפועל במוצרים
    const filterByCfg = (rows, key, type) => {
      const vals = rows.map(r => r[key]).filter(Boolean);
      if (!cfgByType[type] || cfgByType[type].size === 0) return [...new Set(vals)];
      return [...new Set(vals.filter(v => cfgByType[type].has(v)))];
    };

    const validColorSet = cfgByType['color']?.size > 0 ? cfgByType['color'] : new Set(validColors);
    const VALID_SIZES = new Set(['XS','S','M','L','XL','XXL','XXXL','2XL','3XL','4XL','ONE SIZE','OS','FREE SIZE']);
    const sizeOrder = ['XS','S','M','L','XL','XXL','XXXL','2XL','3XL','4XL','ONE SIZE','OS','FREE SIZE'];
    const filteredSizes = sizesRes.rows.map(r => r.size).filter(s => s && VALID_SIZES.has(s.toUpperCase().trim()));
    const uniqueSizes = [...new Set(filteredSizes)].sort((a,b) => {
      const ai = sizeOrder.indexOf(a.toUpperCase());
      const bi = sizeOrder.indexOf(b.toUpperCase());
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    const responseData = {
      stores: storesRes.rows.map(r => r.store).filter(Boolean),
      sizes: uniqueSizes,
      colors: colorsRes.rows.map(r => r.color).filter(c => c && validColorSet.has(c)),
      colorHex: colorHexFromDB,
      styles:     filterByCfg(stylesRes.rows,     'style',    'style'),
      fits:       filterByCfg(fitsRes.rows,        'fit',      'fit'),
      categories: filterByCfg(categoriesRes.rows,  'category', 'category'),
      patterns:   filterByCfg(patternsRes.rows,    'pattern',  'pattern'),
      fabrics:    filterByCfg(fabricsRes.rows,     'fabric',   'fabric'),
      designs: designRes.rows.map(r => r.detail).filter(Boolean),
      maxPrice: Math.ceil(parseFloat(maxPriceRes.rows[0]?.max_price) || 500)
    };
    if (isDefaultState) {
      filtersDefaultCache = responseData;
      filtersDefaultCacheTime = Date.now();
    }
    res.json(responseData);
  } catch (err) {
    console.error("filters error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

// מיפוי מידות מספריות -> אוניברסליות (כמו בסקרייפר)
const sizeMapping = {
  '34': ['XS'], '36': ['XS', 'S'], '38': ['S', 'M'], '40': ['M', 'L'],
  '42': ['L', 'XL'], '44': ['XL', 'XXL'], '46': ['XXL', 'XXXL'], '48': ['XXXL']
};

function expandSize(size) {
  if (!size) return [size];
  const mapped = sizeMapping[size];
  if (mapped) return mapped;
  return [size];
}

// מילון כינויי צבעים — שם נרדף → צבע נורמלי ב-DB
const COLOR_ALIASES = {
  'מוקה': 'חום', 'moka': 'חום', 'mocha': 'חום', 'קפה': 'חום', 'שוקולד': 'חום', 'espresso': 'חום', 'chestnut': 'חום',
  'קאמל': 'קאמל', 'cognac': 'קאמל',
  'ניוד': 'בז׳', 'nude': 'בז׳', 'sand': 'בז׳', 'taupe': 'בז׳',
  'נייבי': 'כחול', 'navy': 'כחול', 'cobalt': 'כחול', 'indigo': 'כחול', 'דנים': 'כחול', 'denim': 'כחול',
  'בורדו': 'בורדו', 'burgundy': 'בורדו', 'wine': 'בורדו', 'maroon': 'בורדו',
  'שמנת': 'שמנת', 'ivory': 'שמנת', 'ecru': 'שמנת', 'cream': 'שמנת', 'vanilla': 'שמנת',
  'לילך': 'סגול', 'lavender': 'סגול', 'lilac': 'סגול', 'plum': 'סגול', 'mauve': 'סגול',
  'קורל': 'ורוד', 'coral': 'ורוד', 'salmon': 'ורוד', 'blush': 'ורוד', 'פודרה': 'ורוד', 'powder': 'ורוד',
  'חרדל': 'צהוב', 'mustard': 'צהוב', 'gold': 'צהוב', 'lemon': 'צהוב',
  'זית': 'ירוק', 'olive': 'ירוק', 'sage': 'ירוק', 'teal': 'ירוק', 'חאקי': 'ירוק', 'khaki': 'ירוק',
  'פוקסיה': 'ורוד', 'fuchsia': 'ורוד', 'magenta': 'ורוד',
  'אפרסק': 'אפרסק', 'peach': 'אפרסק',
  'מנטה': 'מנטה', 'mint': 'מנטה',
  'טורקיז': 'תכלת', 'turquoise': 'תכלת', 'aqua': 'תכלת',
  'ראסט': 'כתום', 'rust': 'כתום', 'tangerine': 'כתום',
  'אבן': 'אבן', 'stone': 'אבן',
  'שזיף': 'סגול',
  'זהב': 'זהב', 'golden': 'זהב',
  'כסף': 'כסף', 'silver': 'כסף',
};

// מפת כינויים לכל הקטגוריות (נטענת מ-DB בהפעלה)
let SEARCH_ALIASES = {}; // alias → { name, type }

async function loadSearchAliases() {
  try {
    SEARCH_ALIASES = {}; // איפוס לפני rebuild — ערכים שנמחקו לא יישארו
    const r = await pool.query(`SELECT type, name, aliases FROM scraper_config WHERE aliases IS NOT NULL`);
    r.rows.forEach(row => {
      (row.aliases || []).forEach(alias => {
        const key = alias.toLowerCase().trim();
        SEARCH_ALIASES[key] = { name: row.name, type: row.type }; // תמיד דרוס
      });
      // גם השם עצמו
      SEARCH_ALIASES[row.name.toLowerCase()] = { name: row.name, type: row.type };
    });
    // COLOR_ALIASES כ-fallback בלבד (לא דורסים DB)
    Object.entries(COLOR_ALIASES).forEach(([alias, name]) => {
      if (!SEARCH_ALIASES[alias.toLowerCase()]) SEARCH_ALIASES[alias.toLowerCase()] = { name, type: 'color' };
    });
    console.log(`✅ SEARCH_ALIASES נטען: ${Object.keys(SEARCH_ALIASES).length} כינויים`);
  } catch(e) {
    console.log('⚠️ loadSearchAliases:', e.message);
  }
}


app.get("/api/products", async (req, res) => {
  try {
    const { q, color, size, store, style, fit, category, maxPrice, sort, minDiscount, fabric, pattern, design } = req.query;
    let sql = `SELECT id, title, price, original_price, image_url, images, sizes, color, colors, style, styles, fit, fits, category, store, source_url, description, pattern, fabric, design_details, color_sizes, image_size_bytes, tagged_fields, has_valid_image FROM products WHERE (banned IS NULL OR banned = false) AND (hidden_stale IS NULL OR hidden_stale = false)`;
    const params = [];
    let i = 1;

    // סינון אקססוריז - לא מציגים גומיות שיער וכדומה
    sql += ` AND (category IS NULL OR category NOT IN ('גומיות', 'גומייה', 'אקססוריז', 'אביזרים', 'תכשיטים', 'כובעים', 'צעיפים', 'תיקים'))`;
    sql += ` AND title NOT ILIKE '%גומי%שיער%' AND title NOT ILIKE '%גומיי%'`;

    if (q) {
      const qLower = q.toLowerCase().trim();
      const aliasColor = COLOR_ALIASES[qLower] || COLOR_ALIASES[q];
      const aliasMatch = SEARCH_ALIASES[qLower];

      if (aliasMatch && aliasMatch.type === 'color') {
        sql += ` AND (title ILIKE $${i} OR color = $${i+1} OR $${i+1} = ANY(colors))`;
        params.push(`%${q}%`, aliasMatch.name); i += 2;
      } else if (aliasMatch && aliasMatch.type === 'category') {
        sql += ` AND (title ILIKE $${i} OR category = $${i+1})`;
        params.push(`%${q}%`, aliasMatch.name); i += 2;
      } else if (aliasMatch && aliasMatch.type === 'style') {
        sql += ` AND (title ILIKE $${i} OR style = $${i+1})`;
        params.push(`%${q}%`, aliasMatch.name); i += 2;
      } else if (aliasMatch && aliasMatch.type === 'fit') {
        sql += ` AND (title ILIKE $${i} OR fit = $${i+1})`;
        params.push(`%${q}%`, aliasMatch.name); i += 2;
      } else if (aliasMatch && aliasMatch.type === 'fabric') {
        sql += ` AND (title ILIKE $${i} OR fabric = $${i+1} OR description ILIKE $${i})`;
        params.push(`%${q}%`, aliasMatch.name); i += 2;
      } else if (aliasMatch && aliasMatch.type === 'pattern') {
        sql += ` AND (title ILIKE $${i} OR pattern = $${i+1})`;
        params.push(`%${q}%`, aliasMatch.name); i += 2;
      } else if (aliasColor) {
        sql += ` AND (title ILIKE $${i} OR color = $${i+1} OR $${i+1} = ANY(colors))`;
        params.push(`%${q}%`, aliasColor); i += 2;
      } else {
        sql += ` AND title ILIKE $${i++}`;
        params.push(`%${q}%`);
      }
    }
    
    if (color) { 
      const LIGHT_COLORS2 = ['אבן', 'לבן', 'שמנת', 'תכלת', 'צהוב', 'אפרסק', 'מנטה'];
      let colors = color.split(',').filter(Boolean);
      if (colors.includes('בהיר')) {
        colors = [...new Set([...colors.filter(c => c !== 'בהיר'), ...LIGHT_COLORS2])];
      }
      if (colors.length === 1) {
        sql += ` AND (color = $${i} OR $${i} = ANY(colors))`; params.push(colors[0]); i++;
      } else {
        sql += ` AND (color = ANY($${i}::text[]) OR colors && $${i}::text[])`;
        params.push(colors); i++;
      }
    }
    if (size) {
      const sizes = size.split(',').filter(Boolean);
      if (sizes.length === 1) {
        const expandedSizes = expandSize(sizes[0]);
        if (expandedSizes.length === 1) {
          sql += ` AND $${i} = ANY(sizes)`;
          params.push(expandedSizes[0]); i++;
        } else {
          sql += ` AND sizes && $${i}::text[]`;
          params.push(expandedSizes); i++;
        }
      } else {
        // Multi-select: expand all sizes and combine  
        const allExpanded = [];
        sizes.forEach(s => expandSize(s).forEach(es => { if (!allExpanded.includes(es)) allExpanded.push(es); }));
        sql += ` AND sizes && $${i}::text[]`;
        params.push(allExpanded); i++;
        console.log('[multi-size] expanded:', allExpanded, 'from:', sizes);
      }
    }
    if (store) { sql += ` AND store = $${i++}`; params.push(store); }
    if (req.query.safeImages === '1') { sql += ` AND has_valid_image = true`; }
    if (req.query.validImageOnly === '1') { sql += ` AND has_valid_image IS NOT false`; }

    // בדיקת התאמת צבע+מידה ב-SQL (לא ב-JS אחרי השליפה) — הכרחי כדי שLIMIT/OFFSET יהיו מדויקים
    if (color && size) {
      const LIGHT_COLORS2 = ['אבן', 'לבן', 'שמנת', 'תכלת', 'צהוב', 'אפרסק', 'מנטה'];
      let colorsForCS = color.split(',').filter(Boolean);
      if (colorsForCS.includes('בהיר')) {
        colorsForCS = [...new Set([...colorsForCS.filter(c => c !== 'בהיר'), ...LIGHT_COLORS2])];
      }
      const sizesForCS = size.split(',').filter(Boolean);
      const allExpandedSizesCS = [];
      sizesForCS.forEach(s => expandSize(s).forEach(es => { if (!allExpandedSizesCS.includes(es)) allExpandedSizesCS.push(es); }));
      sql += ` AND (
        color_sizes IS NULL OR color_sizes = '{}'::jsonb OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(color_sizes) AS ck
          WHERE ck = ANY($${i}::text[]) AND color_sizes -> ck ?| $${i+1}::text[]
        )
      )`;
      params.push(colorsForCS, allExpandedSizesCS); i += 2;
    }
    if (style) { 
      const styles = style.split(',').filter(Boolean);
      // מיפוי ערכי תצוגה מאוחדים לערכי DB אמיתיים (אותה לוגיקה גם לבחירה בודדת וגם למרובה)
      const expandStyle = (s) => {
        if (s === 'יום חול') return { vals: [s, 'יומיומי'], titleLikes: ['יום חול','יומיומי','יום יום'] };
        if (s === 'שבת/ערב') return { vals: ['ערב','חגיגי','אלגנטי','שבת'], titleLikes: ['שבת','ערב','חגיג','אלגנט'] };
        return { vals: [s], titleLikes: [s] };
      };
      if (styles.length === 1) {
        const s = styles[0];
        const exp = expandStyle(s);
        const valPlaceholders = exp.vals.map(() => `style = $${i++}`).join(' OR ');
        const likeParts = exp.titleLikes.map(t => `title ILIKE '%${t.replace(/'/g,"''")}%' OR description ILIKE '%${t.replace(/'/g,"''")}%'`).join(' OR ');
        sql += ` AND (${valPlaceholders} OR ${likeParts})`;
        exp.vals.forEach(v => params.push(v));
      } else {
        // בחירה מרובה — הרחב כל סגנון לערכי ה-DB האמיתיים שלו, חבר הכל ב-OR
        const allConds = [];
        styles.forEach(s => {
          const exp = expandStyle(s);
          exp.vals.forEach(v => { allConds.push(`style = $${i++}`); params.push(v); });
          exp.titleLikes.forEach(t => {
            allConds.push(`title ILIKE $${i}`); params.push(`%${t}%`); i++;
            allConds.push(`description ILIKE $${i}`); params.push(`%${t}%`); i++;
          });
        });
        sql += ` AND (${allConds.join(' OR ')})`;
      }
    }
    if (fit) { 
      const fits = fit.split(',').filter(Boolean);
      if (fits.length === 1) {
        const f = fits[0];
        if (f === 'ארוכה') {
          sql += ` AND (fit = $${i} OR fit = 'ארוך' OR title ILIKE '%מקסי%' OR title ILIKE '%maxi%')`;
          params.push(f); i++;
        } else if (f === 'מידי') {
          sql += ` AND (fit = $${i} OR title ILIKE '%מידי%' OR title ILIKE '%midi%' OR title ILIKE '%אמצע%')`;
          params.push(f); i++;
        } else {
          sql += ` AND (fit = $${i} OR title ILIKE $${i+1})`;
          params.push(f, `%${f}%`); i += 2;
        }
      } else {
        const orParts = fits.map((_, idx) => `fit = $${i + idx} OR title ILIKE $${i + fits.length + idx}`);
        sql += ` AND (${orParts.join(' OR ')})`;
        fits.forEach(f2 => params.push(f2));
        fits.forEach(f2 => params.push(`%${f2}%`));
        i += fits.length * 2;
      }
    }
    if (category) {
      const cats = category.split(',').filter(Boolean);
      if (cats.length === 1) {
        const cat = cats[0];
        if (cat === '\u05d7\u05dc\u05d5\u05e7') {
          sql += ` AND (category = $${i} OR title ILIKE $${i+1} OR title ILIKE '%\u05d0\u05d9\u05e8\u05d5\u05d7%')`;
          params.push(cat, `%${cat}%`); i += 2;
        } else {
          sql += ` AND (category = $${i} OR title ILIKE $${i+1})`;
          params.push(cat, `%${cat}%`); i += 2;
        }
      } else {
        // Multi-select: OR logic - category matches any, or title contains any
        const orParts = cats.map((_, idx) => `category = $${i + idx} OR title ILIKE $${i + cats.length + idx}`);
        sql += ` AND (${orParts.join(' OR ')})`;
        cats.forEach(c => params.push(c));
        cats.forEach(c => params.push(`%${c}%`));
        i += cats.length * 2;
      }
    }
    if (fabric) { 
      const fabrics = fabric.split(',').filter(Boolean);
      if (fabrics.length === 1) {
        sql += ` AND (fabric = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(fabrics[0], `%${fabrics[0]}%`); i += 2;
      } else {
        sql += ` AND (fabric = ANY($${i}::text[]))`;
        params.push(fabrics); i++;
      }
    }
    if (pattern) { 
      if (pattern === '\u05d7\u05dc\u05e7') {
        sql += ` AND (pattern = $${i})`; params.push(pattern); i++;
      } else {
    if (pattern) { 
      if (pattern === 'חלק') {
        sql += ` AND (pattern = $${i} OR title ~* $${i+1} OR description ~* $${i+1})`; 
        params.push(pattern, '(^|\\s)חלק(ה?)($|\\s|\\.)'); i += 2;
      } else {
        sql += ` AND (pattern = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(pattern, `%${pattern}%`); i += 2;
      }
    }
      }
    }
    if (design) { sql += ` AND $${i++} = ANY(design_details)`; params.push(design); }
    if (maxPrice) { sql += ` AND price <= $${i++}`; params.push(Number(maxPrice)); }
    if (minDiscount) { sql += ` AND original_price IS NOT NULL AND original_price > 0 AND ((original_price - price) / original_price * 100) >= $${i++}`; params.push(Number(minDiscount)); }

    const aliasColor = q ? (COLOR_ALIASES[q.toLowerCase().trim()] || COLOR_ALIASES[q]) : null;
    const aliasMatchQ = q ? SEARCH_ALIASES[q.toLowerCase().trim()] : null;
    const isAliasMatch = aliasMatchQ || aliasColor;

    // סה"כ תוצאות (לפני LIMIT/OFFSET) — לעימוד אמיתי בפרונט
    const countResult = await pool.query(`SELECT COUNT(*) AS total FROM (${sql}) AS sub`, params);
    const total = parseInt(countResult.rows[0]?.total || 0);

    if (sort === 'price_asc') {
    } else if (sort === 'price_desc') {
      sql += ` ORDER BY price DESC`;
    } else if (sort === 'popular') {
      sql += ` ORDER BY (SELECT COUNT(*) FROM clicks WHERE clicks.source_url = products.source_url) DESC, id DESC`;
    } else if (isAliasMatch && q) {
      // ווריאנט: עם המילה המדויקת בכותרת קודם, אח"כ שאר הצבע/קטגוריה לפי id
      sql += ` ORDER BY (CASE WHEN title ILIKE $${i} THEN 0 ELSE 1 END), id DESC`;
      params.push(`%${q}%`); i++;
    } else {
      sql += ` ORDER BY (id % 7), id DESC`;
    }

    // עימוד אמיתי — limit/offset מהפרונט, עם הגבלת ביטחון (מקסימום 100 בבקשה אחת)
    // אדמין מאומת (admsess תקין) מקבל תקרת limit גבוהה יותר — כלי ניהול צריכים לראות הרבה מוצרים בבת אחת
    const cookies = req.headers.cookie || '';
    const cookieMatch = cookies.match(/admsess=([a-f0-9]+)/);
    const isAdmin = cookieMatch && cookieMatch[1] === makeAdminCookieToken();
    const maxAllowedLimit = isAdmin ? 3000 : 100;
    const reqLimit = Math.min(parseInt(req.query.limit) || 60, maxAllowedLimit);
    const reqOffset = Math.max(parseInt(req.query.offset) || 0, 0);
    sql += ` LIMIT $${i} OFFSET $${i+1}`;
    params.push(reqLimit, reqOffset); i += 2;

    const result = await pool.query(sql, params);
    let rows = result.rows;

    res.json({
      results: rows.map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) })),
      total
    });
  } catch (err) {
    console.error("products error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

// API — מוצר לפי slug (כותרת מנורמלת)
app.get("/api/product/slug/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;
    // נסה קודם לפי ID אם ה-slug הוא מספר
    if (/^\d+$/.test(slug)) {
      const result = await pool.query(`SELECT * FROM products WHERE id = $1`, [parseInt(slug)]);
      if (result.rows.length && !result.rows[0].banned && !result.rows[0].hidden_stale) {
        const product = result.rows[0];
        product.shipping = calculateShipping(product.store, product.price);
        return res.json(product);
      }
    }
    // חפש לפי slug — השווה את ה-title מנורמל
    // חיפוש אמיתי — title → slug
    const all = await pool.query(
      `SELECT * FROM products WHERE lower(regexp_replace(title, '[^\\u05D0-\\u05EAa-zA-Z0-9]+', '-', 'g')) = $1 LIMIT 1`,
      [slug.toLowerCase()]
    );
    if (!all.rows.length) return res.status(404).json({ error: "Not found" });
    const product = all.rows[0];
    if (product.banned || product.hidden_stale) return res.status(404).json({ error: "Not found" });
    product.shipping = calculateShipping(product.store, product.price);
    res.json(product);
  } catch (err) {
    console.error("slug error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

app.get("/api/product/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const result = await pool.query(`SELECT * FROM products WHERE id = $1`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    const product = result.rows[0];
    if (product.banned || product.hidden_stale) return res.status(404).json({ error: "Not found" });
    product.shipping = calculateShipping(product.store, product.price);
    res.json(product);
  } catch (err) {
    console.error("product error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

// מוצרים דומים — דירוג לפי תאימות שדות
app.get("/api/similar/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const src = await pool.query(
      `SELECT id, category, color, colors, style, fit, store, price, pattern, fabric, design_details FROM products WHERE id = $1`,
      [id]
    );
    if (!src.rows.length) return res.status(404).json({ error: "Not found" });
    const p = src.rows[0];

    if (!p.category) return res.json([]);

    const candidates = await pool.query(
      `SELECT id, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, store, pattern, fabric, design_details
       FROM products
       WHERE id != $1 AND category = $2
       ORDER BY RANDOM()
       LIMIT 120`,
      [id, p.category]
    );

    const pColors = [p.color, ...(p.colors||[])].filter(Boolean);
    const pDesign = p.design_details || [];

    const scored = candidates.rows.map(c => {
      let score = 4; // קטגוריה זהה = בסיס
      const cColors = [c.color, ...(c.colors||[])].filter(Boolean);
      if (pColors.some(col => cColors.includes(col))) score += 3; // צבע
      if (p.style && c.style === p.style) score += 2;             // סגנון
      if (p.fit && c.fit === p.fit) score += 2;                   // גזרה
      if (p.pattern && c.pattern === p.pattern) score += 2;       // דוגמה
      if (p.fabric && c.fabric === p.fabric) score += 1;          // סוג בד
      const cDesign = c.design_details || [];
      const sharedDesign = pDesign.filter(d => cDesign.includes(d)).length;
      score += sharedDesign;                                        // עיצוב
      if (c.store !== p.store) score += 0.5;                       // גיוון חנויות
      return { ...c, score };
    }).filter(c => c.score >= 8); // מינימום 8 נקודות — קטגוריה + צבע + עוד משהו

    if (!scored.length) return res.json([]);

    scored.sort((a, b) => b.score - a.score);

    // גיוון חנויות — מקסימום 1 מוצר לחנות, אלא אם אין ברירה
    const storeSeen = {};
    const diverse = [];
    const leftovers = [];
    for (const item of scored) {
      if (!storeSeen[item.store]) {
        storeSeen[item.store] = 1;
        diverse.push(item);
      } else {
        leftovers.push(item);
      }
      if (diverse.length === 4) break;
    }
    // אם פחות מ-4 — מלא מהשאריות
    const result = diverse.length < 4
      ? [...diverse, ...leftovers.slice(0, 4 - diverse.length)]
      : diverse;

    res.json(result.slice(0,4).map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) })));
  } catch (err) {
    console.error("similar error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

app.post("/api/ai-search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || query.trim().length < 2) return res.status(400).json({ error: "Query too short" });
    const analysis = analyzeQuery(query);
    
    let sql = `SELECT id, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, store, source_url, description, pattern, fabric, design_details, color_sizes, image_size_bytes FROM products WHERE (banned IS NULL OR banned = false) AND (hidden_stale IS NULL OR hidden_stale = false)`;
    const params = [];
    let i = 1;

    if (analysis.keywords.length > 0) { sql += ` AND title ILIKE $${i++}`; params.push(`%${analysis.keywords.join(' ')}%`); }
    if (analysis.store) { sql += ` AND store = $${i++}`; params.push(analysis.store); }
    
    if (analysis.color) { sql += ` AND (color = $${i} OR $${i} = ANY(colors))`; params.push(analysis.color); i++; }
    if (analysis.size) {
      const expandedSizes = expandSize(analysis.size);
      if (expandedSizes.length === 1) {
        sql += ` AND $${i} = ANY(sizes)`;
        params.push(expandedSizes[0]); i++;
      } else {
        sql += ` AND sizes && $${i}::text[]`;
        params.push(expandedSizes); i++;
      }
    }
    if (analysis.category || analysis.categories?.length) {
      const cats = analysis.categories?.length > 1 ? analysis.categories : (analysis.category ? [analysis.category] : []);
      if (cats.length === 1) {
        sql += ` AND (category = $${i} OR title ILIKE $${i+1})`; params.push(cats[0], `%${cats[0]}%`); i += 2;
      } else if (cats.length > 1) {
        sql += ` AND (category = ANY($${i}::text[]) OR ${cats.map((_,j) => `title ILIKE $${i+1+j}`).join(' OR ')})`; 
        params.push(cats); cats.forEach(c => params.push(`%${c}%`)); i += 1 + cats.length;
      }
    }
    if (analysis.style) {
      if (analysis.style === 'יום חול') {
        sql += ` AND (style = $${i} OR style = 'יומיומי' OR title ILIKE '%יום חול%' OR title ILIKE '%יומיומי%' OR title ILIKE '%יום יום%' OR description ILIKE '%יום חול%' OR description ILIKE '%יומיומי%')`;
        params.push(analysis.style); i++;
      } else if (analysis.style === 'שבת/ערב') {
        sql += ` AND (style IN ('ערב','חגיגי','אלגנטי','שבת') OR title ILIKE '%שבת%' OR title ILIKE '%ערב%' OR title ILIKE '%חגיג%' OR title ILIKE '%אלגנט%')`;
      } else {
        sql += ` AND (style = $${i} OR title ILIKE $${i+1})`; params.push(analysis.style, `%${analysis.style}%`); i += 2;
      }
    }
    if (analysis.fit || analysis.fits?.length) {
      const fits = analysis.fits?.length > 1 ? analysis.fits : (analysis.fit ? [analysis.fit] : []);
      if (fits.length === 1) {
        sql += ` AND (fit = $${i} OR title ILIKE $${i+1})`; params.push(fits[0], `%${fits[0]}%`); i += 2;
      } else if (fits.length > 1) {
        sql += ` AND (fit = ANY($${i}::text[]) OR ${fits.map((_,j) => `title ILIKE $${i+1+j}`).join(' OR ')})`;
        params.push(fits); fits.forEach(f => params.push(`%${f}%`)); i += 1 + fits.length;
      }
    }
    if (analysis.fabric) { sql += ` AND (fabric = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(analysis.fabric, `%${analysis.fabric}%`); i += 2; }
    if (analysis.pattern) { sql += ` AND (pattern = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(analysis.pattern, `%${analysis.pattern}%`); i += 2; }
    if (analysis.designDetails.length > 0) { sql += ` AND $${i++} = ANY(design_details)`; params.push(analysis.designDetails[0]); }
    if (analysis.maxPrice) { sql += ` AND price <= $${i++}`; params.push(analysis.maxPrice); }
    if (analysis.minDiscount) { sql += ` AND original_price > 0 AND ((original_price - price) / original_price * 100) >= $${i++}`; params.push(analysis.minDiscount); }

    // מיון: ווריאנט מדויק בכותרת קודם
    const originalQuery = query.trim();
    const hasAlias = SEARCH_ALIASES[originalQuery.toLowerCase()];
    if (hasAlias) {
      sql += ` ORDER BY (CASE WHEN title ILIKE $${i} THEN 0 ELSE 1 END), id DESC LIMIT 5000`;
      params.push(`%${originalQuery}%`); i++;
    } else {
      sql += ` ORDER BY id DESC LIMIT 5000`;
    }
    const result = await pool.query(sql, params);
    let rows = result.rows;
    
    // סינון color+size ב-JS
    if (analysis.color && analysis.size) {
      const expandedSizes = expandSize(analysis.size);
      rows = rows.filter(p => {
        if (!p.color_sizes) return true;
        try {
          const cs = typeof p.color_sizes === 'string' ? JSON.parse(p.color_sizes) : p.color_sizes;
          if (!cs || Object.keys(cs).length === 0) return true;
          const colorSizes = cs[analysis.color];
          if (!colorSizes) return false;
          return expandedSizes.some(sz => colorSizes.includes(sz));
        } catch(e) { return true; }
      });
    }
    
    res.json({ query, analysis, results: rows.map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) })), count: rows.length });
  } catch (err) {
    console.error("ai-search error:", err.message);
    res.status(500).json({ error: "Search error" });
  }
});

// ── חיפוש לפי תמונה ──────────────────────────────────────────
app.post("/api/search-by-image", authMiddleware, async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64 || !mimeType) return res.status(400).json({ error: "חסרה תמונה" });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY לא מוגדר" });

    // רישום/הגבלת שימוש שבועי — אותו דפוס בדיוק כמו הסטייליסטית AI
    await pool.query(`CREATE TABLE IF NOT EXISTS image_search_usage (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      used_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_image_search_usage_user_date ON image_search_usage(user_id, used_at)`);
    const IMAGE_SEARCH_WEEKLY_LIMIT = 3;
    const imgUsageRes = await pool.query(
      `SELECT COUNT(*) AS c FROM image_search_usage WHERE user_id=$1 AND used_at > NOW() - INTERVAL '7 days'`,
      [req.userId]
    );
    const imgUsedCount = parseInt(imgUsageRes.rows[0].c);
    if (imgUsedCount >= IMAGE_SEARCH_WEEKLY_LIMIT) {
      return res.status(429).json({
        error: `הגעת למגבלת השימוש השבועית בחיפוש לפי תמונה (${IMAGE_SEARCH_WEEKLY_LIMIT} פעמים). אפשר לנסות שוב בעוד כמה ימים.`,
        limitReached: true,
      });
    }

    // רשימות ערכים סגורות — זהות בדיוק לתגיות הקיימות במאגר (admin_tagger.html),
    // כדי שהתשובה של Claude תתאים ישירות ל-fits/design_details/fabric/pattern/color בפועל
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: `נתחי בדיוק את פריט הלבוש בתמונה כמו מתייגת מקצועית של קטלוג אופנה. החזירי אך ורק JSON תקין (בלי טקסט נוסף):
{
  "category": "בחרי ערך אחד בדיוק מתוך: שמלה, חולצה, חצאית, מכנסיים, קרדיגן, ז'קט, בלייזר, וסט, עליונית, מעיל, סט, טוניקה, סרפן, חלוק, סוודר — או null אם לא ברור",
  "color": "בחרי ערך אחד בדיוק מתוך: שחור, לבן, שמנת, כחול, תכלת, אדום, בורדו, ירוק, זית, חאקי, חום, קאמל, בז', ניוד, אפור, ורוד, סגול, לילך, צהוב, חרדל, כתום, זהב, כסף, פרחוני, צבעוני, מנטה, אפרסק, אבן — הצבע הדומיננטי בלבד, או null",
  "fits": "מערך של 1-3 ערכים בדיוק מתוך: ארוכה, מידי, קצרה, מותן, מתרחבת, ישרה, מחויטת, מעטפת, צמודה, רפויה, הריון, הנקה. חשוב מאוד לגבי אורך — תבדקי בקפידה איפה מסתיים הפריט ביחס לברך הנראית בתמונה: אם הוא מסתיים בגובה הברך או מעליה → קצרה. אם מגיע עד אמצע השוק → מידי. אם מגיע עד הקרסול/הרצפה → ארוכה. אל תניחי שפריט הוא ארוך רק כי הוא נראה אלגנטי — התבססי רק על מה שנראה בפועל בתמונה. בנוסף לאורך, ציינו גם את הגזרה (ישרה/מתרחבת/מחויטת/מעטפת/צמודה/רפויה) אם ברורה",
  "fabric": "בחרי ערך אחד בדיוק מתוך: ז'רסי, סריג, שיפון, כותנה, סאטן, תחרה, קטיפה, אריג, פשתן, משי, צמר, עור, פרווה, לייקרה, טריקו, רשת — לפי המרקם הנראה בתמונה, או null אם לא ברור",
  "pattern": "בחרי ערך אחד בדיוק מתוך: פסים, פרחוני, משבצות, נקודות, חלק, הדפס, אבסטרקטי, גיאומטרי — או null",
  "designDetails": "מערך של 0-3 ערכים בדיוק מתוך: צווארון V, צווארון עגול, צווארון גבוה, גולף, צווארון סירה, כפתורים, רוכסן, שרוול ארוך, שרוול קצר, שרוול 3/4, ללא שרוולים, שרוול פעמון, שרוול נפוח, חגורה, קשירה, כיסים, תחרה, פפלום, מלמלה, קפלים, שסע",
  "style": "בחרי ערך אחד בדיוק מתוך: ערב, שבת, חגיגי, יום חול, קלאסי, מינימליסטי, מודרני, רטרו, אוברסייז — או null"
}
חשוב: כל שדה שמופיע ברשימה סגורה חייב להכיל ערך מתוך הרשימה בדיוק (או null/מערך ריק) — אסור להמציא ערכים חדשים.` }
        ]}]
      })
    });
    if (!claudeRes.ok) return res.status(502).json({ error: "שגיאה בניתוח תמונה" });
    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text || "{}";
    let analysis;
    try { analysis = JSON.parse(text.replace(/```json|```/g, "").trim()); }
    catch { analysis = { category: null, color: null, fits: [], fabric: null, pattern: null, designDetails: [], style: null }; }
    analysis.fits = Array.isArray(analysis.fits) ? analysis.fits : [];
    analysis.designDetails = Array.isArray(analysis.designDetails) ? analysis.designDetails : [];

    // חיפוש מבוסס-ניקוד (כמו בסטייליסטית AI) — מסתמך אך ורק על הנתונים המובנים
    // (קטגוריה/גזרה/צבע/בד/דוגמה/פרטי עיצוב) בלי חיפוש טקסט חופשי על הכותרת,
    // כדי שלא יוחזרו מוצרים רק בגלל התאמת מילה בכותרת בלי שאר הנתונים תואמים
    const scoreExpr = `(
        (CASE WHEN $1::text IS NOT NULL AND category = $1::text THEN 3 ELSE 0 END) +
        (CASE WHEN $2::text[] = '{}' THEN 0 WHEN fits && $2::text[] THEN 2 ELSE 0 END) +
        (CASE WHEN $3::text IS NOT NULL AND (color = $3::text OR $3::text = ANY(colors)) THEN 2 ELSE 0 END) +
        (CASE WHEN $4::text IS NOT NULL AND fabric = $4::text THEN 1 ELSE 0 END) +
        (CASE WHEN $5::text IS NOT NULL AND pattern = $5::text THEN 1 ELSE 0 END) +
        (CASE WHEN $6::text[] = '{}' THEN 0 WHEN design_details && $6::text[] THEN 1 ELSE 0 END)
      )`;
    const params = [
      analysis.category || null,
      analysis.fits,
      analysis.color || null,
      analysis.fabric || null,
      analysis.pattern || null,
      analysis.designDetails,
    ];
    const sql = `SELECT id,title,price,original_price,image_url,images,sizes,color,colors,style,fit,fits,category,store,source_url,description,pattern,fabric,design_details,color_sizes,image_size_bytes,
      ${scoreExpr} AS match_score
      FROM products
      WHERE (banned IS NULL OR banned = false) AND (hidden_stale IS NULL OR hidden_stale = false) AND array_length(sizes,1)>0
      AND ${scoreExpr} > 0
      ORDER BY match_score DESC, RANDOM() LIMIT 60`;
    const result = await pool.query(sql, params);
    let rows = result.rows;

    // רשת ביטחון: אם יש פחות מ-4 תוצאות (למשל תמונה עם שילוב נדיר של תגיות),
    // משלימים עם המוצרים הכי קרובים לפי אותו ניקוד — גם אם הניקוד שלהם נמוך יותר —
    // כדי שתמיד יוצג מינימום של הצעות סבירות במקום מסך ריק.
    const MIN_RESULTS = 4;
    if (rows.length < MIN_RESULTS) {
      const existingIds = new Set(rows.map(r => r.id));
      const fallbackSql = `SELECT id,title,price,original_price,image_url,images,sizes,color,colors,style,fit,fits,category,store,source_url,description,pattern,fabric,design_details,color_sizes,image_size_bytes,
        ${scoreExpr} AS match_score
        FROM products
        WHERE (banned IS NULL OR banned = false) AND (hidden_stale IS NULL OR hidden_stale = false) AND array_length(sizes,1)>0
        ORDER BY match_score DESC, RANDOM() LIMIT $7`;
      const fallbackResult = await pool.query(fallbackSql, [...params, MIN_RESULTS]);
      for (const r of fallbackResult.rows) {
        if (rows.length >= MIN_RESULTS) break;
        if (!existingIds.has(r.id)) { rows.push(r); existingIds.add(r.id); }
      }
    }

    // רושמים שימוש רק אחרי חיפוש מוצלח
    await pool.query(`INSERT INTO image_search_usage (user_id) VALUES ($1)`, [req.userId]);

    const rowsWithShipping = rows.map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) }));
    res.json({
      analysis,
      results: rowsWithShipping,
      count: rowsWithShipping.length,
      usageRemaining: IMAGE_SEARCH_WEEKLY_LIMIT - imgUsedCount - 1,
    });
  } catch (err) {
    console.error("search-by-image error:", err.message);
    res.status(500).json({ error: "שגיאה בחיפוש" });
  }
});

// ── AI סטייליסטית — המלצות סטייל אישיות לפי תמונת גוף ──────────────
// דורש התחברות (authMiddleware) + מוגבל ל-2 שימושים בשבוע למשתמשת
// גוונים בהירים/כהים — לניקוד התאמת הצעת הצבעים (colorGuidance) מול הצבע האמיתי של המוצרים
const LIGHT_COLORS = ['לבן', 'שמנת', "בז'", 'ניוד', 'תכלת', 'לילך', 'אפרסק', 'אבן', 'זהב', 'כסף', 'צהוב'];
const DARK_COLORS = ['שחור', 'בורדו', 'חום', 'זית', 'חאקי', 'סגול', 'כחול', 'אפור'];

app.post("/api/ai-stylist", authMiddleware, async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64 || !mimeType) return res.status(400).json({ error: "חסרה תמונה" });
    const userRequest = (req.body.userRequest || "").toString().trim().slice(0, 300);

    // טבלת מעקב שימוש — נוצרת אוטומטית אם לא קיימת, לא פוגעת בשום דבר קיים
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_stylist_usage (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      used_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_stylist_usage_user_date ON ai_stylist_usage(user_id, used_at)`);

    const WEEKLY_LIMIT = 2;
    const usageRes = await pool.query(
      `SELECT COUNT(*) AS c FROM ai_stylist_usage WHERE user_id=$1 AND used_at > NOW() - INTERVAL '7 days'`,
      [req.userId]
    );
    const usedCount = parseInt(usageRes.rows[0].c);
    if (usedCount >= WEEKLY_LIMIT) {
      return res.status(429).json({
        error: `הגעת למגבלת השימוש השבועית (${WEEKLY_LIMIT} פעמים). אפשר לנסות שוב בעוד כמה ימים.`,
        limitReached: true,
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY לא מוגדר" });

    const requestContext = userRequest
      ? `הלקוחה כתבה בקשה ספציפית: "${userRequest}". התאימי את ההמלצות בדיוק לבקשה הזו — כללי ב-"focusCategories" ובתוך "recommendations" רק את סוגי הפריטים שרלוונטיים לבקשה (לדוגמה: אם ביקשה המלצה לחצאית וחולצה, אל תכללי שמלות בכלל). אם צויין אירוע או הקשר (כמו שבת, יום חול, ערב, חגיגה) שקפי אותו בשדה "style" בכל קטגוריה רלוונטית.`
      : `הלקוחה לא ציינה בקשה ספציפית — תני המלצה כללית שכוללת שלושה סוגי פריטים: שמלות, חצאיות וחולצות.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 900,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: `את סטייליסטית אופנה מקצועית עם שנות ניסיון, עדינה ומכבדת. נתחי את מבנה הגוף בתמונה כמו סטייליסטית אמיתית בפגישת ייעוץ קצרה וממוקדת: התייחסי לפרופורציות (יחס בין פלג גוף עליון לתחתון, רוחב כתפיים ביחס לירכיים, גובה קו המותן), לא רק לקטגוריה כללית.
עיקרון מקצועי חשוב שחייב להשפיע על ההמלצות שלך: לנשים רבות חשוב מאוד איך הבגד משפיע על המראה מבחינת רזון/עובי נתפס. השתמשי בידע אמיתי מעולם הסטיילינג כדי לבחור גזרות, דוגמאות וגוונים שמחמיאים ומרזים ולא משמינים, בהתאם למבנה הגוף הספציפי בתמונה. לדוגמה (לא רשימה סגורה - השתמשי בשיקול דעת מקצועי): קווים אנכיים וגזרות מחויטות בדרך כלל מרזים, בעוד פסים רוחביים או שכבות עודפות על שטח גוף רחב עלולים להשמין ולהבליט; ניגודיות חזקה בקו המותן מדגישה גזרה; דוגמאות גדולות ובולטות על אזור רחב מגדילות אותו ויזואלית. שקלי את זה בבחירת "fits", ב"lessRecommended" וב"colorGuidance".
${requestContext}
החזירי אך ורק JSON תקין (בלי טקסט נוסף לפני/אחרי):
{
  "bodyShape": "אחת: שעון חול / אגס / משולש הפוך / תפוח / מלבן",
  "waistHeight": "אחת: מותן גבוה / מותן מוגדר / מותן נמוך",
  "explanation": "1-2 משפטים קצרים בלבד, חיוביים ומעודדים בעברית, שמסבירים בתמצות את ההיגיון הכללי מאחורי ההמלצות",
  "focusCategories": ["מערך שמכיל רק את סוגי הפריטים הרלוונטיים מתוך: dresses, skirts, tops — בהתאם להקשר למעלה"],
  "recommendations": {
    "dresses": {"fits": ["1-2 גזרות מתוך: מעטפת, ישרה, מתרחבת, מחויטת, רפויה"], "style": "ערך אחד מתוך: ערב, שבת, חגיגי, יום חול, קלאסי, מינימליסטי, מודרני, רטרו, אוברסייז — או null אם לא רלוונטי", "note": "משפט קצר אחד למה זה מחמיא"},
    "skirts": {"fits": ["1-2 גזרות מתוך: מעטפת, ישרה, מתרחבת, מחויטת"], "style": "כנ״ל או null", "note": "משפט קצר אחד"},
    "tops": {"fits": ["1-2 גזרות מתוך: רפויה, צמודה, מחויטת"], "style": "כנ״ל, כולל אפשרות אוברסייז, או null", "note": "משפט קצר אחד"}
  },
  "lessRecommended": "משפט קצר אחד (עם הסבר תמציתי למה) על גזרה, הדפס או שימוש בצבע שכדאי פחות למבנה הגוף הזה. אם רלוונטי, שלבי כאן בשפה טבעית וזורמת (לא כמונח טכני) את התובנה הבאה: גוונים בהירים מאוד על שטח גדול ואחיד עלולים לשנות את תפיסת הפרופורציות, ועדיף לשלב אותם כהדגשה נקודתית ולא כבסיס לכל התלבושת",
  "colorGuidance": {
    "text": "משפט אחד מעשי וקונקרטי בעברית שנותן הצעת שילוב צבעים ברורה (לדוגמה: חצאית בהירה וחולצה כהה, או ההפך) - לא רשימת צבעים כללית אלא הנחיה מעשית",
    "topTone": "אחת בדיוק: בהיר / כהה / ניטרלי",
    "bottomTone": "אחת בדיוק: בהיר / כהה / ניטרלי",
    "pairsWith": "משפט קצר ואופציונלי - עם אילו אביזרים/גוונים נוספים השילוב הזה מתחבר יפה (או null אם אין המלצה מיוחדת)"
  }
}
חשוב מאוד:
- כללי בתוך "recommendations" רק את המפתחות שמופיעים ב-"focusCategories" — אל תכללי קטגוריות שלא רלוונטיות.
- היי עדינה, מקצועית ומעודדת. בלי אימוג'ים, בלי סלנג, בלי ביטויים לא מכבדים.
- כל ההמלצות חייבות להיות בגדים צנועים בלבד: אורך ברכיים ומטה, שרוולים מכסים לפחות עד המרפק, בלי חשיפת כתפיים או מחשוף עמוק.
- שדות "fits" ו-"style" חייבים להכיל אך ורק ערכים מתוך הרשימות הסגורות שניתנו - אסור להמציא ערכים אחרים.` }
        ]}]
      })
    });
    if (!claudeRes.ok) return res.status(502).json({ error: "שגיאה בניתוח התמונה" });
    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text || "{}";
    let analysis;
    try { analysis = JSON.parse(text.replace(/```json|```/g, "").trim()); }
    catch { return res.status(502).json({ error: "שגיאה בעיבוד התשובה, נסי שוב" }); }

    // רושמים שימוש רק אחרי ניתוח מוצלח (לא רוצים לספור כשלים)
    await pool.query(`INSERT INTO ai_stylist_usage (user_id) VALUES ($1)`, [req.userId]);

    const rec = analysis.recommendations || {};
    const colorGuidance = analysis.colorGuidance || {};
    let focusCategories = Array.isArray(analysis.focusCategories) && analysis.focusCategories.length
      ? analysis.focusCategories
      : ['dresses', 'skirts', 'tops'];

    // סינון צניעות קשיח — לא תלוי בניקוד, חל תמיד: בלי סטרפלס/חשוף כתפיים/שרוולים קצרים/אורך קצר
    const MODESTY_EXCLUDE = ['סטרפלס', 'חשוף כתפיים', 'ללא שרוולים', 'שרוול קצר'];
    const modestyWhere = `(banned IS NULL OR banned = false) AND (hidden_stale IS NULL OR hidden_stale = false) AND array_length(sizes,1)>0
      AND NOT (design_details && $2::text[])
      AND NOT ('קצרה' = ANY(fits))`;

    // שאילתות מקבילות — רק לסוגי הפריטים הרלוונטיים (focusCategories), כדי שתוצג בדיוק ההמלצה שביקשה הלקוחה
    // ולא תמיד שלושת הסוגים. הניקוד כולל גזרה + סגנון + טון צבע (בהיר/כהה) בהתאם ל-colorGuidance.
    async function fetchCategoryMatches(dbCategory, fitsList, styleValue, toneWord) {
      const toneColors = toneWord === 'בהיר' ? LIGHT_COLORS : toneWord === 'כהה' ? DARK_COLORS : [];
      const sql = `SELECT id,title,price,original_price,image_url,images,sizes,color,colors,style,fit,fits,category,store,source_url,description,pattern,fabric,design_details,color_sizes,image_size_bytes,
        (
          (CASE WHEN $3::text[] = '{}' THEN 0 WHEN fits && $3::text[] THEN 2 ELSE 0 END) +
          (CASE WHEN $4::text IS NOT NULL AND style = $4::text THEN 1 ELSE 0 END) +
          (CASE WHEN $5::text[] = '{}' THEN 0 WHEN color = ANY($5::text[]) THEN 2 ELSE 0 END)
        ) AS match_score
        FROM products
        WHERE category = $1 AND ${modestyWhere}
        ORDER BY match_score DESC, RANDOM() LIMIT 10`;
      const { rows } = await pool.query(sql, [dbCategory, MODESTY_EXCLUDE, fitsList || [], styleValue || null, toneColors]);
      return rows;
    }

    const categoryDbMap = { dresses: 'שמלה', skirts: 'חצאית', tops: 'חולצה' };
    const categoryToneMap = { dresses: null, skirts: colorGuidance.bottomTone, tops: colorGuidance.topTone };
    const activeCats = focusCategories.filter(k => categoryDbMap[k]);
    const fetched = await Promise.all(activeCats.map(k =>
      fetchCategoryMatches(categoryDbMap[k], rec[k]?.fits, rec[k]?.style, categoryToneMap[k])
    ));
    const rows = fetched.flat().map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) }));

    // 3 ההצעות עם הניקוד הכי גבוה מכל הקטגוריות המשולבות — מוצגות בבירור בסוף התוצאה
    const topPicks = [...rows].sort((a, b) => (b.match_score || 0) - (a.match_score || 0)).slice(0, 4);

    // שמירת תוצאת הניתוח בחשבון הלקוחה — בלי התמונה עצמה, רק הטקסט/JSON וסנאפשוט קליל
    // של 3 ההצעות (לתצוגה מהירה בפרופיל בלי צורך בשליפה נוספת)
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_stylist_saved_results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      analysis JSONB NOT NULL,
      top_picks JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_stylist_saved_user_date ON ai_stylist_saved_results(user_id, created_at DESC)`);
    const topPicksSnapshot = topPicks.map(p => ({ id: p.id, title: p.title, price: p.price, image_url: p.image_url || (p.images && p.images[0]) || null }));
    await pool.query(
      `INSERT INTO ai_stylist_saved_results (user_id, analysis, top_picks) VALUES ($1, $2, $3)`,
      [req.userId, JSON.stringify(analysis), JSON.stringify(topPicksSnapshot)]
    );

    res.json({
      analysis,
      results: rows,
      topPicks,
      count: rows.length,
      usageRemaining: WEEKLY_LIMIT - usedCount - 1,
    });
  } catch (err) {
    console.error("ai-stylist error:", err.message);
    res.status(500).json({ error: "שגיאה בניתוח, נסי שוב" });
  }
});

// שליפת ההמלצה האחרונה שנשמרה ללקוחה — לתצוגה במסך "הפרופיל שלי" (בלי תמונה, רק הניתוח השמור)
app.get("/api/ai-stylist/last", authMiddleware, async (req, res) => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_stylist_saved_results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      analysis JSONB NOT NULL,
      top_picks JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    const result = await pool.query(
      `SELECT analysis, top_picks, created_at FROM ai_stylist_saved_results WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [req.userId]
    );
    if (!result.rows.length) return res.json({ found: false });
    const row = result.rows[0];
    res.json({ found: true, analysis: row.analysis, topPicks: row.top_picks, createdAt: row.created_at });
  } catch (err) {
    console.error("ai-stylist/last error:", err.message);
    res.status(500).json({ error: "שגיאה בשליפת ההמלצה" });
  }
});

function analyzeQuery(query) {
  const analysis = { keywords: [], color: null, size: null, style: null, fit: null, fits: [], category: null, categories: [], maxPrice: null, minDiscount: null, pattern: null, fabric: null, designDetails: [], store: null };
  
  const priceMatch = query.match(/\u05e2\u05d3\s*\u20aa?\s*(\d+)|(\d+)\s*\u20aa|(\d+)\s*\u05e9"?\u05d7/i);
  if (priceMatch) analysis.maxPrice = parseInt(priceMatch[1] || priceMatch[2] || priceMatch[3]);
  
  // הנחה — רק עם % מפורש, או מילת הנחה/מבצע/סייל
  // לא מספר סתם (למניעת בלבול עם מידה 40, 42 וכו')
  const discountMatch = query.match(/(\d+)\s*(?:%|אחוז)/i);
  if (discountMatch) {
    const val = parseInt(discountMatch[1]);
    analysis.minDiscount = val >= 50 ? 60 : val >= 30 ? 40 : 20;
  } else if (/הנחה|מבצע|סייל|sale|בהנחה|במבצע|בסייל|מהנחה|מסייל/i.test(query)) {
    analysis.minDiscount = 20;
  }

  // חנויות
  const storeMap = {
    'MEKIMI': ['mekimi', '\u05de\u05e7\u05d9\u05de\u05d9'],
    'LICHI': ['lichi', '\u05dc\u05d9\u05e6\u05f3\u05d9', '\u05dc\u05d9\u05e6\u05d9'],
    'MIMA': ['mima', '\u05de\u05d9\u05de\u05d4', '\u05de\u05d9\u05de\u05d0'],
    'CHEN': ['chen', '\u05d7\u05df'],
    'AVIYAH': ['aviyah', '\u05d0\u05d1\u05d9\u05d4', '\u05d0\u05d1\u05d9\u05d4 \u05d9\u05d5\u05e1\u05e3'],
    'CHEMISE': ['chemise', '\u05e9\u05de\u05d9\u05d6'],
    'AVIVIT': ['avivit', '\u05d0\u05d1\u05d9\u05d1\u05d9\u05ea'],
    'RARE': ['rare', '\u05e8\u05d9\u05d9\u05e8'],
    'ORDMAN': ['ordman', '\u05d0\u05d5\u05e8\u05d3\u05de\u05df']
  };

  // מיפוי מידות עברית -> אנגלית
  const hebrewSizeMap = {
    'XS': ['\u05d0\u05e7\u05e1\u05d8\u05e8\u05d4 \u05e1\u05de\u05d5\u05dc', '\u05d0\u05e7\u05e1 \u05e1\u05de\u05d5\u05dc'],
    'S': ['\u05e1\u05de\u05d5\u05dc', '\u05e1\u05de\u05d0\u05dc', '\u05e7\u05d8\u05df', '\u05e7\u05d8\u05e0\u05d4'],
    'M': ['\u05de\u05d3\u05d9\u05d5\u05dd', '\u05de\u05d9\u05d3\u05d9\u05d5\u05dd', '\u05d1\u05d9\u05e0\u05d5\u05e0\u05d9', '\u05d1\u05d9\u05e0\u05d5\u05e0\u05d9\u05ea'],
    'L': ['\u05dc\u05d0\u05e8\u05d2\u05f3', '\u05dc\u05d0\u05e8\u05d2', '\u05d2\u05d3\u05d5\u05dc', '\u05d2\u05d3\u05d5\u05dc\u05d4'],
    'XL': ['\u05d0\u05e7\u05e1 \u05dc\u05d0\u05e8\u05d2\u05f3', '\u05d0\u05e7\u05e1\u05d8\u05e8\u05d4 \u05dc\u05d0\u05e8\u05d2'],
    'XXL': ['\u05d3\u05d0\u05d1\u05dc \u05d0\u05e7\u05e1 \u05dc\u05d0\u05e8\u05d2']
  };

  // פרסור "מידהM" ללא רווח - regex שמוצא מידה+אות דבוקות
  let processedQuery = query;
  const sizeStuckPattern = /\u05de\u05d9\u05d3\u05d4\s*(XS|S|M|L|XL|XXL|XXXL|\d{2})/i;
  const sizeStuckMatch = processedQuery.match(sizeStuckPattern);
  if (sizeStuckMatch) {
    analysis.size = sizeStuckMatch[1].toUpperCase();
    processedQuery = processedQuery.replace(sizeStuckPattern, '').trim();
  }

  const colorMap = { 
    '\u05e9\u05d7\u05d5\u05e8': ['\u05e9\u05d7\u05d5\u05e8', '\u05e9\u05d7\u05d5\u05e8\u05d4'], 
    '\u05dc\u05d1\u05df': ['\u05dc\u05d1\u05df', '\u05dc\u05d1\u05e0\u05d4'], 
    '\u05db\u05d7\u05d5\u05dc': ['\u05db\u05d7\u05d5\u05dc', '\u05db\u05d7\u05d5\u05dc\u05d4', '\u05e0\u05d9\u05d9\u05d1\u05d9'], 
    '\u05d0\u05d3\u05d5\u05dd': ['\u05d0\u05d3\u05d5\u05dd', '\u05d0\u05d3\u05d5\u05de\u05d4'], 
    '\u05d9\u05e8\u05d5\u05e7': ['\u05d9\u05e8\u05d5\u05e7', '\u05d9\u05e8\u05d5\u05e7\u05d4', '\u05d6\u05d9\u05ea', '\u05d7\u05d0\u05e7\u05d9'], 
    '\u05d7\u05d5\u05dd': ['\u05d7\u05d5\u05dd', '\u05d7\u05d5\u05de\u05d4'], 
    '\u05d1\u05d6\u05f3': ['\u05d1\u05d6\u05f3', '\u05d1\u05d6', '\u05e0\u05d9\u05d5\u05d3'], 
    '\u05d0\u05e4\u05d5\u05e8': ['\u05d0\u05e4\u05d5\u05e8', '\u05d0\u05e4\u05d5\u05e8\u05d4'], 
    '\u05d5\u05e8\u05d5\u05d3': ['\u05d5\u05e8\u05d5\u05d3', '\u05d5\u05e8\u05d5\u05d3\u05d4'], 
    '\u05d1\u05d5\u05e8\u05d3\u05d5': ['\u05d1\u05d5\u05e8\u05d3\u05d5'], 
    '\u05e9\u05de\u05e0\u05ea': ['\u05e9\u05de\u05e0\u05ea', 'cream'], 
    '\u05e1\u05d2\u05d5\u05dc': ['\u05e1\u05d2\u05d5\u05dc', '\u05e1\u05d2\u05d5\u05dc\u05d4', '\u05dc\u05d9\u05dc\u05da'],
    '\u05e6\u05d4\u05d5\u05d1': ['\u05e6\u05d4\u05d5\u05d1', '\u05e6\u05d4\u05d5\u05d1\u05d4', '\u05d7\u05e8\u05d3\u05dc'],
    '\u05db\u05ea\u05d5\u05dd': ['\u05db\u05ea\u05d5\u05dd', '\u05db\u05ea\u05d5\u05de\u05d4'],
    '\u05ea\u05db\u05dc\u05ea': ['\u05ea\u05db\u05dc\u05ea'],
    '\u05d6\u05d4\u05d1': ['\u05d6\u05d4\u05d1', '\u05d6\u05d4\u05d5\u05d1\u05d4'],
    '\u05db\u05e1\u05e3': ['\u05db\u05e1\u05e3', '\u05db\u05e1\u05d5\u05e4\u05d4'],
    '\u05e7\u05d0\u05de\u05dc': ['\u05e7\u05d0\u05de\u05dc'],
    '\u05d0\u05d1\u05df': ['\u05d0\u05d1\u05df', 'stone']
  };
  const categoryMap = { 
    '\u05e9\u05de\u05dc\u05d4': ['\u05e9\u05de\u05dc\u05d4', '\u05e9\u05de\u05dc\u05ea', '\u05e9\u05de\u05dc\u05d5\u05ea'], 
    '\u05d7\u05d5\u05dc\u05e6\u05d4': ['\u05d7\u05d5\u05dc\u05e6\u05d4', '\u05d7\u05d5\u05dc\u05e6\u05ea', '\u05d8\u05d5\u05e4'], 
    '\u05d7\u05e6\u05d0\u05d9\u05ea': ['\u05d7\u05e6\u05d0\u05d9\u05ea', '\u05d7\u05e6\u05d0\u05d9\u05d5\u05ea'], 
    '\u05de\u05db\u05e0\u05e1\u05d9\u05d9\u05dd': ['\u05de\u05db\u05e0\u05e1', '\u05de\u05db\u05e0\u05e1\u05d9\u05d9\u05dd'], 
    '\u05e7\u05e8\u05d3\u05d9\u05d2\u05df': ['\u05e7\u05e8\u05d3\u05d9\u05d2\u05df'],
    '\u05e1\u05d5\u05d5\u05d3\u05e8': ['\u05e1\u05d5\u05d5\u05d3\u05e8'],
    '\u05d8\u05d5\u05e0\u05d9\u05e7\u05d4': ['\u05d8\u05d5\u05e0\u05d9\u05e7\u05d4'],
    '\u05e1\u05e8\u05e4\u05df': ['\u05e1\u05e8\u05e4\u05df'],
    '\u05d6\u05f3\u05e7\u05d8': ['\u05d6\u05f3\u05e7\u05d8', '\u05d2\u05f3\u05e7\u05d8'],
    '\u05d1\u05dc\u05d9\u05d9\u05d6\u05e8': ['\u05d1\u05dc\u05d9\u05d9\u05d6\u05e8'],
    '\u05d5\u05e1\u05d8': ['\u05d5\u05e1\u05d8'],
    '\u05e2\u05dc\u05d9\u05d5\u05e0\u05d9\u05ea': ['\u05e2\u05dc\u05d9\u05d5\u05e0\u05d9\u05ea'],
    '\u05de\u05e2\u05d9\u05dc': ['\u05de\u05e2\u05d9\u05dc'],
    '\u05e1\u05d8': ['\u05e1\u05d8'],
    '\u05d1\u05d9\u05d9\u05e1\u05d9\u05e7': ['\u05d1\u05d9\u05d9\u05e1\u05d9\u05e7', 'basic'],
    '\u05e9\u05db\u05de\u05d9\u05d4': ['\u05e9\u05db\u05de\u05d9\u05d4'],
    '\u05d7\u05dc\u05d5\u05e7': ['\u05d7\u05dc\u05d5\u05e7', '\u05d0\u05d9\u05e8\u05d5\u05d7']
  };
  const styleMap = {
    '\u05e2\u05e8\u05d1': ['\u05e2\u05e8\u05d1', '\u05e9\u05d1\u05ea', '\u05e9\u05d1\u05ea\u05d9'],
    '\u05d7\u05d2\u05d9\u05d2\u05d9': ['\u05d7\u05d2\u05d9\u05d2\u05d9', '\u05d7\u05d2\u05d9\u05d2\u05d9\u05ea'],
    '\u05d0\u05dc\u05d2\u05e0\u05d8\u05d9': ['\u05d0\u05dc\u05d2\u05e0\u05d8', '\u05d0\u05dc\u05d2\u05e0\u05d8\u05d9', '\u05d0\u05dc\u05d2\u05e0\u05d8\u05d9\u05ea'],
    '\u05e7\u05dc\u05d0\u05e1\u05d9': ['\u05e7\u05dc\u05d0\u05e1\u05d9', '\u05e7\u05dc\u05d0\u05e1\u05d9\u05ea'],
    '\u05de\u05d9\u05e0\u05d9\u05de\u05dc\u05d9\u05e1\u05d8\u05d9': ['\u05de\u05d9\u05e0\u05d9\u05de\u05dc\u05d9\u05e1\u05d8', '\u05de\u05d9\u05e0\u05d9\u05de\u05dc\u05d9\u05e1\u05d8\u05d9'],
    '\u05de\u05d5\u05d3\u05e8\u05e0\u05d9': ['\u05de\u05d5\u05d3\u05e8\u05e0\u05d9', '\u05de\u05d5\u05d3\u05e8\u05e0\u05d9\u05ea'],
    '\u05d9\u05d5\u05dd \u05d7\u05d5\u05dc': ['\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9', '\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9\u05ea', '\u05e7\u05d6\u05f3\u05d5\u05d0\u05dc', '\u05e7\u05d6\u05d5\u05d0\u05dc'],
    '\u05e8\u05d8\u05e8\u05d5': ['\u05e8\u05d8\u05e8\u05d5', '\u05d5\u05d9\u05e0\u05d8\u05d2\u05f3'],
    '\u05d0\u05d5\u05d1\u05e8\u05e1\u05d9\u05d9\u05d6': ['\u05d0\u05d5\u05d1\u05e8\u05e1\u05d9\u05d9\u05d6', 'oversize']
  };
  const fitMap = {
    '\u05d0\u05e8\u05d5\u05db\u05d4': ['\u05de\u05e7\u05e1\u05d9', '\u05d0\u05e8\u05d5\u05db\u05d4', '\u05d0\u05e8\u05d5\u05da', 'maxi'],
    '\u05de\u05d9\u05d3\u05d9': ['\u05de\u05d9\u05d3\u05d9', 'midi', '\u05d0\u05de\u05e6\u05e2'],
    '\u05e7\u05e6\u05e8\u05d4': ['\u05e7\u05e6\u05e8\u05d4', '\u05e7\u05e6\u05e8', '\u05de\u05d9\u05e0\u05d9', 'mini'],
    '\u05de\u05e2\u05d8\u05e4\u05ea': ['\u05de\u05e2\u05d8\u05e4\u05ea', '\u05de\u05e2\u05d8\u05e4\u05d4', 'wrap'],
    '\u05d4\u05e8\u05d9\u05d5\u05df': ['\u05d4\u05e8\u05d9\u05d5\u05df', 'maternity', 'pregnancy'],
    '\u05d4\u05e0\u05e7\u05d4': ['\u05d4\u05e0\u05e7\u05d4', 'nursing', 'breastfeed'],
    '\u05de\u05d5\u05ea\u05df': ['\u05de\u05d5\u05ea\u05df', '\u05d1\u05de\u05d5\u05ea\u05df', 'waist']
  };
  // בד
  const fabricMap = {
    '\u05e1\u05e8\u05d9\u05d2': ['\u05e1\u05e8\u05d9\u05d2'],
    '\u05d0\u05e8\u05d9\u05d2': ['\u05d0\u05e8\u05d9\u05d2'],
    '\u05d2\u05f3\u05e8\u05e1\u05d9': ['\u05d2\u05f3\u05e8\u05e1\u05d9', '\u05d2\u05e8\u05e1\u05d9', '\u05d2\'\u05e8\u05e1\u05d9', 'jersey'],
    '\u05e9\u05d9\u05e4\u05d5\u05df': ['\u05e9\u05d9\u05e4\u05d5\u05df', 'chiffon'],
    '\u05e7\u05e8\u05e4': ['\u05e7\u05e8\u05e4', 'crepe'],
    '\u05e1\u05d0\u05d8\u05df': ['\u05e1\u05d0\u05d8\u05df', 'satin', '\u05e1\u05d8\u05df'],
    '\u05e7\u05d8\u05d9\u05e4\u05d4': ['\u05e7\u05d8\u05d9\u05e4\u05d4', 'velvet'],
    '\u05e4\u05dc\u05d9\u05d6': ['\u05e4\u05dc\u05d9\u05d6', 'fleece'],
    '\u05ea\u05d7\u05e8\u05d4': ['\u05ea\u05d7\u05e8\u05d4', 'lace'],
    '\u05d8\u05d5\u05dc': ['\u05d8\u05d5\u05dc', 'tulle'],
    '\u05dc\u05d9\u05d9\u05e7\u05e8\u05d4': ['\u05dc\u05d9\u05d9\u05e7\u05e8\u05d4', 'lycra'],
    '\u05d8\u05e8\u05d9\u05e7\u05d5': ['\u05d8\u05e8\u05d9\u05e7\u05d5', 'tricot'],
    '\u05e8\u05e9\u05ea': ['\u05e8\u05e9\u05ea'],
    '\u05d2\u05f3\u05d9\u05e0\u05e1': ['\u05d2\u05f3\u05d9\u05e0\u05e1', 'jeans', '\u05d3\u05e0\u05d9\u05dd'],
    '\u05e7\u05d5\u05e8\u05d3\u05e8\u05d5\u05d9': ['\u05e7\u05d5\u05e8\u05d3\u05e8\u05d5\u05d9', 'corduroy'],
    '\u05e4\u05d9\u05e7\u05d4': ['\u05e4\u05d9\u05e7\u05d4', 'pique'],
    'פרווה': ['פרווה', 'fur', 'faux fur'],
    '\u05db\u05d5\u05ea\u05e0\u05d4': ['\u05db\u05d5\u05ea\u05e0\u05d4', 'cotton'],
    '\u05e4\u05e9\u05ea\u05df': ['\u05e4\u05e9\u05ea\u05df', 'linen'],
    '\u05de\u05e9\u05d9': ['\u05de\u05e9\u05d9', 'silk'],
    '\u05e6\u05de\u05e8': ['\u05e6\u05de\u05e8', 'wool'],
    '\u05e8\u05d9\u05e7\u05de\u05d4': ['\u05e8\u05d9\u05e7\u05de\u05d4', '\u05e8\u05e7\u05d5\u05de\u05d4', '\u05e8\u05e7\u05d5\u05dd', '\u05e8\u05e7\u05de\u05d4', '\u05e8\u05e7\u05de\u05d0', 'embroidery', 'embroidered']
  };
  // דוגמא
  const patternMap = {
    '\u05e4\u05e1\u05d9\u05dd': ['\u05e4\u05e1\u05d9\u05dd', 'stripes'],
    '\u05e4\u05e8\u05d7\u05d5\u05e0\u05d9': ['\u05e4\u05e8\u05d7\u05d5\u05e0\u05d9', '\u05e4\u05e8\u05d7\u05d9\u05dd', 'floral'],
    '\u05de\u05e9\u05d1\u05e6\u05d5\u05ea': ['\u05de\u05e9\u05d1\u05e6\u05d5\u05ea', 'plaid'],
    '\u05e0\u05e7\u05d5\u05d3\u05d5\u05ea': ['\u05e0\u05e7\u05d5\u05d3\u05d5\u05ea', 'dots', 'polka'],
    '\u05d7\u05dc\u05e7': ['\u05d7\u05dc\u05e7', 'plain'],
    '\u05d4\u05d3\u05e4\u05e1': ['\u05d4\u05d3\u05e4\u05e1', 'print', '\u05de\u05d5\u05d3\u05e4\u05e1']
  };
  // עיצוב
  const designMap = {
    '\u05e6\u05d5\u05d5\u05d0\u05e8\u05d5\u05df V': ['\u05e6\u05d5\u05d5\u05d0\u05e8\u05d5\u05df V', 'v-neck'],
    '\u05d2\u05d5\u05dc\u05e3': ['\u05d2\u05d5\u05dc\u05e3', 'turtleneck'],
    '\u05db\u05e4\u05ea\u05d5\u05e8\u05d9\u05dd': ['\u05db\u05e4\u05ea\u05d5\u05e8\u05d9\u05dd', 'buttons'],
    '\u05d7\u05d2\u05d5\u05e8\u05d4': ['\u05d7\u05d2\u05d5\u05e8\u05d4', 'belt'],
    '\u05e9\u05e1\u05e2': ['\u05e9\u05e1\u05e2', 'slit'],
    '\u05db\u05d9\u05e1\u05d9\u05dd': ['\u05db\u05d9\u05e1\u05d9\u05dd', 'pockets'],
    '\u05e7\u05e9\u05d9\u05e8\u05d4': ['\u05e7\u05e9\u05d9\u05e8\u05d4', 'tie'],
    '\u05e7\u05e4\u05dc\u05d9\u05dd': ['\u05e7\u05e4\u05dc\u05d9\u05dd', 'pleats'],
    '\u05de\u05dc\u05de\u05dc\u05d4': ['\u05de\u05dc\u05de\u05dc\u05d4', 'ruffle'],
    '\u05e4\u05e4\u05dc\u05d5\u05dd': ['\u05e4\u05e4\u05dc\u05d5\u05dd', 'peplum']
  };
  const sizeList = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '36', '38', '40', '42', '44'];
  // מילות עצירה - מילים שמופיעות בחיפוש אבל לא צריכות להיות keywords
  const stopWords = new Set(['מידה', 'מידות', 'עד', 'של', 'עם', 'בלי', 'ללא', 'או', 'גם', 'רק', 'כל', 'את', 'זה', 'זו', 'הנחה', 'מבצע', 'sale', 'סייל', 'אחוז', 'בהנחה', 'במבצע', 'בסייל', 'מהנחה', 'מסייל', 'לי', 'אני', 'רוצה', 'מחפשת', 'מחפש', 'צבע', 'סגנון', 'גיזרה', 'בד', 'דוגמא', 'מחיר', 'שקל', 'שקלים', 'ש"ח', 'שח', 'אורך', 'באורך', 'חנות', 'באתר', 'מאתר', 'ב', 'מ']);
  // קטגוריות שלא מציגים (אקססוריז)
  const excludedCategories = new Set(['גומיות', 'גומייה', 'אקססוריז', 'אביזרים', 'תכשיטים', 'כובעים', 'צעיפים', 'תיקים']);


  // === שלב 1: בדיקת ביטויים רב-מילתיים BEFORE פירוק למילים ===
  const fullText = processedQuery.replace(/\u05e2\u05d3\s*\u20aa?\s*\d+/gi, '').replace(/\d+\s*\u20aa/gi, '').replace(/\d+\s*(?:%|\u05d0\u05d7\u05d5\u05d6)/gi, '').trim();
  const usedRanges = []; // track which char ranges were matched by phrases
  
  // Multi-word design details
  const multiWordDesign = {
    'שרוול ארוך': 'שרוול ארוך',
    'שרוול קצר': 'שרוול קצר',
    'שרוול 3/4': 'שרוול 3/4',
    'שרוול פעמון': 'שרוול פעמון',
    'שרוול נפוח': 'שרוול נפוח',
    'ללא שרוולים': 'ללא שרוולים',
    'כתפיים חשופות': 'כתפיים חשופות',
    'צווארון עגול': 'צווארון עגול',
    'צווארון V': 'צווארון V',
    'צווארון סירה': 'צווארון סירה'
  };
  
  for (const [phrase, designName] of Object.entries(multiWordDesign)) {
    if (fullText.includes(phrase)) {
      analysis.designDetails.push(designName);
      const idx = fullText.indexOf(phrase);
      usedRanges.push([idx, idx + phrase.length]);
    }
  }

  // Multi-word styles — ביטויים דו-מילתיים שלא יתפסו בפיצול למילה בודדת
  const multiWordStyle = {
    'יום חול': 'יום חול',
    'יום יום': 'יום חול',
    'שבת ערב': 'שבת/ערב',
    'שבת/ערב': 'שבת/ערב',
  };
  for (const [phrase, styleName] of Object.entries(multiWordStyle)) {
    if (fullText.includes(phrase) && !analysis.style) {
      analysis.style = styleName;
      const idx = fullText.indexOf(phrase);
      usedRanges.push([idx, idx + phrase.length]);
    }
  }

  // הסר אות יחס (ל/ב/מ/ש/כ) מהתחלת מילה עברית לפני חיפוש
  function stripPrefix(w) {
    if (/^[לבמשכ][\u05d0-\u05ea]/.test(w) && w.length > 2) return w.slice(1);
    return w;
  }

  const text = processedQuery.replace(/\u05e2\u05d3\s*\u20aa?\s*\d+/gi, '').replace(/\d+\s*\u20aa/gi, '').replace(/\d+\s*(?:%|\u05d0\u05d7\u05d5\u05d6)/gi, '').trim();
  const words = text.split(/\s+/).filter(w => w.length >= 1);

  for (const word of words) {
    const upper = word.toUpperCase();
    const lower = word.toLowerCase();
    
    // === קודם כל: דלג על מילים שנתפסו כחלק מביטוי רב-מילתי ===
    if (usedRanges.length > 0) {
      const wordIdx = fullText.indexOf(word);
      if (wordIdx >= 0 && usedRanges.some(([s,e]) => wordIdx >= s && wordIdx < e)) continue;
    }
    
    if (sizeList.includes(upper) && !analysis.size) { analysis.size = upper; continue; }
    
    // בדיקת מידות בעברית
    let sizeMatched = false;
    if (!analysis.size) {
      for (const [sizeName, variants] of Object.entries(hebrewSizeMap)) {
        if (variants.some(v => lower === v.toLowerCase())) { analysis.size = sizeName; sizeMatched = true; break; }
      }
    }
    if (sizeMatched) continue;
    
    let matched = false;
    const stripped = stripPrefix(lower); // "להריון" → "הריון"
    const wordVariants = lower === stripped ? [lower] : [lower, stripped];
    
    // בדוק SEARCH_ALIASES קודם — כולל ווריאנטים מה-DB
    if (!matched) {
      for (const wv of wordVariants) {
        if (SEARCH_ALIASES[wv]) {
          const a = SEARCH_ALIASES[wv];
          if (a.type === 'color' && !analysis.color) { analysis.color = a.name; matched = true; }
          else if (a.type === 'category') { if (!analysis.categories.includes(a.name)) analysis.categories.push(a.name); if (!analysis.category) analysis.category = a.name; matched = true; }
          else if (a.type === 'style' && !analysis.style) { analysis.style = a.name; matched = true; }
          else if (a.type === 'fit') { if (!analysis.fits.includes(a.name)) analysis.fits.push(a.name); if (!analysis.fit) analysis.fit = a.name; matched = true; }
          else if (a.type === 'fabric' && !analysis.fabric) { analysis.fabric = a.name; matched = true; }
          else if (a.type === 'pattern' && !analysis.pattern) { analysis.pattern = a.name; matched = true; }
          if (matched) break;
        }
      }
    }

    // חנות
    if (!matched) {
      for (const [name, variants] of Object.entries(storeMap)) {
        if (variants.some(v => lower === v.toLowerCase()) || lower === name.toLowerCase()) { if (!analysis.store) analysis.store = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(colorMap)) {
        if (variants.some(v => wordVariants.includes(v.toLowerCase()))) { if (!analysis.color) analysis.color = name; matched = true; break; }
      }
    }
    if (!matched) {
      // קטגוריות משניות (תיאור עיצוב) — אם כבר יש קטגוריה ראשית, הופכות ל-keyword
      const PRIMARY_CATS = new Set(['שמלה','חולצה','חצאית','מעיל','קרדיגן','סוודר','טוניקה','סרפן','ז׳קט','בלייזר','וסט','עליונית','אוברול']);
      const SECONDARY_CATS = new Set(['בייסיק','סט','חלוק']);
      for (const [name, variants] of Object.entries(categoryMap)) {
        if (variants.some(v => wordVariants.includes(v.toLowerCase()))) {
          const hasPrimary = analysis.categories.some(c => PRIMARY_CATS.has(c));
          if (SECONDARY_CATS.has(name) && hasPrimary) {
            // הופך ל-keyword במקום קטגוריה
            if (!analysis.keywords.includes(name)) analysis.keywords.push(name);
          } else {
            if (!analysis.categories.includes(name)) analysis.categories.push(name);
            if (!analysis.category) analysis.category = name;
          }
          matched = true; break;
        }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(styleMap)) {
        if (variants.some(v => wordVariants.includes(v.toLowerCase()))) { if (!analysis.style) analysis.style = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(fitMap)) {
        if (variants.some(v => wordVariants.includes(v.toLowerCase()))) { if (!analysis.fits.includes(name)) analysis.fits.push(name); if (!analysis.fit) analysis.fit = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(fabricMap)) {
        if (variants.some(v => wordVariants.includes(v.toLowerCase()))) { if (!analysis.fabric) analysis.fabric = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(patternMap)) {
        if (variants.some(v => wordVariants.includes(v.toLowerCase()))) { if (!analysis.pattern) analysis.pattern = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(designMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { analysis.designDetails.push(name); matched = true; break; }
      }
    }
    
    if (!matched && !sizeList.includes(upper) && word.length >= 2 && !stopWords.has(word)) {
      analysis.keywords.push(word);
    }
  }

  return analysis;
}

app.get("/out/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).send("Invalid id");
  try {
    const p = await pool.query(`SELECT source_url, store, title FROM products WHERE id = $1`, [id]);
    if (!p.rows.length) return res.status(404).send("Not found");
    // שמירת הלחיצה
    try {
      await pool.query(
        `INSERT INTO clicks (product_id, store, product_title, source_url, user_agent, ip_address, clicked_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [id, p.rows[0].store, p.rows[0].title, p.rows[0].source_url, req.headers['user-agent'] || '', req.ip || '']
      );
    } catch(e) { console.error('click track error:', e.message); }
    res.redirect(p.rows[0].source_url);
  } catch (err) { res.status(500).send("Error"); }
});

// API לצפייה בנתוני לחיצות
app.get("/api/clicks", adminAuth, async (req, res) => {
  try {
    const { days } = req.query;
    const daysBack = parseInt(days) || 30;
    const result = await pool.query(`
      SELECT c.id, c.product_id, c.store, c.product_title, c.source_url, c.clicked_at, c.user_agent, c.ip_address
      FROM clicks c
      WHERE c.clicked_at >= NOW() - INTERVAL '${daysBack} days'
      ORDER BY c.clicked_at DESC
      LIMIT 500
    `);
    res.json({ total: result.rows.length, clicks: result.rows });
  } catch (err) {
    console.error("clicks error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

// סטטיסטיקות לחיצות
app.get("/api/clicks/stats", adminAuth, async (req, res) => {
  try {
    const [total, byStore, byDay, topProducts] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM clicks`),
      pool.query(`SELECT store, COUNT(*) as count FROM clicks GROUP BY store ORDER BY count DESC`),
      pool.query(`SELECT DATE(clicked_at) as day, COUNT(*) as count FROM clicks WHERE clicked_at >= NOW() - INTERVAL '30 days' GROUP BY DATE(clicked_at) ORDER BY day DESC`),
      pool.query(`SELECT product_id, product_title, store, COUNT(*) as count FROM clicks GROUP BY product_id, product_title, store ORDER BY count DESC LIMIT 20`)
    ]);
    res.json({
      total: parseInt(total.rows[0]?.total) || 0,
      byStore: byStore.rows,
      byDay: byDay.rows,
      topProducts: topProducts.rows
    });
  } catch (err) {
    console.error("clicks stats error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});
app.get("/api/debug/db", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        current_database() AS db,
        inet_server_addr() AS server_ip,
        inet_server_port() AS server_port,
        (SELECT COUNT(*) FROM public.products)::int AS products_count
    `);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});



// ===== SPONSORED PRODUCTS =====
// GET /api/sponsored — מחזיר כל המודעות הפעילות (הגרלה לפי impression_weight בצד הלקוח)
app.get("/api/sponsored", async (req, res) => {
  try {
    const q = req.query.q || "";
    // מחזיר את כל המודעות הפעילות — הגרלה לפי משקל תתבצע בצד הלקוח
    const query = `
      SELECT sp.id, sp.priority_row, sp.impression_weight, sp.show_rate, sp.badge_text,
             p.image_url, p.source_url, p.title, p.price, p.store
      FROM sponsored_products sp
      JOIN products p ON p.id = sp.product_id
      WHERE sp.active = true AND (sp.expires_at IS NULL OR sp.expires_at > NOW())
      ORDER BY
        CASE WHEN $1 != '' AND (p.title ILIKE $1 OR p.category ILIKE $1) THEN 0 ELSE 1 END,
        sp.created_at DESC
      LIMIT 20`;
    const result = await pool.query(query, [`%${q}%`]);
    res.json({ sponsored: result.rows });
  } catch (e) {
    res.json({ sponsored: [] });
  }
});




// ===== SIDEBAR ADS =====

// GET /api/sidebar-ads — מחזיר לוחות פעילים לפי משקל
app.get("/api/sidebar-ads", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT * FROM sidebar_ads
      WHERE active = true
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY impression_weight DESC
    `);
    if (!r.rows.length) return res.json({ ads: [] });
    // סנן לפי show_rate (1-100)
    const eligible = r.rows.filter(a => Math.random() * 100 < (a.show_rate ?? 100));
    if (!eligible.length) return res.json({ ads: [] });
    // בחר עד 3 לוחות לפי הגרלה משוקללת
    const picked = weightedPickAds(eligible, 3);
    // מיון סופי לפי "סדר תצוגה" (display_order) — קובע מי למעלה ומי אחריו מבין הלוחות שנבחרו.
    // לא משפיע על מי נבחר (זה עדיין ה-weightedPickAds לפי impression_weight), רק על סדר ההצגה.
    picked.sort((a, b) => (a.display_order ?? 10) - (b.display_order ?? 10));
    // עדכן impressions
    const ids = picked.map(a => a.id);
    if (ids.length) {
      await pool.query(
        `UPDATE sidebar_ads SET impressions = impressions + 1 WHERE id = ANY($1)`,
        [ids]
      );
    }
    res.json({ ads: picked });
  } catch(e) { res.json({ ads: [] }); }
});

function weightedPickAds(items, count) {
  const pool = [...items];
  const picked = [];
  for (let n = 0; n < count && pool.length; n++) {
    const total = pool.reduce((s, x) => s + (x.impression_weight || 10), 0);
    let rand = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      rand -= (pool[i].impression_weight || 10);
      if (rand <= 0) { picked.push(pool.splice(i, 1)[0]); break; }
    }
  }
  return picked;
}

// POST /api/sidebar-ads/:id/click
app.post("/api/sidebar-ads/:id/click", async (req, res) => {
  try {
    await pool.query("UPDATE sidebar_ads SET clicks=clicks+1 WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false }); }
});

// GET /api/sidebar-ads/all (ניהול)
app.get("/api/sidebar-ads/all", adminAuth, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM sidebar_ads ORDER BY active DESC, display_order ASC, created_at DESC");
    res.json({ ads: r.rows });
  } catch(e) { res.json({ ads: [] }); }
});

// POST /api/sidebar-ads/create
app.post("/api/sidebar-ads/create", adminAuth, async (req, res) => {
  try {
    const { title, image_url, mobile_image_url=null, link_url, caption, size=1, impression_weight=10, show_rate=100, days=0, starts_in=0, price_paid=null, notes=null, mobile_banner=false, every_n=6, display_target='both', display_order=10 } = req.body;
    let expires_at = null, starts_at = null;
    if (days > 0) { const d=new Date(); d.setDate(d.getDate()+days); expires_at=d.toISOString(); }
    if (starts_in > 0) { const d=new Date(); d.setDate(d.getDate()+starts_in); starts_at=d.toISOString(); }
    const r = await pool.query(
      `INSERT INTO sidebar_ads (title,image_url,mobile_image_url,link_url,caption,size,impression_weight,show_rate,expires_at,starts_at,price_paid,notes,mobile_banner,every_n,display_target,display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [title,image_url,mobile_image_url||null,link_url,caption,size,impression_weight,show_rate??100,expires_at,starts_at,price_paid,notes,mobile_banner||false,every_n||6,display_target||'both',display_order??10]
    );
    res.json({ id: r.rows[0].id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/sidebar-ads/:id
app.put("/api/sidebar-ads/:id", adminAuth, async (req, res) => {
  try {
    const { title, image_url, mobile_image_url, link_url, caption, size, impression_weight, show_rate, days, price_paid, notes, mobile_banner, every_n, display_target, display_order } = req.body;
    let expires_at = null;
    if (days > 0) { const d=new Date(); d.setDate(d.getDate()+days); expires_at=d.toISOString(); }
    await pool.query(
      `UPDATE sidebar_ads SET title=$2,image_url=$3,mobile_image_url=$4,link_url=$5,caption=$6,size=$7,
       impression_weight=$8,show_rate=$9,expires_at=$10,price_paid=$11,notes=$12,mobile_banner=$13,every_n=$14,display_target=$15,display_order=$16 WHERE id=$1`,
      [req.params.id, title, image_url, mobile_image_url||null, link_url, caption, size, impression_weight, show_rate??100, expires_at, price_paid, notes, mobile_banner||false, every_n||6, display_target||'both', display_order??10]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/sidebar-ads/:id/activate|deactivate
app.post("/api/sidebar-ads/:id/activate", adminAuth, async(req,res)=>{ await pool.query("UPDATE sidebar_ads SET active=true  WHERE id=$1",[req.params.id]); res.json({ok:true}); });
app.post("/api/sidebar-ads/:id/deactivate", adminAuth, async(req,res)=>{ await pool.query("UPDATE sidebar_ads SET active=false WHERE id=$1",[req.params.id]); res.json({ok:true}); });

// DELETE /api/sidebar-ads/:id
app.delete("/api/sidebar-ads/:id", adminAuth, async(req,res)=>{ await pool.query("DELETE FROM sidebar_ads WHERE id=$1",[req.params.id]); res.json({ok:true}); });

// GET /api/ad-pricing — ציבורי, לעמוד "פרסמו אצלנו" ולתצוגה בכל מקום שצריך
app.get("/api/ad-pricing", async (req, res) => {
  try {
    const r = await pool.query("SELECT base_rates, duration_tiers, updated_at FROM ad_pricing_config WHERE id=1");
    if (!r.rows.length) return res.status(404).json({ error: "לא נמצא תמחור" });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/ad-pricing — עריכה, רק לאדמין
app.put("/api/ad-pricing", adminAuth, async (req, res) => {
  try {
    const { base_rates, duration_tiers } = req.body;
    if (!base_rates || !duration_tiers) return res.status(400).json({ error: "חסרים נתונים" });
    await pool.query(
      `INSERT INTO ad_pricing_config (id, base_rates, duration_tiers, updated_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET base_rates=$1, duration_tiers=$2, updated_at=NOW()`,
      [JSON.stringify(base_rates), JSON.stringify(duration_tiers)]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Serve admin UI

// ===== ADMIN AUTH MIDDLEWARE =====
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "lookli-admin-2026";
if (!process.env.ADMIN_PASSWORD) console.error("⚠️  WARNING: ADMIN_PASSWORD לא מוגדר ב-Railway Variables!");

// session token — HMAC של הסיסמה (לא הסיסמה עצמה) בcookie
function makeAdminCookieToken() {
  return createHmac("sha256", ADMIN_PASSWORD).update("lookli-admin-session").digest("hex");
}

function adminAuth(req, res, next) {
  // 1. Authorization header: Basic base64(admin:password)
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const [, pass] = decoded.split(':');
    if (pass === ADMIN_PASSWORD) {
      const sessionToken = makeAdminCookieToken();
      res.setHeader('Set-Cookie', `admsess=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
      return next();
    }
  }

  // 2. Cookie session (HMAC token — לא הסיסמה עצמה)
  const cookies = req.headers.cookie || '';
  const cookieMatch = cookies.match(/admsess=([a-f0-9]+)/);
  if (cookieMatch && cookieMatch[1] === makeAdminCookieToken()) return next();

  // 3. דחייה — דף login שולח סיסמה דרך Authorization header בלבד
  res.status(401).send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LOOKLI Admin — כניסה</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f13;color:#f1f0f5;font-family:'Heebo',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .box{background:#18181f;border:1px solid #2e2e3a;border-radius:16px;padding:40px 36px;width:320px;text-align:center}
  .logo{font-weight:900;font-size:24px;background:linear-gradient(135deg,#a855f7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px}
  .sub{font-size:13px;color:#6b6b80;margin-bottom:28px}
  input{width:100%;background:#22222c;border:1px solid #2e2e3a;border-radius:8px;color:#f1f0f5;padding:11px 14px;font-size:15px;font-family:'Heebo',sans-serif;outline:none;margin-bottom:14px;direction:rtl;text-align:center}
  input:focus{border-color:#a855f7}
  button{width:100%;padding:11px;background:linear-gradient(135deg,#a855f7,#ec4899);color:#fff;border:none;border-radius:8px;font-family:'Heebo',sans-serif;font-size:15px;font-weight:700;cursor:pointer}
  button:hover{opacity:.9}
  .err{color:#ef4444;font-size:13px;margin-top:10px;display:none}
  .lock{font-size:36px;margin-bottom:16px}
</style>
</head>
<body>
<div class="box">
  <div class="lock">🔐</div>
  <div class="logo">LOOKLI</div>
  <div class="sub">ממשק ניהול — כניסה מורשים בלבד</div>
  <input type="password" id="pwd" placeholder="סיסמת ניהול" onkeydown="if(event.key==='Enter')login()"/>
  <button onclick="login()">כניסה</button>
  <div class="err" id="err">סיסמה שגויה</div>
</div>
<script>
async function login(){
  const p=document.getElementById('pwd').value;
  if(!p) return;
  const res=await fetch(window.location.pathname,{
    headers:{'Authorization':'Basic '+btoa('admin:'+p)}
  });
  if(res.ok||res.status===200){window.location.reload();}
  else{const e=document.getElementById('err');e.style.display='block';}
}
</script>
</body>
</html>`);
}

app.get("/admin", adminAuth, (req, res) => { res.redirect("/admin/sponsored"); });
app.get("/admin/ads", adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_ads.html'));
});
app.get("/admin/pricing", adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_pricing.html'));
});

// GET /api/product-sizes — מחזיר מידות מוצר לפי URL (לממשק ההתראות)
app.get("/api/product-sizes", async (req, res) => {
  try {
    const raw = (req.query.url || '').trim();
    if (!raw) return res.status(400).json({ error: 'חסר url' });

    // re-encode Hebrew chars שExpress פיענח
    const reEncoded = raw.replace(/[\u0080-\uffff]/g, c =>
      encodeURIComponent(c).toLowerCase()
    );

    // ניסיון 1: חפש ב-price_alerts לפי URL (decoded + encoded) → קבל product_id
    const alertRow = await pool.query(
      `SELECT product_id FROM price_alerts
       WHERE product_source_url = $1 OR product_source_url = $2
       LIMIT 1`,
      [raw, reEncoded]
    );
    if (alertRow.rows[0]?.product_id) {
      const r = await pool.query(
        "SELECT sizes, all_sizes, color_sizes, colors FROM products WHERE id = $1",
        [alertRow.rows[0].product_id]
      );
      if (r.rows.length) return res.json({
        sizes: r.rows[0].sizes || [],
        all_sizes: r.rows[0].all_sizes || [],
        color_sizes: r.rows[0].color_sizes || {},
        colors: r.rows[0].colors || []
      });
    }

    // ניסיון 2: חיפוש ישיר ב-products לפי URL
    const urlNoSlash = raw.replace(/\/+$/, '');
    const reEncodedNoSlash = reEncoded.replace(/\/+$/, '');
    const r = await pool.query(
      `SELECT sizes, all_sizes, color_sizes, colors FROM products
       WHERE source_url = $1 OR source_url = $2
          OR source_url = $3 OR source_url = $4 LIMIT 1`,
      [urlNoSlash, urlNoSlash+'/', reEncodedNoSlash, reEncodedNoSlash+'/']
    );
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    res.json({
      sizes: r.rows[0].sizes || [],
      all_sizes: r.rows[0].all_sizes || [],
      color_sizes: r.rows[0].color_sizes || {},
      colors: r.rows[0].colors || []
    });
  } catch(e) { res.status(500).json({ error: 'שגיאה' }); }
});

// ===== SPONSORED ADMIN ROUTES =====

// GET /api/product-by-url — מחפש מוצר לפי URL (לממשק הניהול)
app.get("/api/product-by-url", adminAuth, async (req, res) => {
  try {
    const url = (req.query.url || '').trim().replace(/\/+$/, '');
    if (!url) return res.status(400).json({ error: 'חסר url' });
    const r = await pool.query(
      `SELECT id, title, store, price, image_url, sizes FROM products
       WHERE source_url = $1 OR source_url LIKE $2 LIMIT 1`,
      [url, url + '%']
    );
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: 'שגיאה' }); }
});

// GET /api/sponsored/all — כל המודעות (לממשק הניהול)
app.get("/api/sponsored/all", adminAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT sp.*, p.image_url, p.source_url, p.title, p.price AS product_price, p.store
      FROM sponsored_products sp
      JOIN products p ON p.id = sp.product_id
      ORDER BY sp.active DESC, sp.created_at DESC
    `);
    res.json({ sponsored: r.rows });
  } catch(e) { res.json({ sponsored: [] }); }
});

// POST /api/sponsored/create — יצירת מודעה חדשה
app.post("/api/sponsored/create", adminAuth, async (req, res) => {
  try {
    const { product_id, priority_row=1, impression_weight=10, show_rate=100, badge_text=null, price_paid=null, notes=null, days=0 } = req.body;
    let expires_at = null;
    if (days > 0) { const d=new Date(); d.setDate(d.getDate()+days); expires_at=d.toISOString(); }
    const r = await pool.query(
      `INSERT INTO sponsored_products (product_id, store, priority_row, impression_weight, show_rate, badge_text, price_paid, expires_at, notes)
       SELECT $1, store, $2, $3, $4, $5, $6, $7, $8 FROM products WHERE id=$1 RETURNING id`,
      [product_id, priority_row, impression_weight, show_rate??100, badge_text, price_paid, expires_at, notes]
    );
    res.json({ id: r.rows[0].id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/sponsored/:id — עדכון מודעה
app.put("/api/sponsored/:id", adminAuth, async (req, res) => {
  try {
    const { priority_row, impression_weight, show_rate, badge_text, price_paid, notes, days } = req.body;
    let expires_at = null;
    if (days > 0) { const d=new Date(); d.setDate(d.getDate()+days); expires_at=d.toISOString(); }
    await pool.query(
      `UPDATE sponsored_products SET priority_row=$2, impression_weight=$3, show_rate=$4, badge_text=$5,
       price_paid=$6, notes=$7, expires_at=$8 WHERE id=$1`,
      [req.params.id, priority_row, impression_weight, show_rate??100, badge_text, price_paid, notes, expires_at]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/sponsored/:id/activate|deactivate
app.post("/api/sponsored/:id/activate", adminAuth, async (req,res) => {
  await pool.query("UPDATE sponsored_products SET active=true  WHERE id=$1",[req.params.id]);
  res.json({ok:true});
});
app.post("/api/sponsored/:id/deactivate", adminAuth, async (req,res) => {
  await pool.query("UPDATE sponsored_products SET active=false WHERE id=$1",[req.params.id]);
  res.json({ok:true});
});

// DELETE /api/sponsored/:id
app.delete("/api/sponsored/:id", adminAuth, async (req,res) => {
  await pool.query("DELETE FROM sponsored_products WHERE id=$1",[req.params.id]);
  res.json({ok:true});
});

// Serve admin UI
app.get("/admin/sponsored", adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_sponsored.html'));
});


// ===== PRICE & STOCK ALERTS =====

// GET /api/alerts — כל ההתראות של המשתמש
app.get("/api/alerts", authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pa.*, p.price AS current_price, p.sizes AS current_sizes, p.title AS product_title, p.image_url AS product_image, p.store AS product_store
       FROM price_alerts pa
       LEFT JOIN products p ON p.source_url = pa.product_source_url
       WHERE pa.user_id = $1 AND pa.active = true
       ORDER BY pa.created_at DESC`,
      [req.userId]
    );
    res.json({ alerts: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/alerts — הגדר/עדכן התראה
app.post("/api/alerts", authMiddleware, async (req, res) => {
  try {
    const { product_source_url, alert_price, alert_size } = req.body;
    if (!product_source_url) return res.status(400).json({ error: 'חסר product_source_url' });

    // שלוף מחיר ומידות נוכחיים
    const prod = await pool.query(
      "SELECT id, price, sizes FROM products WHERE source_url = $1 LIMIT 1",
      [product_source_url]
    );
    const p = prod.rows[0];

    await pool.query(
      `INSERT INTO price_alerts (user_id, product_source_url, product_id, alert_price, alert_size, last_price, last_sizes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, product_source_url) DO UPDATE SET
         alert_price = EXCLUDED.alert_price,
         alert_size  = EXCLUDED.alert_size,
         last_price  = EXCLUDED.last_price,
         last_sizes  = EXCLUDED.last_sizes,
         active      = true`,
      [req.userId, product_source_url, p?.id || null,
       !!alert_price, alert_size || null,
       p?.price || null, p?.sizes || null]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/alerts — הסר התראה
app.delete("/api/alerts", authMiddleware, async (req, res) => {
  try {
    const { product_source_url } = req.body;
    await pool.query(
      "UPDATE price_alerts SET active=false WHERE user_id=$1 AND product_source_url=$2",
      [req.userId, product_source_url]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== NEWSLETTER =====

// ===== NEWSLETTER EXTENDED =====

// GET /api/newsletter/export.csv — הורדת CSV ישירה
app.get("/api/newsletter/export.csv", adminAuth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT email, source, created_at FROM newsletter_subscribers WHERE active=true ORDER BY created_at DESC"
    );
    const header = "Email,Source,Date\n";
    const rows = r.rows.map(x =>
      `${x.email},${x.source},${new Date(x.created_at).toLocaleDateString('he-IL')}`
    ).join("\n");
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="lookli_subscribers.csv"');
    res.send("\uFEFF" + header + rows); // BOM לעברית בExcel
  } catch(e) { res.status(500).send("Error"); }
});

// POST /api/newsletter/sync-brevo — סנכרון אוטומטי ל-Brevo
app.post("/api/newsletter/sync-brevo", adminAuth, async (req, res) => {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  const LIST_ID   = parseInt(process.env.BREVO_LIST_ID || "2");
  if (!BREVO_KEY) return res.status(400).json({ error: "חסר BREVO_API_KEY ב-Railway Variables" });

  try {
    // שלוף את כל הנרשמים מה-DB
    const r = await pool.query(
      "SELECT email FROM newsletter_subscribers WHERE active=true ORDER BY created_at DESC"
    );
    if (!r.rows.length) return res.json({ synced: 0, message: "אין נרשמים לסנכרן" });

    // Brevo batch import — עד 150 בקריאה אחת
    const contacts = r.rows.map(x => ({ email: x.email }));
    const batches = [];
    for (let i = 0; i < contacts.length; i += 150) {
      batches.push(contacts.slice(i, i + 150));
    }

    let synced = 0;
    for (const batch of batches) {
      const resp = await fetch("https://api.brevo.com/v3/contacts/import", {
        method: "POST",
        headers: {
          "api-key": BREVO_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          listIds: [LIST_ID],
          updateEnabled: true,
          jsonBody: batch
        })
      });
      if (resp.ok) synced += batch.length;
      else {
        const err = await resp.json();
        console.error("Brevo error:", err);
      }
    }

    res.json({ synced, total: contacts.length, message: `סונכרנו ${synced} כתובות ל-Brevo` });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/newsletter/add-to-brevo — הוסף נרשם חדש ל-Brevo מיד (webhook)
async function addToBrevo(email) {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  const LIST_ID   = parseInt(process.env.BREVO_LIST_ID || "2");
  if (!BREVO_KEY) return;
  try {
    await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        listIds: [LIST_ID],
        updateEnabled: true
      })
    });
  } catch(e) { console.error("Brevo add error:", e.message); }
}

// Serve newsletter admin UI
app.get("/admin/newsletter", adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin_newsletter.html'));
});

// POST /api/newsletter/subscribe
app.post("/api/newsletter/subscribe", async (req, res) => {
  try {
    const { email, source = 'footer' } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'מייל לא תקין' });
    await pool.query(
      `INSERT INTO newsletter_subscribers (email, source)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET active=true`,
      [email.toLowerCase().trim(), source]
    );
    // הוסף ל-Brevo מיד
    addToBrevo(email.toLowerCase().trim()).catch(()=>{});
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'שגיאה' });
  }
});

// GET /unsubscribe?token=... — הסרה מאובטחת עם token
app.get('/unsubscribe', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('קישור לא תקין');
  try {
    // token = base64(email)
    const email = Buffer.from(token, 'base64').toString('utf8');
    if (!email || !email.includes('@')) return res.status(400).send('קישור לא תקין');
    await pool.query('UPDATE newsletter_subscribers SET active=false WHERE email=$1', [email]);
    res.send(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>הוסרת מהרשימה</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fdf0f7}
      .box{background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.08);max-width:400px}
      h2{color:#c48cb3;margin-bottom:12px}p{color:#666;margin-bottom:24px}
      a{display:inline-block;padding:12px 28px;background:#c48cb3;color:#fff;border-radius:24px;text-decoration:none;font-weight:700}</style>
      </head><body><div class="box"><h2>✓ הוסרת בהצלחה</h2>
      <p>כתובת המייל <strong>${email}</strong> הוסרה מרשימת התפוצה של LOOKLI.</p>
      <a href="https://lookli.co.il">חזרה לאתר</a></div></body></html>`);
  } catch(e) { res.status(500).send('שגיאה — נסה שוב'); }
});

// POST /api/newsletter/unsubscribe
app.post("/api/newsletter/unsubscribe", async (req, res) => {
  try {
    const { email } = req.body;
    await pool.query("UPDATE newsletter_subscribers SET active=false WHERE email=$1", [email]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'שגיאה' }); }
});

// GET /api/newsletter/campaign-log
app.get('/api/newsletter/campaign-log', adminAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT campaign_type, stores, recipients, subject, sent_at
       FROM email_campaign_log ORDER BY sent_at DESC LIMIT 20`
    ).catch(() => ({ rows: [] }));
    res.json({ logs: r.rows });
  } catch(e) { res.json({ logs: [] }); }
});

// POST /api/newsletter/migrate-users
app.post('/api/newsletter/migrate-users', adminAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      INSERT INTO newsletter_subscribers (email, source)
      SELECT email, 'migration' FROM users
      ON CONFLICT (email) DO NOTHING
    `);
    res.json({ ok: true, added: r.rowCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/newsletter/list  (מוגן — רק לשימוש פנימי)
app.get("/api/newsletter/list", adminAuth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT email, source, active, created_at FROM newsletter_subscribers ORDER BY created_at DESC"
    );
    res.json({ count: r.rows.filter(s=>s.active).length, subscribers: r.rows });
  } catch(e) { res.status(500).json({ error: 'שגיאה' }); }
});

// ===== AUTH HELPERS =====
const JWT_SECRET = process.env.JWT_SECRET || "lookli_secret_2026_change_in_prod";
if (!process.env.JWT_SECRET) console.error("⚠️  WARNING: JWT_SECRET לא מוגדר ב-Railway Variables!");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = createHmac("sha256", salt).update(password).digest("hex");
  return check === hash;
}

function createToken(userId, email) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 })).toString("base64url");
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, payload, sig] = token.split(".");
    const check = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
    if (check !== sig) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch(e) { return null; }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "לא מחובר" });
  const data = verifyToken(token);
  if (!data) return res.status(401).json({ error: "פג תוקף החיבור" });
  req.userId = data.sub;
  req.userEmail = data.email;
  next();
}

// POST /api/auth/google-check — בדוק אם משתמש גוגל חדש או קיים (ללא יצירה)
app.post("/api/auth/google-check", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: "חסר credential" });
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    const payload = await googleRes.json();
    if (payload.error) return res.status(401).json({ error: "Token לא תקין" });
    if (payload.aud !== '1037279869077-935i5v7lva8q7t0gff3fa4m6rjtf5mn5.apps.googleusercontent.com') {
      return res.status(401).json({ error: "Client ID לא תואם" });
    }
    const emailLower = payload.email?.toLowerCase().trim();
    if (!emailLower) return res.status(400).json({ error: "לא נמצא אימייל" });
    const existing = (await pool.query('SELECT id FROM users WHERE email=$1', [emailLower])).rows[0];
    res.json({ isNew: !existing, email: emailLower, name: payload.name || '' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/google — התחברות עם Google
app.post("/api/auth/google", async (req, res) => {
  try {
    const { credential, newsletter } = req.body;
    if (!credential) return res.status(400).json({ error: "חסר credential" });

    // אמת את ה-token מול Google
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    const payload = await googleRes.json();

    if (payload.error) return res.status(401).json({ error: "Token לא תקין" });
    if (payload.aud !== '1037279869077-935i5v7lva8q7t0gff3fa4m6rjtf5mn5.apps.googleusercontent.com') {
      return res.status(401).json({ error: "Client ID לא תואם" });
    }

    const { email, name, sub: googleId } = payload;
    if (!email) return res.status(400).json({ error: "לא נמצא אימייל" });

    const emailLower = email.toLowerCase().trim();

    // בדוק אם המשתמש קיים
    let user = (await pool.query('SELECT * FROM users WHERE email=$1', [emailLower])).rows[0];

    if (!user) {
      // הרשמה חדשה — newsletter לפי בחירת המשתמש
      const wantsNewsletter = newsletter === true;
      const result = await pool.query(
        'INSERT INTO users (email, name, password_hash, newsletter, created_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING *',
        [emailLower, name || emailLower.split('@')[0], 'google_oauth_' + googleId, wantsNewsletter]
      );
      user = result.rows[0];
      // הוסף לניוזלטר רק אם אישר
      if (wantsNewsletter) {
        try {
          await pool.query(
            `INSERT INTO newsletter_subscribers (email, source)
             VALUES ($1, 'google_oauth')
             ON CONFLICT (email) DO UPDATE SET active=true`,
            [emailLower]
          );
          addToBrevo(emailLower).catch(()=>{});
        } catch(_) {}
      }
    }

    const token = createToken(user.id, user.email);

    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('google auth error:', err.message, err.stack?.split('\n')[1]);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name, newsletter = false } = req.body;
    if (!email || !password) return res.status(400).json({ error: "אימייל וסיסמה חובה" });
    if (password.length < 6) return res.status(400).json({ error: "סיסמה חייבת לפחות 6 תווים" });
    const emailLower = email.toLowerCase().trim();
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [emailLower]);
    if (existing.rows.length > 0) return res.status(409).json({ error: "אימייל כבר רשום" });
    const hash = hashPassword(password);
    const result = await pool.query(
      "INSERT INTO users(email, password_hash, name) VALUES($1,$2,$3) RETURNING id, email, name, plan, created_at",
      [emailLower, hash, name || null]
    );
    const user = result.rows[0];
    const token = createToken(user.id, user.email);
    // שמור בניוזלטר + Brevo אם אישר
    if (newsletter) {
      try {
        await pool.query(
          `INSERT INTO newsletter_subscribers (email, source)
           VALUES ($1, 'register')
           ON CONFLICT (email) DO UPDATE SET active=true`,
          [emailLower]
        );
        addToBrevo(emailLower).catch(()=>{});
      } catch(_) {}
    }
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch (e) {
    console.error("register error:", e.message);
    if (e.message.includes("users") && e.message.includes("exist")) {
      return res.status(500).json({ error: "טבלת משתמשים לא קיימת - הרץ schema_users.sql" });
    }
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "אימייל וסיסמה חובה" });
    const emailLower = email.toLowerCase().trim();
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [emailLower]);
    if (result.rows.length === 0) return res.status(401).json({ error: "אימייל או סיסמה שגויים" });
    const user = result.rows[0];
    if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: "אימייל או סיסמה שגויים" });
    const token = createToken(user.id, user.email);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch (e) {
    console.error("login error:", e.message);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// GET /api/auth/me
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, email, name, plan, created_at FROM users WHERE id=$1", [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "משתמש לא נמצא" });
    res.json({ user: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// POST /api/saved - save a product
app.post("/api/saved", authMiddleware, async (req, res) => {
  try {
    const { source_url, title, price, image, store } = req.body;
    if (!source_url) return res.status(400).json({ error: "חסר URL" });
    await pool.query(
      `INSERT INTO saved_products(user_id, product_source_url, product_title, product_price, product_image, product_store)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id, product_source_url) DO NOTHING`,
      [req.userId, source_url, title || null, price || null, image || null, store || null]
    );
    res.json({ saved: true });
  } catch (e) {
    console.error("save error:", e.message);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// DELETE /api/saved - remove saved product
app.delete("/api/saved", authMiddleware, async (req, res) => {
  try {
    const { source_url } = req.body;
    await pool.query("DELETE FROM saved_products WHERE user_id=$1 AND product_source_url=$2", [req.userId, source_url]);
    res.json({ removed: true });
  } catch (e) {
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// GET /api/saved - get all saved products
app.get("/api/saved", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM saved_products WHERE user_id=$1 ORDER BY saved_at DESC",
      [req.userId]
    );
    res.json({ saved: result.rows });
  } catch (e) {
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// POST /api/saved/check - batch check saved status
app.post("/api/saved/check", authMiddleware, async (req, res) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) return res.json({ saved: [] });
    const result = await pool.query(
      "SELECT product_source_url FROM saved_products WHERE user_id=$1 AND product_source_url=ANY($2)",
      [req.userId, urls]
    );
    res.json({ saved: result.rows.map(r => r.product_source_url) });
  } catch (e) {
    res.status(500).json({ error: "שגיאת שרת" });
  }
});


// ── GA4 Analytics Dashboard ──────────────────────────────────────────
const GA4_PROPERTY = 'properties/526435013';

async function getGA4Token() {
  let credentials;
  if (process.env.GA4_CREDENTIALS) {
    credentials = JSON.parse(process.env.GA4_CREDENTIALS);
  } else {
    throw new Error('GA4_CREDENTIALS environment variable not set');
  }
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly']
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

async function ga4Query(token, body) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${GA4_PROPERTY}:runReport`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// ── סקירת תמונות ידנית (מסך admin_image_review) ──
app.get('/api/admin/image-review', adminAuth, async (req, res) => {
  try {
    const store = req.query.store || null;
    const onlyUnreviewed = req.query.onlyUnreviewed === '1';
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const limit = Math.min(parseInt(req.query.limit) || 40, 100);
    let sql = `SELECT id, title, store, images, image_url, has_valid_image, reviewed_at FROM products WHERE (banned IS NULL OR banned=false) AND (hidden_stale IS NULL OR hidden_stale=false)`;
    const params = [];
    if (store) { params.push(store); sql += ` AND store = $${params.length}`; }
    if (onlyUnreviewed) { sql += ` AND reviewed_at IS NULL`; }
    sql += ` ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
    const result = await pool.query(sql, params);
    const countSql = `SELECT COUNT(*) AS total FROM products WHERE (banned IS NULL OR banned=false) AND (hidden_stale IS NULL OR hidden_stale=false)${store ? ' AND store=$1' : ''}${onlyUnreviewed ? (store ? ' AND reviewed_at IS NULL' : ' AND reviewed_at IS NULL') : ''}`;
    const countResult = await pool.query(countSql, store ? [store] : []);
    res.json({ results: result.rows, total: parseInt(countResult.rows[0]?.total || 0) });
  } catch (err) {
    console.error('image-review error:', err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/admin/image-review/mark', adminAuth, async (req, res) => {
  try {
    const { ids, valid } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids חסר' });
    await pool.query(
      `UPDATE products SET has_valid_image=$1, reviewed_at=NOW() WHERE id = ANY($2::int[])`,
      [!!valid, ids]
    );
    res.json({ updated: ids.length });
  } catch (err) {
    console.error('image-review mark error:', err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

// דיווח פסיבי על סטטוס תמונה (תקינה/חסומה) — נקרא אוטומטית תוך כדי גלישה רגילה באתר, בלי אימות
app.post('/api/report-image-status', async (req, res) => {
  try {
    const { productId, imageUrl, valid, totalImages } = req.body;
    if (!productId || !imageUrl) return res.status(400).json({ error: 'חסרים פרטים' });

    const current = await pool.query(`SELECT image_check_results FROM products WHERE id=$1`, [productId]);
    if (!current.rows.length) return res.status(404).json({ error: 'not found' });

    const results = current.rows[0].image_check_results || {};
    // ברגע שתמונה דווחה תקינה פעם אחת — נשארת תקינה תמיד (לא דורסים true בחזרה ל-false מדיווח מאוחר)
    if (!(results[imageUrl] === true)) results[imageUrl] = !!valid;

    const anyValid = Object.values(results).some(v => v === true);
    const anyChecked = Object.keys(results).length > 0;

    // תקין ברגע שיש דיווח תקין אחד. חסום ברגע שיש דיווח כלשהו ואף אחד מהם לא תקין
    // (לא מחכים שכל התמונות ייבדקו - זה כמעט אף פעם לא קורה, כי משתמשות לא גוללות את כל הקרוסלה)
    const hasValidImage = anyValid ? true : (anyChecked ? false : null);

    if (hasValidImage !== null) {
      const validUrls = Object.keys(results).filter(u => results[u] === true);
      await pool.query(
        `UPDATE products SET image_check_results=$1, valid_image_urls=$2, has_valid_image=$3, reviewed_at=NOW() WHERE id=$4`,
        [JSON.stringify(results), validUrls, hasValidImage, productId]
      );
    } else {
      await pool.query(`UPDATE products SET image_check_results=$1 WHERE id=$2`, [JSON.stringify(results), productId]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('report-image-status error:', err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

// ── כלי סקירת תמונות ידני (מוצרים עם תמונות חסומות/מפוקסלות מנטפרי) ──
app.get('/api/admin/image-review', adminAuth, async (req, res) => {
  try {
    const store = req.query.store || null;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    let sql = `SELECT id, title, store, image_url, images FROM products
               WHERE reviewed_at IS NULL AND (banned IS NULL OR banned=false) AND (hidden_stale IS NULL OR hidden_stale=false)`;
    const params = [];
    if (store) { sql += ` AND store = $1`; params.push(store); }
    sql += ` ORDER BY id DESC LIMIT $${params.length+1}`;
    params.push(limit);
    const { rows } = await pool.query(sql, params);
    const totalLeft = await pool.query(
      `SELECT COUNT(*) c FROM products WHERE reviewed_at IS NULL AND (banned IS NULL OR banned=false) AND (hidden_stale IS NULL OR hidden_stale=false)${store ? ' AND store=$1' : ''}`,
      store ? [store] : []
    );
    res.json({ products: rows, remaining: parseInt(totalLeft.rows[0].c) });
  } catch (err) {
    console.error('image-review GET error:', err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/admin/image-review', adminAuth, async (req, res) => {
  try {
    const { id, validUrls } = req.body;
    if (!id) return res.status(400).json({ error: 'חסר id' });
    const urls = Array.isArray(validUrls) ? validUrls : [];
    await pool.query(
      `UPDATE products SET valid_image_urls=$1, has_valid_image=$2, reviewed_at=NOW() WHERE id=$3`,
      [urls, urls.length > 0, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('image-review POST error:', err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/analytics', adminAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 28;
    const since = /^\d{4}-\d{2}-\d{2}$/.test(req.query.since || '') ? req.query.since : null;
    const dateRange = [since
      ? { startDate: since, endDate: 'today' }
      : { startDate: `${days}daysAgo`, endDate: 'today' }];
    const token = await getGA4Token();

    const [overview, daily, outbound, deviceData] = await Promise.all([
      ga4Query(token, {
        dateRanges: dateRange,
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }, { name: 'bounceRate' }, { name: 'averageSessionDuration' }]
      }),
      ga4Query(token, {
        dateRanges: dateRange,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }]
      }),
      ga4Query(token, {
        dateRanges: dateRange,
        dimensions: [{ name: 'eventName' }, { name: 'linkUrl' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'outbound_click' } } }
      }),
      ga4Query(token, {
        dateRanges: dateRange,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }]
      })
    ]);

    const totals = {
      sessions:    parseInt(overview.rows?.[0]?.metricValues?.[0]?.value || 0),
      users:       parseInt(overview.rows?.[0]?.metricValues?.[1]?.value || 0),
      pageViews:   parseInt(overview.rows?.[0]?.metricValues?.[2]?.value || 0),
      bounceRate:  parseFloat(overview.rows?.[0]?.metricValues?.[3]?.value || 0),
      avgDuration: parseFloat(overview.rows?.[0]?.metricValues?.[4]?.value || 0),
      outboundClicks: 0
    };

    const dailyData = (daily.rows || []).map(r => ({
      date:     r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
      sessions: parseInt(r.metricValues[0].value),
      users:    parseInt(r.metricValues[1].value)
    }));

    // מכשירים (מובייל/דסקטופ/טאבלט)
    const deviceMap = { mobile: 0, desktop: 0, tablet: 0 };
    (deviceData.rows || []).forEach(r => {
      const cat = (r.dimensionValues[0]?.value || '').toLowerCase();
      const sessions = parseInt(r.metricValues[0].value || 0);
      if (cat in deviceMap) deviceMap[cat] = sessions;
    });

    // קליקים לפי חנות — מ-source_url ב-GA4 + מה-DB (מדויק יותר)
    const DOMAIN_TO_STORE = {
      'mima.co.il': 'MIMA', 'mekimi.co.il': 'MEKIMI',
      'lichi.com': 'LICHI', 'lichi-shop.com': 'LICHI',
      'aviyah.co.il': 'AVIYAH', 'aviyahyosef.com': 'AVIYAH',
      'chemise.co.il': 'CHEMISE', 'chen.co.il': 'CHEN',
      'avivit-weizman.co.il': 'AVIVIT', 'avivit.co.il': 'AVIVIT',
      'rare.co.il': 'RARE', 'ordman.co.il': 'ORDMAN',
      'salina.co.il': 'SALINA', 'shebello.co.il': 'SHEBELLO',
      'myme.co.il': 'MYME', 'moda.co.il': 'MODA',
      'europisrael.co.il': 'EUROPISRAEL', 'leaa.co.il': 'LEAA',
      'st-fashion.co.il': 'ST-FASHION'
    };

    // GA4 outbound clicks (לא תמיד מדויק, תלוי בהגדרת GA)
    const ga4StoreMap = {};
    (outbound.rows || []).forEach(r => {
      const url = r.dimensionValues[1]?.value || '';
      const count = parseInt(r.metricValues[0].value);
      totals.outboundClicks += count;
      for (const [domain, name] of Object.entries(DOMAIN_TO_STORE)) {
        if (url.includes(domain)) {
          ga4StoreMap[name] = (ga4StoreMap[name] || 0) + count;
          break;
        }
      }
    });

    // DB clicks — המקור האמין (מה שנרשם אצלנו)
    let dbStoreClicks = [], dbTopProducts = [], dbDailyClicks = [];
    try {
      const sinceClause = since ? `clicked_at >= $1::date` : `clicked_at >= NOW() - INTERVAL '${days} days'`;
      const sinceParams = since ? [since] : [];
      const [storeRes, prodRes, dailyClicksRes] = await Promise.all([
        pool.query(`SELECT store, COUNT(*) as clicks FROM clicks WHERE ${sinceClause} GROUP BY store ORDER BY clicks DESC`, sinceParams),
        pool.query(`SELECT c.product_id, c.product_title, c.store, c.source_url, COUNT(*) as clicks, p.image_url FROM clicks c LEFT JOIN products p ON p.id=c.product_id WHERE ${sinceClause} GROUP BY c.product_id, c.product_title, c.store, c.source_url, p.image_url ORDER BY clicks DESC LIMIT 50`, sinceParams),
        pool.query(`SELECT DATE(clicked_at) as day, COUNT(*) as clicks FROM clicks WHERE ${sinceClause} GROUP BY DATE(clicked_at) ORDER BY day`, sinceParams)
      ]);
      dbStoreClicks = storeRes.rows.map(r => ({ name: r.store, clicks: parseInt(r.clicks) }));
      dbTopProducts = prodRes.rows.map(r => ({ id: r.product_id, title: r.product_title, store: r.store, url: r.source_url, image: r.image_url, clicks: parseInt(r.clicks) }));
      dbDailyClicks = dailyClicksRes.rows.map(r => ({ date: r.day?.toISOString?.()?.slice(0,10) || '', clicks: parseInt(r.clicks) }));
    } catch(e) { console.error('[analytics] DB error:', e.message); }

    // מיזוג קליקי GA4 + DB לפי חנות (DB הוא המקור הראשי)
    const allStoreNames = new Set([...dbStoreClicks.map(s=>s.name), ...Object.keys(ga4StoreMap)]);
    const stores = [...allStoreNames].map(name => {
      const dbVal  = dbStoreClicks.find(s => s.name === name)?.clicks || 0;
      const ga4Val = ga4StoreMap[name] || 0;
      return { name, clicks: dbVal || ga4Val, dbClicks: dbVal, ga4Clicks: ga4Val };
    }).sort((a,b) => b.clicks - a.clicks);

    // מיזוג daily: GA4 sessions + DB clicks
    const dailyMerged = dailyData.map(d => {
      const dbDay = dbDailyClicks.find(x => x.date === d.date);
      return { ...d, clicks: dbDay?.clicks || 0 };
    });

    res.json({ totals, daily: dailyMerged, stores, topProducts: dbTopProducts, devices: deviceMap });
  } catch(e) {
    console.error('[analytics]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/analytics', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_analytics.html')));
app.get('/admin/tasks', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_tasks.html')));
app.get('/admin/tagger', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_tagger.html')));
app.get('/admin/config', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_config.html')));
app.get('/admin/image-review', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_image_review.html')));
app.get('/admin/image-scan', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_image_scan.html')));

// ===== TASKS API =====
app.get('/api/admin/tasks-data', adminAuth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT value FROM admin_store WHERE key='tasks_data'`);
    if (!r.rows.length) return res.json({ tasks: [], persons: ['נעמי','יועי','שירה','דן'] });
    res.json(r.rows[0].value);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── debounce buffer לשליחת מייל סיכום ──────────────────────
let _taskChangeBuf = [];
let _taskChangeTimer = null;

async function _flushTaskNotifications(changes) {
  const NOTIFY   = process.env.ADMIN_NOTIFY_EMAIL;
  const SITE_URL = process.env.SITE_URL || 'https://lookli.co.il';
  if (!NOTIFY || !changes.length) return;

  const TYPE_LABEL = {
    created:'✅ נוצרה', completed:'🎉 הושלמה', deleted:'🗑️ נמחקה',
    reassigned:'👤 שויכה מחדש', progress:'⚡ התקדמות',
    sub_added:'➕ תת-משימה נוספה', sub_toggled:'☑️ תת-משימה עודכנה',
    sub_deleted:'🗑️ תת-משימה נמחקה', log_added:'📝 לוג נוסף', log_deleted:'🗑️ לוג נמחק',
  };

  const rows = changes.map(c => {
    const label = TYPE_LABEL[c.type] || c.type;
    let extra = '';
    if (c.type==='reassigned') extra=`<br><span style="color:#9ca3af;font-size:11px">מ-${c.from||'ללא'} ל-${c.to||'ללא'}</span>`;
    if (c.type==='progress')   extra=`<br><span style="color:#9ca3af;font-size:11px">${c.val}%</span>`;
    if (['sub_added','sub_toggled','sub_deleted'].includes(c.type)) extra=`<br><span style="color:#9ca3af;font-size:11px">${c.subText||c.text||''}</span>`;
    if (c.type==='log_added')  extra=`<br><span style="color:#9ca3af;font-size:11px">${c.text||''}</span>`;
    const person = c.person?`<span style="color:#c084fc">${c.person}</span>`:'';
    const due = c.due ? `<span style="color:#f59e0b;font-size:11px">📅 ${c.due.split('-').reverse().join('/')}</span>` : '';
    return `<tr><td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px">${label}${extra}</td><td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${c.taskTitle||''}</td><td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:12px">${person}</td><td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:12px">${due}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:'Heebo',Arial,sans-serif;direction:rtl">
  <div style="max-width:580px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);border:1px solid #e5e7eb">
    <div style="background:linear-gradient(135deg,#c084fc,#818cf8);padding:20px 24px"><div style="font-size:22px;font-weight:900;color:#fff">LOOKLI</div><div style="font-size:13px;color:rgba(255,255,255,.8)">עדכון משימות</div></div>
    <div style="padding:20px 24px">
      <p style="color:#1f2937;font-size:14px;margin-bottom:16px">${changes.length} שינויים בוצעו:</p>
      <table style="width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb"><thead><tr style="background:#f9fafb">
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">פעולה</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">משימה</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">אחראי</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">תאריך יעד</th>
      </tr></thead><tbody style="color:#374151">${rows}</tbody></table>
      <a href="${SITE_URL}/admin/tasks" style="display:inline-block;margin-top:18px;background:linear-gradient(135deg,#c084fc,#818cf8);color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none">פתח לוח משימות</a>
    </div>
  </div>
</body></html>`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'LOOKLI משימות <noreply@lookli.co.il>',
        to: NOTIFY.split(',').map(e => e.trim()),
        subject: `📋 עדכון משימות LOOKLI — ${changes.length} שינויים`,
        html,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) console.error('[tasks] Resend error:', JSON.stringify(data));
    else console.log(`[tasks] ✅ מייל נשלח: ${changes.length} שינויים → ${NOTIFY}`);
  } catch(e) { console.error('[tasks] שגיאת מייל:', e.message); }
}

function _scheduleTaskNotif(change) {
  _taskChangeBuf.push(change);
  clearTimeout(_taskChangeTimer);
  _taskChangeTimer = setTimeout(() => {
    const batch = _taskChangeBuf.splice(0);
    _flushTaskNotifications(batch);
  }, 5 * 60 * 1000); // 5 דקות אחרי השינוי האחרון
}

app.post('/api/admin/tasks-data', adminAuth, async (req, res) => {
  try {
    const { tasks, persons, waiting, changeHint } = req.body;

    // שלוף סטייט קודם להשוואה
    const prev = await pool.query(`SELECT value FROM admin_store WHERE key='tasks_data'`);
    const oldTasks = prev.rows[0]?.value?.tasks || [];
    const oldMap = Object.fromEntries(oldTasks.map(t => [t.id, t]));
    const newMap = Object.fromEntries((tasks||[]).map(t => [t.id, t]));

    // זהה שינויים
    if (changeHint) {
      // שינוי ספציפי נשלח מה-frontend — הוסף due אם חסר
      if (!changeHint.due) {
        const t = (tasks||[]).find(x => x.id === changeHint.taskId);
        if (t?.due) changeHint.due = t.due;
      }
      _scheduleTaskNotif(changeHint);
    } else {
      // diff מלא — לשמירות מה-modal
      for (const t of (tasks||[])) {
        if (!oldMap[t.id]) {
          _scheduleTaskNotif({ type: 'created', taskId: t.id, taskTitle: t.title, person: t.person, priority: t.priority, due: t.due||'' });
        } else {
          const o = oldMap[t.id];
          if (!o.done && t.done)       _scheduleTaskNotif({ type: 'completed',  taskId: t.id, taskTitle: t.title, person: t.person, due: t.due||'' });
          if (o.person !== t.person)   _scheduleTaskNotif({ type: 'reassigned', taskId: t.id, taskTitle: t.title, from: o.person, to: t.person, due: t.due||'' });
        }
      }
      for (const t of oldTasks) {
        if (!newMap[t.id])             _scheduleTaskNotif({ type: 'deleted',    taskId: t.id, taskTitle: t.title, person: t.person, due: t.due||'' });
      }
    }

    // שמור
    await pool.query(`
      INSERT INTO admin_store (key, value, updated_at) VALUES ('tasks_data', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
    `, [JSON.stringify({ tasks, persons, waiting: waiting||[] })]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tasks-test-email', adminAuth, async (req, res) => {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  const SENDER    = process.env.FROM_EMAIL || 'alerts@lookli.co.il';
  const NOTIFY    = process.env.ADMIN_NOTIFY_EMAIL;

  if (!BREVO_KEY) return res.json({ error: 'חסר BREVO_API_KEY' });
  if (!NOTIFY)    return res.json({ error: 'חסר ADMIN_NOTIFY_EMAIL' });

  const to = NOTIFY.split(',').map(e => ({ email: e.trim() })).filter(e => e.email);

  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'LOOKLI Test', email: SENDER },
        to,
        subject: '✅ בדיקת מייל משימות LOOKLI',
        htmlContent: '<p>זה מייל בדיקה — אם קיבלת אותו הכל עובד!</p>',
      }),
    });
    const data = await resp.json();
    res.json({ status: resp.status, ok: resp.ok, brevo: data, sender: SENDER, to });
  } catch(e) {
    res.json({ error: e.message });
  }
});


app.post('/api/admin/tasks-notify-now', adminAuth, async (req, res) => {
  clearTimeout(_taskChangeTimer);
  const batch = _taskChangeBuf.splice(0);
  if (!batch.length) return res.json({ ok: true, sent: 0 });
  await _flushTaskNotifications(batch);
  res.json({ ok: true, sent: batch.length });
});

app.get('/api/admin/tasks-pending-changes', adminAuth, (req, res) => {
  res.json({ count: _taskChangeBuf.length });
});

// GET /api/cron/tasks-due-reminders?secret=CRON_SECRET
// שולח תזכורת למשימות שתאריך היעד שלהן בעוד יומיים — מופעל מ-Railway Cron
app.get('/api/cron/tasks-due-reminders', async (req, res) => {
  const CRON_SECRET = process.env.CRON_SECRET || '';
  if (CRON_SECRET && req.query.secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const NOTIFY    = process.env.ADMIN_NOTIFY_EMAIL;
  const SITE_URL_ = process.env.SITE_URL || 'https://lookli.co.il';
  if (!NOTIFY || !process.env.RESEND_API_KEY) {
    return res.json({ ok: false, reason: 'missing env vars' });
  }
  try {
    const { rows } = await pool.query(`SELECT value FROM admin_store WHERE key='tasks_data'`);
    const tasks = rows[0]?.value?.tasks || [];

    const today = new Date();
    today.setHours(0,0,0,0);
    const target = new Date(today);
    target.setDate(today.getDate() + 2);
    const targetStr = target.toISOString().slice(0, 10);

    const due = tasks.filter(t => !t.done && t.due === targetStr);
    if (!due.length) return res.json({ ok: true, sent: 0, reason: 'no tasks due in 2 days' });

    const tableRows = due.map(t => {
      const priority = t.priority === 'high' ? '🔴 גבוהה' : t.priority === 'low' ? '🟢 נמוכה' : '🟡 בינונית';
      const pct = t.progress || 0;
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${t.title||''}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280">${t.person||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px">${priority}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280">${pct}%</td>
      </tr>`;
    }).join('');

    const dateLabel = targetStr.split('-').reverse().join('/');
    const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:'Heebo',Arial,sans-serif;direction:rtl">
  <div style="max-width:580px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);border:1px solid #e5e7eb">
    <div style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:20px 24px">
      <div style="font-size:22px;font-weight:900;color:#fff">LOOKLI</div>
      <div style="font-size:13px;color:rgba(255,255,255,.85)">⏰ תזכורת — משימות שמסתיימות בעוד יומיים (${dateLabel})</div>
    </div>
    <div style="padding:20px 24px">
      <p style="color:#1f2937;font-size:14px;margin-bottom:16px">${due.length} משימות פתוחות מסתיימות ב-${dateLabel}:</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
        <thead><tr style="background:#fef3c7">
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#92400e">משימה</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#92400e">אחראי</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#92400e">עדיפות</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#92400e">התקדמות</th>
        </tr></thead>
        <tbody style="color:#374151">${tableRows}</tbody>
      </table>
      <a href="${SITE_URL_}/admin/tasks" style="display:inline-block;margin-top:18px;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none">פתח לוח משימות</a>
    </div>
  </div>
</body></html>`;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'LOOKLI משימות <noreply@lookli.co.il>',
        to: NOTIFY.split(',').map(e => e.trim()),
        subject: `⏰ תזכורת: ${due.length} משימות מסתיימות בעוד יומיים (${dateLabel})`,
        html,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[tasks-due] Resend error:', JSON.stringify(data));
      return res.json({ ok: false, error: data });
    }
    console.log(`[tasks-due] ✅ תזכורת נשלחה: ${due.length} משימות → ${NOTIFY}`);
    res.json({ ok: true, sent: due.length, date: targetStr, tasks: due.map(t => t.title) });
  } catch(e) {
    console.error('[tasks-due] שגיאה:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/tag-products', adminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { ids, field, value, replaceOther } = req.body;
    if (!ids?.length || !field || value === undefined) return res.status(400).json({ error: 'חסרים פרמטרים' });
    const ALLOWED = ['style','category','fit','fabric','pattern','color','design_details'];
    if (!ALLOWED.includes(field)) return res.status(400).json({ error: 'שדה לא מורשה' });

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_tagger_update = 'true'`);

    let result;
    if (field === 'design_details') {
      result = await client.query(
        `UPDATE products
         SET design_details = array_append(COALESCE(design_details,'{}'), $1::text),
             tagged_fields  = array_append(COALESCE(tagged_fields,'{}'), 'design_details'),
             updated_at     = NOW()
         WHERE id = ANY($2::int[]) AND NOT (design_details @> ARRAY[$1::text])`,
        [value, ids]
      );
    } else if (field === 'fit') {
      result = await client.query(
        `UPDATE products
         SET fit           = $1::text,
             fits          = array_append(COALESCE(fits,'{}'), $1::text),
             tagged_fields = array_append(array_remove(COALESCE(tagged_fields,'{}'), 'fit'), 'fit'),
             updated_at    = NOW()
         WHERE id = ANY($2::int[])`,
        [value, ids]
      );
    } else if (field === 'style') {
      result = await client.query(
        `UPDATE products
         SET style         = $1::text,
             styles        = array_append(COALESCE(styles,'{}'), $1::text),
             tagged_fields = array_append(array_remove(COALESCE(tagged_fields,'{}'), 'style'), 'style'),
             updated_at    = NOW()
         WHERE id = ANY($2::int[])`,
        [value, ids]
      );
    } else if (field === 'color') {
      if (replaceOther) {
        result = await client.query(
          `UPDATE products
           SET color         = CASE WHEN color = 'אחר' THEN $1::text ELSE color END,
               colors        = array_remove(array_replace(COALESCE(colors,'{}'), 'אחר', $1::text), NULL),
               tagged_fields = array_append(array_remove(COALESCE(tagged_fields,'{}'), 'color'), 'color'),
               updated_at    = NOW()
           WHERE id = ANY($2::int[])`,
          [value, ids]
        );
      } else {
        result = await client.query(
          `UPDATE products
           SET color         = $1::text,
               colors        = (SELECT ARRAY(SELECT DISTINCT unnest(array_append(COALESCE(colors,'{}'), $1::text)))),
               tagged_fields = array_append(array_remove(COALESCE(tagged_fields,'{}'), 'color'), 'color'),
               updated_at    = NOW()
           WHERE id = ANY($2::int[])`,
          [value, ids]
        );
      }
    } else {
      result = await client.query(
        `UPDATE products
         SET ${field}      = $1::text,
             tagged_fields = array_append(array_remove(COALESCE(tagged_fields,'{}'), $2::text), $2::text),
             updated_at    = NOW()
         WHERE id = ANY($3::int[])`,
        [value, field, ids]
      );
    }

    // ── אימות: בדוק שהערך נשמר. שדות מערך (fit/design_details/color) נבדקים ב-containment, לא equality ──
    const isArrayField = field === 'fit' || field === 'design_details' || field === 'color';
    const arrayCol = field === 'fit' ? 'fits' : field === 'color' ? 'colors' : field;
    const verify = await client.query(
      isArrayField
        ? `SELECT id, (${arrayCol} @> ARRAY[$2::text]) AS matched FROM products WHERE id = ANY($1::int[])`
        : `SELECT id, ${field} AS val FROM products WHERE id = ANY($1::int[])`,
      isArrayField ? [ids, value] : [ids]
    );
    const failedIds = (isArrayField
      ? verify.rows.filter(r => !r.matched)
      : verify.rows.filter(r => r.val !== value)
    ).map(r => r.id);
    const skippedCount = failedIds.length;

    if (skippedCount > 0 && skippedCount === ids.length) {
      // אף מוצר לא התעדכן — זה כן שגיאה אמיתית (לא רק "כמה דולגו")
      await client.query('ROLLBACK');
      console.error(`[tag-products] ⚠️ אימות נכשל לחלוטין — 0/${ids.length} התעדכנו`);
      return res.status(500).json({
        error: `השמירה נכשלה לכל המוצרים הנבחרים`,
        failedIds
      });
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      updated: result.rowCount,
      verified: verify.rows.length - skippedCount,
      skipped: skippedCount,
      skippedIds: skippedCount > 0 ? failedIds : undefined,
    });
  } catch(e) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[tag-products] שגיאה:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/tag-products/remove-value
app.patch('/api/admin/tag-products/remove-value', adminAuth, async (req, res) => {
  try {
    const { id, field, value } = req.body;
    if (!id || !field) return res.status(400).json({ error: 'חסרים פרמטרים' });
    if (field === 'color') {
      await pool.query(
        `UPDATE products SET colors=array_remove(COALESCE(colors,'{}'),$1),
         color=CASE WHEN color=$1 THEN (SELECT c FROM unnest(array_remove(COALESCE(colors,'{}'),$1)) c LIMIT 1) ELSE color END,
         updated_at=NOW() WHERE id=$2`, [value, id]
      );
    } else if (field === 'fit') {
      await pool.query(
        `UPDATE products SET fits=array_remove(COALESCE(fits,'{}'),$1),
         fit=CASE WHEN fit=$1 THEN (SELECT f FROM unnest(array_remove(COALESCE(fits,'{}'),$1)) f LIMIT 1) ELSE fit END,
         updated_at=NOW() WHERE id=$2`, [value, id]
      );
    } else if (field === 'style') {
      await pool.query(
        `UPDATE products SET styles=array_remove(COALESCE(styles,'{}'),$1),
         style=CASE WHEN style=$1 THEN (SELECT s FROM unnest(array_remove(COALESCE(styles,'{}'),$1)) s LIMIT 1) ELSE style END,
         updated_at=NOW() WHERE id=$2`, [value, id]
      );
    } else if (field === 'design_details') {
      await pool.query(`UPDATE products SET design_details=array_remove(COALESCE(design_details,'{}'),$1),updated_at=NOW() WHERE id=$2`, [value, id]);
    } else {
      await pool.query(`UPDATE products SET ${field}=NULL,updated_at=NOW() WHERE id=$1`, [id]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/tag-products/clear-design', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'חסרים ids' });
    await pool.query(
      `UPDATE products
       SET design_details = NULL,
           tagged_fields  = array_remove(COALESCE(tagged_fields,'{}'), 'design_details'),
           updated_at     = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    res.json({ ok: true, updated: ids.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/tag-products/clear-fits', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'חסרים ids' });
    await pool.query(
      `UPDATE products
       SET fit           = NULL,
           fits          = NULL,
           tagged_fields = array_remove(COALESCE(tagged_fields,'{}'), 'fit'),
           updated_at    = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    res.json({ ok: true, updated: ids.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/admin/tag-products/clear-styles', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'חסרים ids' });
    await pool.query(
      `UPDATE products
       SET style         = NULL,
           styles        = NULL,
           tagged_fields = array_remove(COALESCE(tagged_fields,'{}'), 'style'),
           updated_at    = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    res.json({ ok: true, updated: ids.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/admin/tagger', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_tagger.html')));

// ===== קישורי הצגה זמניים =====
// POST /api/admin/preview-token — יצירת טוקן זמני
app.post('/api/admin/preview-token', adminAuth, async (req, res) => {
  const { hours = 24, note = '' } = req.body;
  const token = randomBytes(16).toString('hex');
  try {
    await pool.query(
      `INSERT INTO preview_tokens (token, note, expires_at) VALUES ($1, $2, NOW() + ($3 || ' hours')::interval)`,
      [token, note, hours]
    );
    const expiresAt = Date.now() + hours * 60 * 60 * 1000;
    const url = `${process.env.SITE_URL || 'https://lookli-production.up.railway.app'}/?preview=${token}`;
    res.json({ ok: true, url, hours, expiresAt, note });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/preview-token/:token — אימות טוקן (ציבורי)
app.get('/api/preview-token/:token', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT expires_at, note FROM preview_tokens WHERE token=$1 AND expires_at > NOW()`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ valid: false });
    res.json({ valid: true, expiresAt: new Date(r.rows[0].expires_at).getTime(), note: r.rows[0].note });
  } catch(e) {
    res.status(500).json({ valid: false });
  }
});

// ===================================================================
// ===== מערכת מייל מוצרים חדשים =====================================
// ===================================================================

const STORE_NAMES = {
  'MEKIMI':  'מקימי',
  'LICHI':   "ליצ'י",
  'MIMA':    'מימה',
  'AVIYAH':  'אביה יוסף',
  'CHEMISE': 'שמיז',
  'ORDMAN':  'אורדמן',
  'RARE':    'רייר',
  'AVIVIT':  'אביבית וייצמן',
};

const SITE_BASE = process.env.SITE_URL || 'https://lookli.co.il';

// בנה HTML email
function buildNewProductsEmail(storeGroups) {
  const storeBlocks = storeGroups.map(({ store, storeName, products, total }) => {
    const cards = products.slice(0, 4).map(p => {
      const img   = p.images?.[0] || p.image_url || '';
      const price = p.original_price && p.original_price > p.price
        ? `<span style="color:#e0a1c0;font-weight:700">₪${p.price}</span> <s style="color:#aaa;font-size:11px">₪${p.original_price}</s>`
        : `<span style="color:#333;font-weight:700">₪${p.price}</span>`;
      const slug  = (p.title||'').trim().replace(/\s+/g,'-').replace(/[^\u05D0-\u05EAa-zA-Z0-9\-]/g,'').toLowerCase();
      const url   = `${SITE_BASE}/product/${slug||p.id}`;
      return `
        <td style="width:25%;padding:3px;vertical-align:top">
          <a href="${url}" style="display:block;text-decoration:none;color:inherit">
            <div style="border-radius:10px;overflow:hidden;border:1px solid #f0e6f0;background:#fff;transition:box-shadow .2s">
              <div style="aspect-ratio:3/4;overflow:hidden;background:#f9f9f9">
                <img src="${img}" alt="${(p.title||'').replace(/"/g,'')}" width="100%" style="display:block;width:100%;height:auto;object-fit:cover">
              </div>
              <div style="padding:8px 10px">
                <div style="font-size:11px;color:#aaa;margin-bottom:2px">${storeName}</div>
                <div style="font-size:12px;color:#444;line-height:1.3;height:32px;overflow:hidden">${p.title||''}</div>
                <div style="font-size:13px;margin-top:4px">${price}</div>
              </div>
            </div>
          </a>
        </td>`;
    });

    // תמיד 4 עמודות — תאים ריקים למשבצות פנויות
    const emptyCell = '<td style="width:25%;padding:3px;vertical-align:top"></td>';
    const allCards = cards.join('') + emptyCell.repeat(Math.max(0, 4 - cards.length));

    const moreBtn = total > 4 ? `
      <tr><td colspan="4" style="padding:10px 6px 4px;text-align:center">
        <a href="${SITE_BASE}/?store=${store}" style="display:inline-block;padding:8px 22px;background:#f8eef8;color:#c48cb3;border-radius:20px;font-size:13px;font-weight:700;text-decoration:none;border:1px solid #e8d0e8">
          + עוד ${total - 4} מוצרים חדשים ←
        </a>
      </td></tr>` : '';

    return `
      <tr><td style="padding:28px 0 8px">
        <div style="font-size:18px;font-weight:800;color:#333;border-right:4px solid #e0a1c0;padding-right:12px">
          ${storeName}
          <span style="font-size:13px;font-weight:400;color:#aaa;margin-right:8px">${total} מוצרים חדשים</span>
        </div>
      </td></tr>
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr>${allCards}</tr>
          ${moreBtn}
        </table>
      </td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>מוצרים חדשים על המדף</title></head>
<body style="margin:0;padding:0;background:#f7f0f7;font-family:'Segoe UI',Arial,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f0f7;padding:32px 16px">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#d191b0 0%,#c48cb3 100%);padding:32px 36px;text-align:center">
    <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px">LOOKLI</div>
    <div style="font-size:15px;color:rgba(255,255,255,.85);margin-top:6px">מוצרים חדשים על המדף 🛍️</div>
  </td></tr>

  <!-- Stores -->
  <tr><td style="padding:16px 16px 8px">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${storeBlocks}
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:24px 28px 32px;text-align:center">
    <a href="${SITE_BASE}" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#d191b0,#c48cb3);color:#fff;border-radius:28px;font-size:15px;font-weight:700;text-decoration:none;box-shadow:0 4px 16px rgba(196,140,179,.35)">
      לכל המוצרים באתר ←
    </a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f9f3f9;padding:18px 28px;text-align:center;border-top:1px solid #f0e6f0">
    <p style="margin:0;font-size:11px;color:#bbb">
      קיבלת מייל זה כי נרשמת לעדכונים מ-LOOKLI.<br>
      <a href="{{unsubscribe_url}}" style="color:#c48cb3">הסרה מרשימת תפוצה</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// שלח דרך Brevo
// יצירת unsubscribe token מאובטח
function unsubscribeToken(email) {
  return Buffer.from(email).toString('base64');
}

async function sendNewProductsEmail(toEmails, subject, htmlTemplate) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const SITE = process.env.SITE_URL || 'https://lookli.co.il';
  if (!RESEND_KEY) throw new Error('חסר RESEND_API_KEY');

  const FROM = 'LOOKLI <info@lookli.co.il>';
  let sent = 0, failed = 0;
  const failedEmails = [];

  // שלח לכל נמען בנפרד עם token ייחודי
  for (const email of toEmails) {
    const token = unsubscribeToken(email);
    const unsubUrl = `${SITE}/unsubscribe?token=${encodeURIComponent(token)}`;

    // החלף placeholder בHTML
    const html = htmlTemplate
      .replace(/\{\{email\}\}/g, email)
      .replace(/\{\{unsubscribe_url\}\}/g, unsubUrl);

    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [email],
          subject,
          html,
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>, <mailto:unsubscribe@lookli.co.il?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            'Precedence': 'bulk',
            'X-Mailer': 'LOOKLI Newsletter',
          }
        })
      });

      if (resp.ok) {
        sent++;
      } else {
        const err = await resp.json().catch(() => ({}));
        console.error(`Resend failed [${email}]:`, err.message || JSON.stringify(err));
        failedEmails.push({ email, error: err.message || err.name || 'unknown' });
        failed++;
      }

      // המתן 600ms בין שליחות — Resend מגביל ל-2 בקשות/שנייה
      await new Promise(r => setTimeout(r, 600));

    } catch(e) {
      console.error(`Resend exception [${email}]:`, e.message);
      failed++;
    }
  }

  console.log(`sendNewProductsEmail: sent=${sent}, failed=${failed}, total=${toEmails.length}`);
  if (failedEmails.length) console.error('נכשלו:', JSON.stringify(failedEmails));
  return sent;
}

// Cron endpoint — מופעל מ-Railway Cron
// GET /api/cron/new-products-email?secret=CRON_SECRET
app.get('/api/cron/new-products-email', async (req, res) => {

  try {
    const dryRun = req.query.dry === '1'; // ?dry=1 → לא שולח, רק מחזיר JSON

    // 1. בדוק אם עברו 5 ימים מהשליחה האחרונה
    const lastSentRow = await pool.query(
      `SELECT sent_at FROM email_campaign_log WHERE campaign_type='new_products' ORDER BY sent_at DESC LIMIT 1`
    ).catch(() => ({ rows: [] }));

    const forceRun = req.query.force === '1';
    if (!dryRun && !forceRun && lastSentRow.rows.length) {
      const lastSent = new Date(lastSentRow.rows[0].sent_at);
      const daysSince = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        return res.json({ skipped: true, reason: `נשלח לפני ${daysSince.toFixed(1)} ימים — מינימום 7 ימים בין שליחות` });
      }
    }

    // 2. מצא חנויות עם מוצרים חדשים ב-7 ימים האחרונים
    const newProductsRes = await pool.query(`
      SELECT store, COUNT(*) as count
      FROM products
      WHERE first_seen >= NOW() - INTERVAL '7 days'
        AND store IS NOT NULL
      GROUP BY store
      ORDER BY count DESC
    `);

    if (!newProductsRes.rows.length) {
      return res.json({ skipped: true, reason: 'אין מוצרים חדשים ב-7 ימים האחרונים' });
    }

    // 3. שלוף את המוצרים עצמם לכל חנות
    const storeGroups = [];
    for (const row of newProductsRes.rows) {
      const productsRes = await pool.query(`
        SELECT id, title, price, original_price, image_url, images, store, category
        FROM products
        WHERE store = $1 AND first_seen >= NOW() - INTERVAL '7 days'
        ORDER BY first_seen DESC
        LIMIT 12
      `, [row.store]);

      storeGroups.push({
        store:     row.store,
        storeName: STORE_NAMES[row.store] || row.store,
        products:  productsRes.rows,
        total:     parseInt(row.count)
      });
    }

    // 4. בנה כותרת
    const storeNamesList = storeGroups.map(s => s.storeName).join(', ');
    const subject = `מוצרים חדשים על המדף ב${storeNamesList} 🛍️`;
    const htmlContent = buildNewProductsEmail(storeGroups);

    // dry run — החזר את ה-HTML בלבד
    if (dryRun) {
      return res.send(htmlContent);
    }

    // 5. שלוף מנויים פעילים
    const subscribersRes = await pool.query(
      `SELECT email FROM newsletter_subscribers WHERE active=true ORDER BY created_at DESC`
    );
    const emails = subscribersRes.rows.map(r => r.email);
    console.log(`[new-products] מנויים פעילים: ${emails.length}`);
    if (!emails.length) return res.json({ skipped: true, reason: 'אין מנויים פעילים' });

    // 6. שלח
    const sent = await sendNewProductsEmail(emails, subject, htmlContent);

    // 7. תיעד בlog
    await pool.query(
      `INSERT INTO email_campaign_log (campaign_type, stores, recipients, subject, sent_at)
       VALUES ('new_products', $1, $2, $3, NOW())`,
      [storeGroups.map(s=>s.store).join(','), sent, subject]
    ).catch(() => {}); // אם הטבלה לא קיימת — לא נופלים

    res.json({
      ok: true,
      sent,
      failed: emails.length - sent,
      total: emails.length,
      stores: storeGroups.map(s => ({ store: s.store, newProducts: s.total })),
      subject
    });

  } catch(e) {
    console.error('new-products-email cron error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// צור טבלת log אם לא קיימת (חד-פעמי בעליית שרת)
async function ensureEmailCampaignLog() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_campaign_log (
        id           SERIAL PRIMARY KEY,
        campaign_type VARCHAR(50) NOT NULL,
        stores       TEXT,
        recipients   INTEGER DEFAULT 0,
        subject      TEXT,
        sent_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_log_type ON email_campaign_log(campaign_type, sent_at DESC)`);
  } catch(e) { console.error('email_campaign_log init:', e.message); }
}

// ===================================================================
// ===== מערכת מייל ירידת מחירים =====================================
// ===================================================================

function buildPriceDropEmail(storeGroups) {
  const storeBlocks = storeGroups.map(({ storeName, store, products, total }) => {
    const cards = products.slice(0, 4).map(p => {
      const img = p.images?.[0] || p.image_url || '';
      const disc = Math.round((1 - p.price / p.original_price) * 100);
      const slug = (p.title||'').trim().replace(/\s+/g,'-').replace(/[^\u05D0-\u05EAa-zA-Z0-9\-]/g,'').toLowerCase();
      const url = `${SITE_BASE}/product/${slug||p.id}`;
      return `
        <td style="width:25%;padding:3px;vertical-align:top">
          <a href="${url}" style="display:block;text-decoration:none;color:inherit">
            <div style="border-radius:10px;overflow:hidden;border:1px solid #f0e6f0;background:#fff;position:relative">
              <div style="position:absolute;top:8px;left:8px;background:#d191b0;color:#fff;font-size:11px;font-weight:800;padding:3px 8px;border-radius:20px;z-index:1">-${disc}%</div>
              <div style="aspect-ratio:3/4;overflow:hidden;background:#f9fafb">
                <img src="${img}" alt="${(p.title||'').replace(/"/g,'')}" width="100%" style="display:block;width:100%;height:auto;object-fit:cover">
              </div>
              <div style="padding:8px 10px">
                <div style="font-size:11px;color:#aaa;margin-bottom:2px">${storeName}</div>
                <div style="font-size:12px;color:#444;line-height:1.3;height:32px;overflow:hidden">${p.title||''}</div>
                <div style="font-size:13px;margin-top:4px">
                  <span style="color:#d191b0;font-weight:800">₪${p.price}</span>
                  <s style="color:#aaa;font-size:11px;margin-right:4px">₪${p.original_price}</s>
                </div>
              </div>
            </div>
          </a>
        </td>`;
    }).join('');

    const emptyCell = '<td style="width:25%;padding:3px;vertical-align:top"></td>';
    const allCards = cards + emptyCell.repeat(Math.max(0, 4 - products.slice(0,4).length));

    const moreBtn = total > 4 ? `
      <tr><td colspan="4" style="padding:10px 6px 4px;text-align:center">
        <a href="${SITE_BASE}/?store=${store}&discount=10" style="display:inline-block;padding:8px 22px;background:#fdf0f7;color:#d191b0;border-radius:20px;font-size:13px;font-weight:700;text-decoration:none;border:1px solid #e8d0e8">
          + עוד ${total - 4} מוצרים במבצע ←
        </a>
      </td></tr>` : '';

    return `
      <tr><td style="padding:28px 0 8px">
        <div style="font-size:18px;font-weight:800;color:#333;border-right:4px solid #d191b0;padding-right:12px">
          ${storeName}
          <span style="font-size:13px;font-weight:400;color:#aaa;margin-right:8px">${total} מוצרים במבצע</span>
        </div>
      </td></tr>
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr>${allCards}</tr>
          ${moreBtn}
        </table>
      </td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ירידות מחיר השבוע</title></head>
<body style="margin:0;padding:0;background:#f7f0f7;font-family:'Segoe UI',Arial,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f0f7;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <tr><td style="background:linear-gradient(135deg,#d191b0 0%,#c48cb3 100%);padding:32px 36px;text-align:center">
    <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px">LOOKLI</div>
    <div style="font-size:15px;color:rgba(255,255,255,.85);margin-top:6px">ירידות מחיר השבוע 🏷️</div>
  </td></tr>

  <tr><td style="padding:16px 16px 8px">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${storeBlocks}
    </table>
  </td></tr>

  <tr><td style="padding:24px 28px 32px;text-align:center">
    <a href="${SITE_BASE}/?discount=10" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#d191b0,#c48cb3);color:#fff;border-radius:28px;font-size:15px;font-weight:700;text-decoration:none;box-shadow:0 4px 16px rgba(196,140,179,.35)">
      לכל המוצרים במבצע ←
    </a>
  </td></tr>

  <tr><td style="background:#f9f3f9;padding:18px 28px;text-align:center;border-top:1px solid #f0e6f0">
    <p style="margin:0;font-size:11px;color:#bbb">
      קיבלת מייל זה כי נרשמת לעדכונים מ-LOOKLI.<br>
      <a href="{{unsubscribe_url}}" style="color:#d191b0">הסרה מרשימת תפוצה</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// GET /api/cron/price-drop-email
app.get('/api/cron/price-drop-email', async (req, res) => {

  try {
    const dryRun = req.query.dry === '1';

    // בדוק 7 ימים מהשליחה האחרונה
    const lastSentRow = await pool.query(
      `SELECT sent_at FROM email_campaign_log WHERE campaign_type='price_drop' ORDER BY sent_at DESC LIMIT 1`
    ).catch(() => ({ rows: [] }));

    const forceRun = req.query.force === '1';
    if (!dryRun && !forceRun && lastSentRow.rows.length) {
      const daysSince = (Date.now() - new Date(lastSentRow.rows[0].sent_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        return res.json({ skipped: true, reason: `נשלח לפני ${daysSince.toFixed(1)} ימים — מינימום 7 ימים בין שליחות` });
      }
    }

    // מצא מוצרים שקיבלו הנחה 10%+ ב-7 ימים האחרונים
    const priceDropRes = await pool.query(`
      SELECT store, COUNT(*) as count
      FROM products
      WHERE price_dropped_at >= NOW() - INTERVAL '7 days'
        AND original_price IS NOT NULL
        AND original_price > 0
        AND price > 0
        AND original_price > price * 1.10
        AND store IS NOT NULL
      GROUP BY store
      ORDER BY count DESC
    `);

    if (!priceDropRes.rows.length) {
      return res.json({ skipped: true, reason: 'אין מוצרים עם ירידת מחיר 10%+ השבוע' });
    }

    // שלוף מוצרים לכל חנות
    const storeGroups = [];
    for (const row of priceDropRes.rows) {
      const productsRes = await pool.query(`
        SELECT id, title, price, original_price, image_url, images, store
        FROM products
        WHERE store = $1
          AND price_dropped_at >= NOW() - INTERVAL '7 days'
          AND original_price IS NOT NULL
          AND original_price > price * 1.10
        ORDER BY (original_price - price) / original_price DESC
        LIMIT 12
      `, [row.store]);

      storeGroups.push({
        store:     row.store,
        storeName: STORE_NAMES[row.store] || row.store,
        products:  productsRes.rows,
        total:     parseInt(row.count)
      });
    }

    const storeNamesList = storeGroups.map(s => s.storeName).join(', ');
    const subject = `ירידות מחיר השבוע ב${storeNamesList} 🏷️`;
    const html = buildPriceDropEmail(storeGroups);

    if (dryRun) return res.send(html);

    // שלוף מנויים
    const subscribersRes = await pool.query(
      `SELECT email FROM newsletter_subscribers WHERE active=true`
    );
    const emails = subscribersRes.rows.map(r => r.email);
    console.log(`[price-drop] מנויים פעילים: ${emails.length}`);
    if (!emails.length) return res.json({ skipped: true, reason: 'אין מנויים פעילים' });

    const sent = await sendNewProductsEmail(emails, subject, html);

    await pool.query(
      `INSERT INTO email_campaign_log (campaign_type, stores, recipients, subject, sent_at)
       VALUES ('price_drop', $1, $2, $3, NOW())`,
      [storeGroups.map(s=>s.store).join(','), sent, subject]
    ).catch(() => {});

    res.json({ ok: true, sent, failed: emails.length - sent, total: emails.length, stores: storeGroups.map(s=>({ store:s.store, products:s.total })), subject });

  } catch(e) {
    console.error('price-drop-email error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// GET /api/cron/check-alerts?secret=CRON_SECRET
// מריץ בדיקת התראות מחיר ומלאי — נקרא מ-Railway Cron
app.get('/api/cron/check-alerts', async (req, res) => {
  const CRON_SECRET = process.env.CRON_SECRET || '';
  if (CRON_SECRET && req.query.secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const BREVO_KEY  = process.env.BREVO_API_KEY;
  const SITE_URL_  = process.env.SITE_URL || 'https://lookli.co.il';
  const FROM_EMAIL_= process.env.FROM_EMAIL || 'alerts@lookli.co.il';
  const FROM_NAME  = 'LOOKLI התראות';

  async function sendAlertEmail(toEmail, subject, htmlBody) {
    if (!BREVO_KEY) return false;
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { name: FROM_NAME, email: FROM_EMAIL_ },
          to: [{ email: toEmail }],
          subject,
          htmlContent: htmlBody,
        }),
      });
      return r.ok;
    } catch(e) { return false; }
  }

  function buildAlertEmail({ type, title, image, store, oldVal, newVal, url }) {
    const isPrice = type === 'price';
    const body = isPrice
      ? `<p style="font-size:16px">המחיר של <strong>${title}</strong> ירד!</p>
         <p style="font-size:22px;color:#e0a1c0;font-weight:900">₪${newVal} <span style="text-decoration:line-through;font-size:14px;color:#999">₪${oldVal}</span></p>`
      : `<p style="font-size:16px">מידה <strong>${newVal}</strong> של <strong>${title}</strong> חזרה למלאי!</p>`;
    return `<!DOCTYPE html><html dir="rtl" lang="he">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:'Heebo',Arial,sans-serif;direction:rtl">
  <div style="max-width:520px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#d191b0,#c48cb3);padding:24px 28px;text-align:center">
      <div style="font-size:28px;font-weight:900;color:#fff">LOOKLI</div>
      <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:4px">התראת מחיר ומלאי</div>
    </div>
    <div style="padding:28px">
      ${image ? `<img src="${image}" alt="${title}" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-bottom:20px"/>` : ''}
      <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">${store || ''}</div>
      ${body}
      <a href="${url}" target="_blank" style="display:block;margin-top:20px;background:linear-gradient(135deg,#d191b0,#c48cb3);color:#fff;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none">לרכישה באתר ←</a>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f3f4f6;text-align:center;font-size:11px;color:#9ca3af">
      קיבלת מייל זה כי הגדרת התראה ב-LOOKLI •
      <a href="${SITE_URL_}" style="color:#c48cb3;text-decoration:none">לביטול כניסי לפרופיל</a>
    </div>
  </div>
</body></html>`;
  }

  try {
    const { rows: alerts } = await pool.query(`
      SELECT
        pa.id, pa.user_id, pa.product_source_url,
        pa.alert_price, pa.alert_size, pa.alert_color,
        pa.last_price, pa.last_sizes,
        u.email AS user_email,
        p.price AS current_price,
        p.sizes AS current_sizes,
        p.color_sizes AS current_color_sizes,
        p.title AS product_title,
        p.image_url AS product_image,
        p.store AS product_store
      FROM price_alerts pa
      JOIN users u ON u.id = pa.user_id
      LEFT JOIN products p ON p.source_url = pa.product_source_url
      WHERE pa.active = true
    `);

    console.log(`[check-alerts] התראות פעילות: ${alerts.length}`);
    let sent = 0;

    for (const alert of alerts) {
      const {
        id, user_email, product_source_url,
        alert_price, alert_size, alert_color,
        last_price, last_sizes,
        current_price, current_sizes, current_color_sizes,
        product_title, product_image, product_store,
      } = alert;

      const relevantSizes = alert_color && current_color_sizes?.[alert_color]
        ? current_color_sizes[alert_color]
        : current_sizes;

      // התראת מחיר
      if (alert_price && current_price && last_price) {
        const prev = parseFloat(last_price);
        const curr = parseFloat(current_price);
        if (curr < prev) {
          const ok = await sendAlertEmail(
            user_email,
            `💰 המחיר ירד! ${product_title}`,
            buildAlertEmail({ type:'price', title:product_title, image:product_image, store:product_store, oldVal:prev.toFixed(0), newVal:curr.toFixed(0), url:product_source_url })
          );
          if (ok) {
            sent++;
            await pool.query("UPDATE price_alerts SET last_price=$1, triggered_at=NOW() WHERE id=$2", [current_price, id]);
          }
        }
      }

      // התראת מידה
      if (alert_size && relevantSizes) {
        const prevSizes = last_sizes || [];
        const sizeBack = alert_size === 'any'
          ? relevantSizes.some(s => !prevSizes.includes(s))
          : relevantSizes.includes(alert_size) && !prevSizes.includes(alert_size);
        if (sizeBack) {
          const sizeLabel = alert_size === 'any' ? 'חדשה' : alert_size;
          const colorLabel = alert_color ? ` (${alert_color})` : '';
          const ok = await sendAlertEmail(
            user_email,
            `📦 מידה חזרה למלאי! ${product_title}`,
            buildAlertEmail({ type:'size', title:product_title, image:product_image, store:product_store, newVal:sizeLabel+colorLabel, url:product_source_url })
          );
          if (ok) {
            sent++;
            await pool.query("UPDATE price_alerts SET last_sizes=$1, triggered_at=NOW() WHERE id=$2", [relevantSizes, id]);
          }
        }
      }

      // עדכן last_price/last_sizes
      if (current_price || relevantSizes) {
        await pool.query(
          "UPDATE price_alerts SET last_price=COALESCE($1,last_price), last_sizes=COALESCE($2,last_sizes) WHERE id=$3",
          [current_price || null, relevantSizes || null, id]
        );
      }
    }

    console.log(`[check-alerts] ✅ נשלחו ${sent} התראות`);
    res.json({ ok: true, checked: alerts.length, sent });

  } catch(e) {
    console.error('[check-alerts] שגיאה:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== מדידת גודל תמונות (נטפרי) =====
// GET /api/admin/measure-images — מודד גודל תמונות לכל המוצרים ומעדכן image_size_bytes
app.get('/api/admin/measure-images', adminAuth, async (req, res) => {
  // הגדרות
  const BATCH = 20;        // בקשות מקביליות
  const TIMEOUT = 8000;    // ms לכל תמונה
  const MIN_BYTES = 500;   // פחות מזה = תמונה שבורה / חסומה

  try {
    // שלוף רק מוצרים שעדיין לא נמדדו (image_size_bytes = 0)
    const onlyUnmeasured = req.query.all !== '1';
    const rows = await pool.query(
      `SELECT id, image_url FROM products
       WHERE image_url IS NOT NULL AND image_url != ''
       ${onlyUnmeasured ? 'AND (image_size_bytes IS NULL OR image_size_bytes = 0)' : ''}
       ORDER BY id`
    );

    if (!rows.rows.length) {
      return res.json({ ok: true, message: 'כל המוצרים כבר נמדדו', total: 0 });
    }

    // שלח תגובה מיידית כי זה תהליך ארוך
    res.json({
      ok: true,
      message: `מתחיל מדידה של ${rows.rows.length} מוצרים ברקע...`,
      total: rows.rows.length,
      hint: 'עקוב אחרי הלוגים ב-Railway'
    });

    // הרץ ברקע
    (async () => {
      let updated = 0, failed = 0;
      const products = rows.rows;

      for (let i = 0; i < products.length; i += BATCH) {
        const batch = products.slice(i, i + BATCH);
        await Promise.all(batch.map(async (p) => {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT);
            const r = await fetch(p.image_url, {
              method: 'HEAD',
              signal: controller.signal
            });
            clearTimeout(timer);

            let bytes = 0;
            const cl = r.headers.get('content-length');
            if (cl) {
              bytes = parseInt(cl);
            } else {
              // HEAD לא החזיר content-length — GET ראשון כמה bytes
              const r2 = await fetch(p.image_url, { signal: controller.signal });
              const buf = await r2.arrayBuffer();
              bytes = buf.byteLength;
            }

            if (bytes > MIN_BYTES) {
              await pool.query(
                'UPDATE products SET image_size_bytes=$1 WHERE id=$2',
                [bytes, p.id]
              );
              updated++;
            } else {
              // סמן כחסום
              await pool.query(
                'UPDATE products SET image_size_bytes=$1 WHERE id=$2',
                [bytes || 1, p.id]
              );
              failed++;
            }
          } catch(e) {
            // timeout או שגיאה — סמן כ-1 (לא נמדד / חסום)
            await pool.query('UPDATE products SET image_size_bytes=1 WHERE id=$1', [p.id]);
            failed++;
          }
        }));
        console.log(`measure-images: ${Math.min(i+BATCH, products.length)}/${products.length} (✅${updated} ❌${failed})`);
      }
      console.log(`measure-images הושלם: ✅${updated} תמונות תקינות, ❌${failed} חסומות/שגויות`);
    })();

  } catch(e) {
    console.error('measure-images error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ===== Scraper Config API =====
// POST /api/admin/scraper-config/seed — מאכלס את ה-DB מהמפות הקיימות
app.post('/api/admin/scraper-config/seed', adminAuth, async (req, res) => {
  const allMaps = [
    ['color',    {'שחור':['שחור','שחורה','black'],'לבן':['לבן','לבנה','white'],'כחול':['כחול','כחולה','נייבי','navy','blue','indigo','denim'],'אדום':['אדום','אדומה','red','scarlet','crimson'],'ירוק':['ירוק','ירוקה','זית','חאקי','green','olive','khaki','sage','teal','army','hunter'],'חום':['חום','חומה','brown','chocolate','coffee','קפה','mocha'],'קאמל':['קאמל','camel','cognac'],"בז'":["בז'","בז",'nude','ניוד','beige','sand','taupe'],'אפור':['אפור','אפורה','gray','grey','charcoal','slate'],'ורוד':['ורוד','ורודה','pink','coral','קורל','blush','rose','fuchsia','salmon','פודרה','powder'],'בורדו':['בורדו','burgundy','wine','maroon','cherry'],'שמנת':['שמנת','cream','ivory','ecru','vanilla'],'סגול':['סגול','סגולה','לילך','purple','lilac','lavender','violet','plum','שזיף'],'צהוב':['צהוב','צהובה','חרדל','yellow','mustard','gold','lemon'],'כתום':['כתום','כתומה','orange','rust','tangerine'],'זהב':['זהב','golden'],'כסף':['כסף','כסוף','silver'],'תכלת':['תכלת','טורקיז','turquoise','aqua','cyan','sky'],'מנטה':['מנטה','mint'],'אפרסק':['אפרסק','peach','apricot'],'אבן':['אבן','stone'],'צבעוני':['צבעוני','מולטי','multi','multicolor','ססגוני']}],
    ['category', {'שמלה':['שמלה','שמלת','dress'],'חולצה':['חולצה','חולצת','טופ','top','shirt','blouse'],'חצאית':['חצאית','skirt'],'קרדיגן':['קרדיגן','cardigan'],'סוודר':['סוודר','sweater'],'טוניקה':['טוניקה','tunic'],'סרפן':['סרפן','pinafore'],"ז׳קט":["ז׳קט","ג׳קט",'jacket'],'בלייזר':['בלייזר','blazer'],'וסט':['וסט','vest'],'עליונית':['עליונית','שכמיה','cape'],'מעיל':['מעיל','coat'],'אוברול':['אוברול','jumpsuit'],'סט':['סט','set'],'בייסיק':['בייסיק','basic'],'חלוק':['חלוק','robe']}],
    ['style',    {'ערב':['ערב','שבת','שבתי','אירוע','חגיגי','אלגנט','elegant'],'יום חול':['יומיומי','יומיומית','קז׳ואל','casual'],'חגיגי':['חגיגי','חגיגית'],'אלגנטי':['אלגנט','אלגנטי'],'קלאסי':['קלאסי','קלאסית'],'מינימליסטי':['מינימליסט','מינימליסטי'],'מודרני':['מודרני','מודרנית'],'רטרו':['רטרו',"וינטג׳"],'אוברסייז':['אוברסייז','oversize']}],
    ['fit',      {'ארוכה':['מקסי','ארוכה','ארוך','maxi'],'מידי':['מידי','midi','אמצע'],'קצרה':['קצרה','קצר','מיני','mini'],'מעטפת':['מעטפת','wrap'],'צמודה':['צמוד','צמודה','fitted','bodycon'],'ישרה':['ישרה','straight'],'מתרחבת':['מתרחב','מתרחבת','flare'],'אוברסייז':['אוברסייז','oversize'],'הריון':['הריון','maternity'],'הנקה':['הנקה','nursing']}],
    ['fabric',   {'סריג':['סריג','knit'],"ג׳רסי":["ג׳רסי",'גרסי','jersey'],'שיפון':['שיפון','chiffon'],'קרפ':['קרפ','crepe'],'סאטן':['סאטן','satin'],'קטיפה':['קטיפה','velvet'],'פליז':['פליז','fleece'],'תחרה':['תחרה','lace'],'טול':['טול','tulle'],'לייקרה':['לייקרה','lycra'],'כותנה':['כותנה','cotton'],'פשתן':['פשתן','linen'],'משי':['משי','silk'],'צמר':['צמר','wool'],'ריקמה':['ריקמה','רקומה','embroidery']}],
    ['pattern',  {'פסים':['פסים','stripes'],'פרחוני':['פרחוני','פרחים','floral'],'משבצות':['משבצות','plaid','check'],'נקודות':['נקודות','dots','polka'],'חלק':['חלק','plain','solid'],'הדפס':['הדפס','print','מודפס']}],
  ];
  let inserted = 0, skipped = 0;
  for (const [type, map] of allMaps) {
    for (const [name, aliases] of Object.entries(map)) {
      try {
        const r = await pool.query(
          `INSERT INTO scraper_config (type, name, aliases) VALUES ($1,$2,$3) ON CONFLICT (type, name) DO NOTHING`,
          [type, name, aliases]
        );
        if (r.rowCount > 0) inserted++; else skipped++;
      } catch(e) { skipped++; }
    }
  }
  await loadSearchAliases();
  res.json({ ok: true, inserted, skipped });
});

app.get('/api/admin/scraper-config', adminAuth, async (req, res) => {
  const { type } = req.query;
  const q = type
    ? `SELECT * FROM scraper_config WHERE type=$1 ORDER BY name`
    : `SELECT id, type, name, aliases, color_hex, derived_tags FROM scraper_config ORDER BY type, name`;
  const r = await pool.query(q, type ? [type] : []);
  res.json({ ok: true, items: r.rows });
});

app.post('/api/admin/scraper-config', adminAuth, async (req, res) => {
  const { type, name, aliases = [], color_hex, derived_tags = {} } = req.body;
  if (!type || !name) return res.status(400).json({ error: 'type ו-name חובה' });
  const r = await pool.query(
    `INSERT INTO scraper_config (type, name, aliases, color_hex, derived_tags)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (type, name) DO UPDATE SET aliases=$3, color_hex=$4, derived_tags=$5, updated_at=NOW()
     RETURNING *`,
    [type, name, aliases, color_hex || null, JSON.stringify(derived_tags)]
  );
  await loadSearchAliases(); // רענון מיידי
  res.json({ ok: true, item: r.rows[0] });
});

// PUT /api/admin/scraper-config/:id — עדכון ערך קיים לפי id (כולל שינוי שם)
app.put('/api/admin/scraper-config/:id', adminAuth, async (req, res) => {
  const { name, aliases = [], color_hex, derived_tags = {} } = req.body;
  if (!name) return res.status(400).json({ error: 'name חובה' });
  try {
    const r = await pool.query(
      `UPDATE scraper_config SET name=$1, aliases=$2, color_hex=$3, derived_tags=$4, updated_at=NOW() WHERE id=$5 RETURNING *`,
      [name, aliases, color_hex || null, JSON.stringify(derived_tags), req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'לא נמצא' });
    await loadSearchAliases();
    res.json({ ok: true, item: r.rows[0] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// הערה: הסתרת מוצרים שלא נמצאים יותר (not_seen_count/hidden_stale) מתבצעת
// ישירות מתוך כל סקרייפר דרך reportScraperFinished() ב-scraper_utils.js
// (קריאה ישירה ל-DB, ללא צורך ב-endpoint נפרד)

// DELETE /api/admin/products/:id — בן מוצר לתמיד (banned=true)
app.delete('/api/admin/products/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'id חסר' });
    // יוצרים עמודה אם לא קיימת (idempotent)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`);
    await pool.query(`UPDATE products SET banned=true WHERE id=$1`, [id]);
    res.json({ ok: true, id });
  } catch(e) {
    console.error('ban-product error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/scraper-config/:id', adminAuth, async (req, res) => {
  await pool.query(`DELETE FROM scraper_config WHERE id=$1`, [req.params.id]);
  await loadSearchAliases(); // רענון מיידי
  res.json({ ok: true });
});

// POST /api/admin/retag-products — מתייג מחדש מוצרים קיימים לפי scraper_config הנוכחי
app.post('/api/admin/retag-products', adminAuth, async (req, res) => {
  try {
    // 1. טען config מה-DB
    const cfgRows = await pool.query(`SELECT type, name, aliases, derived_tags FROM scraper_config WHERE aliases IS NOT NULL AND array_length(aliases,1)>0`);
    const maps = { category:{}, style:{}, fit:{}, fabric:{}, pattern:{} };
    cfgRows.rows.forEach(r => { if (maps[r.type]) maps[r.type][r.name] = (r.aliases||[]).map(a=>a.toLowerCase()); });

    // פונקציית זיהוי לפי כותרת
    function detect(text, map) {
      const t = (text||'').toLowerCase();
      for (const [name, aliases] of Object.entries(map)) {
        if (aliases.some(a => t.includes(a))) return name;
      }
      return null;
    }

    // 2. שלוף מוצרים ללא תיוג ידני לכל שדה
    let updated = 0;

    // ─── תיוג צבעים ───────────────────────────────────────────────────
    // בנה lookup: alias → colorName מ-scraper_config
    const colorAliasMap = {}; // alias.lower → colorName
    cfgRows.rows.filter(r => r.type === 'color').forEach(r => {
      colorAliasMap[r.name.toLowerCase()] = r.name;
      (r.aliases||[]).forEach(a => { colorAliasMap[a.toLowerCase()] = r.name; });
    });

    if (Object.keys(colorAliasMap).length) {
      // derived_tags map: { type: { name: { field: [values] } } } — נטען מוקדם כדי שגם color יוכל להשתמש בו
      const derivedMap = {};
      cfgRows.rows.forEach(r => {
        if (r.derived_tags && Object.keys(r.derived_tags).length) {
          if (!derivedMap[r.type]) derivedMap[r.type] = {};
          derivedMap[r.type][r.name] = r.derived_tags;
        }
      });

      // מוצרים שהצבע שלהם לא נעול — ננסה לזהות מחדש מהכותרת
      const colorProds = await pool.query(
        `SELECT id, title, color FROM products
         WHERE NOT ('color' = ANY(COALESCE(tagged_fields, '{}')))`
      );
      for (const p of colorProds.rows) {
        const t = (p.title || '').toLowerCase();
        let found = null;
        for (const [alias, name] of Object.entries(colorAliasMap)) {
          if (alias.length >= 2 && t.includes(alias)) { found = name; break; }
        }
        if (found) {
          if (found !== p.color) {
            // עדכן צבע + הוסף 'color' ל-tagged_fields כדי שהסקרייפר לא ידרוס
            await pool.query(
              `UPDATE products SET color=$1,
                tagged_fields = array_append(array_remove(COALESCE(tagged_fields,'{}'), 'color'), 'color')
               WHERE id=$2`,
              [found, p.id]
            );
            updated++;
          }

          // החל derived_tags של הצבע — גם אם הצבע כבר היה נכון קודם
          // (רק אם השדה הנגזר ריק ולא נעול)
          const derived = derivedMap['color']?.[found] || {};
          for (const [df, dvals] of Object.entries(derived)) {
            if (!dvals?.length) continue;
            await pool.query(
              `UPDATE products SET ${df}=$1::text
               WHERE id=$2
                 AND (${df} IS NULL OR ${df} = '')
                 AND NOT ($3::text = ANY(COALESCE(tagged_fields, '{}')))`,
              [dvals[0], p.id, df]
            );
          }
        }
      }
    }

    // ─── שאר השדות ────────────────────────────────────────────────────
    const fields = ['category','style','fit','fabric','pattern'];

    for (const field of fields) {
      if (!Object.keys(maps[field]).length) continue;

      const prods = await pool.query(
        `SELECT id, title, description FROM products
         WHERE (${field} IS NULL OR ${field} = '')
           AND NOT ($1 = ANY(COALESCE(tagged_fields, '{}')))`,
        [field]
      );

      for (const p of prods.rows) {
        const val = detect((p.title||'') + ' ' + (p.description||''), maps[field]);
        if (val) {
          await pool.query(`UPDATE products SET ${field}=$1::text WHERE id=$2`, [val, p.id]);
          updated++;
          // החל derived_tags — רק אם השדה הנגזר ריק ולא נעול
          const derived = derivedMap[field]?.[val] || {};
          for (const [df, dvals] of Object.entries(derived)) {
            if (!dvals?.length) continue;
            await pool.query(
              `UPDATE products SET ${df}=$1::text
               WHERE id=$2
                 AND (${df} IS NULL OR ${df} = '')
                 AND NOT ($3::text = ANY(COALESCE(tagged_fields, '{}')))`,
              [dvals[0], p.id, df]
            );
          }
        }
      }
    }

    res.json({ ok: true, updated });
  } catch(e) {
    console.error('[retag]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== Search Phrases API =====
const DEFAULT_SEARCH_PHRASES = [
  'שמלה שחורה מידה M',
  'חולצה לבנה עד 150 ש"ח',
  'חצאית מקסי ירוקה',
  'קרדיגן בז׳ מידה L',
  'שמלת ערב בורדו',
  'חולצת שיפון ורודה',
  'סט צנוע לשבת',
  'שמלת מידי כחולה XL',
  'מעיל חום קלאסי',
  'חצאית פרחונית מידי',
];

app.get('/api/admin/search-phrases', adminAuth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT aliases FROM scraper_config WHERE type='search_phrases' AND name='typewriter' LIMIT 1`);
    const phrases = r.rows.length ? r.rows[0].aliases : DEFAULT_SEARCH_PHRASES;
    res.json({ phrases });
  } catch(e) { res.json({ phrases: DEFAULT_SEARCH_PHRASES }); }
});

app.post('/api/admin/search-phrases', adminAuth, async (req, res) => {
  try {
    const { phrases } = req.body;
    if (!Array.isArray(phrases)) return res.status(400).json({ error: 'phrases must be array' });
    await pool.query(`
      INSERT INTO scraper_config (type, name, aliases)
      VALUES ('search_phrases', 'typewriter', $1)
      ON CONFLICT (type, name) DO UPDATE SET aliases = $1
    `, [phrases]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/search-phrases', async (req, res) => {
  try {
    const r = await pool.query(`SELECT aliases FROM scraper_config WHERE type='search_phrases' AND name='typewriter' LIMIT 1`);
    const phrases = r.rows.length ? r.rows[0].aliases : DEFAULT_SEARCH_PHRASES;
    res.json({ phrases });
  } catch(e) { res.json({ phrases: DEFAULT_SEARCH_PHRASES }); }
});


app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await ensureEmailCampaignLog();
  // יצירת טבלת clicks אוטומטית אם לא קיימת
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS clicks (
      id SERIAL PRIMARY KEY,
      product_id INTEGER,
      store VARCHAR(50),
      product_title TEXT,
      source_url TEXT,
      user_agent TEXT,
      ip_address VARCHAR(100),
      clicked_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at DESC)`);

    // ── אינדקסים לביצועים על טבלת products (חיפוש/סינון איטי בלי זה) ──
    try {
      // אינדקס חלקי — רוב השאילתות מסננות תמיד banned=false/hidden_stale=false
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_visible ON products(id) WHERE (banned IS NULL OR banned = false) AND (hidden_stale IS NULL OR hidden_stale = false)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_store ON products(store)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_color ON products(color)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_style ON products(style)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_fit ON products(fit)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_fabric ON products(fabric)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_pattern ON products(pattern)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_price ON products(price)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_colors_gin ON products USING GIN(colors)`);
      // pg_trgm — מאיץ באופן דרמטי חיפוש title ILIKE '%...%' (בלי זה זו סריקה מלאה בכל חיפוש טקסט חופשי)
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_title_trgm ON products USING GIN(title gin_trgm_ops)`);
      // אינדקס פונקציונלי לחיפוש מוצר לפי slug (כתובת URL) — משמש בכל טעינת עמוד מוצר
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_slug ON products (lower(regexp_replace(title, '[^\\u05D0-\\u05EAa-zA-Z0-9]+', '-', 'g')))`);
      // עמודות לזיהוי/סקירת מוצרים עם תמונות חסומות (נטפרי):
      // has_valid_image - סופי, true אם יש לפחות תמונה תקינה אחת
      // reviewed_at - מתי נסקר ידנית (NULL = עוד לא נסקר בכלי הסקירה)
      // valid_image_urls - אילו תמונות ספציפיות סומנו כתקינות בסקירה הידנית
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS has_valid_image BOOLEAN DEFAULT true`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP DEFAULT NULL`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS valid_image_urls TEXT[] DEFAULT NULL`);
      // מעקב פסיבי: אילו תמונות נבדקו בפועל בדפדפן של גולשות (תקין/חסום), נאסף אוטומטית תוך כדי גלישה רגילה
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_check_results JSONB DEFAULT '{}'::jsonb`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_valid_image ON products(has_valid_image) WHERE has_valid_image = false`);
      // אינדקס למיון לפי פופולריות (ממיין לפי ספירת קליקים לכל מוצר)
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_clicks_source_url ON clicks(source_url)`);
      // מעדכן את סטטיסטיקות התכנון של Postgres מיד, כדי שהאינדקסים החדשים ינוצלו כבר מההרצה הראשונה
      await pool.query(`ANALYZE products`);
      await pool.query(`ANALYZE clicks`);
      console.log('✅ אינדקסי products מוכנים');
    } catch(e) {
      console.log('⚠️ יצירת אינדקסי products נכשלה (לא קריטי, השרת ממשיך):', e.message.substring(0,100));
    }

    // טבלת טוקני תצוגה זמניים
    await pool.query(`CREATE TABLE IF NOT EXISTS preview_tokens (
      token VARCHAR(64) PRIMARY KEY,
      note TEXT,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    // migrations
    await pool.query(`ALTER TABLE sidebar_ads ADD COLUMN IF NOT EXISTS show_rate INTEGER DEFAULT 100`);
    await pool.query(`ALTER TABLE sidebar_ads ADD COLUMN IF NOT EXISTS mobile_banner BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE sidebar_ads ADD COLUMN IF NOT EXISTS mobile_image_url TEXT`);
    await pool.query(`ALTER TABLE sidebar_ads ADD COLUMN IF NOT EXISTS every_n INTEGER DEFAULT 6`);
    await pool.query(`ALTER TABLE sidebar_ads ADD COLUMN IF NOT EXISTS display_target TEXT DEFAULT 'both'`);
    await pool.query(`ALTER TABLE sidebar_ads ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 10`);
    // תמחור פרסום — שורה יחידה קבועה (id=1), ניתנת לעריכה מלאה דרך /admin/pricing.
    // המחירים ההתחלתיים מבוססים על בנצ'מרק שוק לאתרים נישתיים קטנים/בצמיחה (לא אתרי ענק) —
    // ניתן ועדיף לכוונן אותם בפועל לפי הביקוש וההמרה בפועל.
    await pool.query(`CREATE TABLE IF NOT EXISTS ad_pricing_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      base_rates JSONB NOT NULL,
      duration_tiers JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`
      INSERT INTO ad_pricing_config (id, base_rates, duration_tiers)
      VALUES (1, $1, $2)
      ON CONFLICT (id) DO NOTHING`,
      [
        JSON.stringify({ single: 25, double: 45, triple: 65, mobile_banner: 35, sponsored_product: 40 }),
        JSON.stringify([
          { days: 7,  label: 'שבוע',    discount: 0 },
          { days: 14, label: 'שבועיים', discount: 10 },
          { days: 30, label: 'חודש',    discount: 20 },
          { days: 90, label: '3 חודשים', discount: 35 },
        ]),
      ]
    );
    // אם השורה כבר קיימת משימוש קודם (לפני שנוסף מוצר ממומן) — מוסיפים לה רק את המפתח החדש,
    // בלי לדרוס מחירים אחרים שכבר נערכו ידנית דרך /admin/pricing
    await pool.query(`
      UPDATE ad_pricing_config
      SET base_rates = base_rates || '{"sponsored_product": 40}'::jsonb
      WHERE id = 1 AND NOT (base_rates ? 'sponsored_product')`);
    await pool.query(`ALTER TABLE sponsored_products ADD COLUMN IF NOT EXISTS show_rate INTEGER DEFAULT 100`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS color_images JSONB`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS first_seen TIMESTAMP`);
    await pool.query(`UPDATE products SET first_seen = created_at WHERE first_seen IS NULL`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_dropped_at TIMESTAMP`);
    await pool.query(`UPDATE products SET price_dropped_at = updated_at WHERE price_dropped_at IS NULL AND original_price IS NOT NULL AND original_price > price * 1.10`);
    await pool.query(`DROP TABLE IF EXISTS image_cache`).catch(()=>{});
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE`).catch(()=>{});
    await pool.query(`ALTER TABLE scraper_config ADD COLUMN IF NOT EXISTS derived_tags JSONB DEFAULT '{}'`).catch(()=>{});
    // הרחב עמודות VARCHAR קצרות מדי ב-products
    for (const col of ['store','color','style','fit','category','fabric','pattern','description']) {
      await pool.query(`ALTER TABLE products ALTER COLUMN ${col} TYPE TEXT`).catch(()=>{});
    }
    console.log('[init] ✅ products columns widened to TEXT');

    // ── מנגנון הסתרת מוצרים שלא נמצאים יותר באתר המקור ──────────────
    // not_seen_count: כמה הרצות רצופות המוצר לא עודכן
    // hidden_stale: true = מוסתר מהאתר (אבל לא נמחק מה-DB)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS not_seen_count INTEGER DEFAULT 0`).catch(()=>{});
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS hidden_stale BOOLEAN DEFAULT false`).catch(()=>{});
    console.log('[init] ✅ עמודות not_seen_count / hidden_stale מוכנות');

    // ── styles[] — מאפשר להחיל כמה סגנונות על אותו מוצר (כמו fits[] ו-colors[]) ──
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS styles TEXT[] DEFAULT '{}'`).catch(()=>{});
    console.log('[init] ✅ עמודת styles[] מוכנה');
    await pool.query(`CREATE TABLE IF NOT EXISTS scraper_config (
      id SERIAL PRIMARY KEY,
      type VARCHAR(30) NOT NULL,
      name VARCHAR(100) NOT NULL,
      aliases TEXT[] DEFAULT '{}',
      derived_tags JSONB DEFAULT '{}',
      color_hex VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(type, name)
    )`);
    // הרחב color_hex מ-VARCHAR(20) ל-TEXT — דוגמאות הדפס (מנומר/פרחוני) הן SVG מוטמע
    // שאורכן אלפי תווים, וVARCHAR(20) המקורי היה דוחה אותן בשקט (value too long)
    await pool.query(`ALTER TABLE scraper_config ALTER COLUMN color_hex TYPE TEXT`).catch(()=>{});
    // טען aliases לחיפוש אחרי שהטבלה קיימת
    await loadSearchAliases();

    // ── Trigger: הגן על שדות שתויגו ידנית מפני דריסת סקרייפרים ─────
    await pool.query(`
      CREATE OR REPLACE FUNCTION protect_tagged_fields()
      RETURNS TRIGGER AS $$
      DECLARE
        f TEXT;
        is_tagger BOOLEAN;
      BEGIN
        BEGIN
          is_tagger := current_setting('app.is_tagger_update', true) = 'true';
        EXCEPTION WHEN OTHERS THEN
          is_tagger := false;
        END;
        IF is_tagger THEN RETURN NEW; END IF;
        IF OLD.tagged_fields IS NOT NULL AND array_length(OLD.tagged_fields, 1) > 0 THEN
          FOREACH f IN ARRAY OLD.tagged_fields LOOP
            IF f = 'color'          THEN NEW.color          := OLD.color; NEW.colors := OLD.colors;
            ELSIF f = 'style'          THEN NEW.style          := OLD.style; NEW.styles := OLD.styles;
            ELSIF f = 'fit'            THEN NEW.fit            := OLD.fit; NEW.fits := OLD.fits;
            ELSIF f = 'fabric'         THEN NEW.fabric         := OLD.fabric;
            ELSIF f = 'pattern'        THEN NEW.pattern        := OLD.pattern;
            ELSIF f = 'category'       THEN NEW.category       := OLD.category;
            ELSIF f = 'design_details' THEN NEW.design_details := OLD.design_details;
            END IF;
          END LOOP;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`DROP TRIGGER IF EXISTS trg_protect_tagged_fields ON products`);
    await pool.query(`
      CREATE TRIGGER trg_protect_tagged_fields
      BEFORE UPDATE ON products
      FOR EACH ROW EXECUTE FUNCTION protect_tagged_fields();
    `);
    console.log('[init] ✅ trigger protect_tagged_fields פעיל');
  } catch(e) { console.error('clicks table init:', e.message); }

  // ── תזכורת due-date — בדיקה כל 30 דקות ──────────────────────────
  startDueReminderLoop();
});

// ── לולאת תזכורת יומיים לפני due date ────────────────────────────────
// בודקת כל 30 דקות. שומרת ב-admin_store (key='tasks_due_reminder_sent')
// את תאריך השליחה — כך reboot/deploy לא גורם לשליחה כפולה.
// שולחת רק בין 07:00-21:00 שעון ישראל.

async function runDueReminderCheck() {
  try {
    const NOTIFY    = process.env.ADMIN_NOTIFY_EMAIL;
    const SITE_URL_ = process.env.SITE_URL || 'https://lookli.co.il';
    if (!NOTIFY || !process.env.RESEND_API_KEY) return;

    // שעון ישראל
    const nowIL  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    const hour   = nowIL.getHours();
    if (hour < 7 || hour >= 21) return; // לא שולחים בלילה

    const todayStr = nowIL.toISOString().slice(0, 10); // YYYY-MM-DD

    // שלוף סטייט שליחות ונתוני משימות פעם אחת
    const [sentRows, taskRows] = await Promise.all([
      pool.query(`SELECT key, value FROM admin_store WHERE key IN ('tasks_due_reminder_2day','tasks_due_reminder_1day')`),
      pool.query(`SELECT value FROM admin_store WHERE key='tasks_data'`),
    ]);
    const sentMap = Object.fromEntries(sentRows.rows.map(r => [r.key, r.value]));
    const tasks   = taskRows.rows[0]?.value?.tasks || [];

    // בנה תאריכי יעד לשתי התזכורות
    const d2 = new Date(nowIL); d2.setDate(nowIL.getDate() + 2);
    const d1 = new Date(nowIL); d1.setDate(nowIL.getDate() + 1);
    const str2 = d2.toISOString().slice(0, 10);
    const str1 = d1.toISOString().slice(0, 10);

    // שלח כל תזכורת שעדיין לא נשלחה היום
    await sendDueReminder({ tasks, todayStr, targetStr: str2, daysLabel: 'יומיים', storeKey: 'tasks_due_reminder_2day', sentMap, NOTIFY, SITE_URL_, headerColor: 'linear-gradient(135deg,#f59e0b,#ef4444)' });
    await sendDueReminder({ tasks, todayStr, targetStr: str1, daysLabel: 'יום', storeKey: 'tasks_due_reminder_1day', sentMap, NOTIFY, SITE_URL_, headerColor: 'linear-gradient(135deg,#ef4444,#dc2626)' });

  } catch(e) {
    console.error('[tasks-due] שגיאה:', e.message);
  }
}

async function sendDueReminder({ tasks, todayStr, targetStr, daysLabel, storeKey, sentMap, NOTIFY, SITE_URL_, headerColor }) {
  // אם כבר שלחנו היום — דלג
  if (sentMap[storeKey]?.date === todayStr) return;

  const due = tasks.filter(t => !t.done && t.due === targetStr);

  // סמן שבדקנו היום בכל מקרה — למנוע בדיקות חוזרות
  await pool.query(
    `INSERT INTO admin_store (key, value, updated_at) VALUES ('${storeKey}', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
    [JSON.stringify({ date: todayStr, sent: due.length })]
  );

  if (!due.length) {
    console.log(`[tasks-due] אין משימות ל-${targetStr} (בעוד ${daysLabel}) — לא נשלח`);
    return;
  }

  const dateLabel = targetStr.split('-').reverse().join('/');

  const tableRows = due.map(t => {
    const pr = t.priority === 'high' ? '🔴 גבוהה' : t.priority === 'low' ? '🟢 נמוכה' : '🟡 בינונית';
    const td = (v, extra='') => `<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px${extra}">${v}</td>`;
    return '<tr>' +
      td(t.title || '', ';font-weight:600') +
      td(t.person || '—', ';color:#6b7280;font-size:12px') +
      td(pr, ';font-size:12px') +
      td((t.progress || 0) + '%', ';color:#6b7280;font-size:12px') +
      '</tr>';
  }).join('');

  const html =
    '<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/></head>' +
    '<body style="margin:0;padding:0;background:#f9f9f9;font-family:Heebo,Arial,sans-serif;direction:rtl">' +
    '<div style="max-width:580px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;' +
      'box-shadow:0 4px 24px rgba(0,0,0,.08);border:1px solid #e5e7eb">' +
      '<div style="background:' + headerColor + ';padding:20px 24px">' +
        '<div style="font-size:22px;font-weight:900;color:#fff">LOOKLI</div>' +
        '<div style="font-size:13px;color:rgba(255,255,255,.85)">⏰ תזכורת — משימות שמסתיימות בעוד ' + daysLabel + ' (' + dateLabel + ')</div>' +
      '</div>' +
      '<div style="padding:20px 24px">' +
        '<p style="color:#1f2937;font-size:14px;margin-bottom:16px">' + due.length + ' משימות פתוחות מסתיימות ב-' + dateLabel + ':</p>' +
        '<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">' +
          '<thead><tr style="background:#fef3c7">' +
            '<th style="padding:8px 12px;text-align:right;font-size:11px;color:#92400e">משימה</th>' +
            '<th style="padding:8px 12px;text-align:right;font-size:11px;color:#92400e">אחראי</th>' +
            '<th style="padding:8px 12px;text-align:right;font-size:11px;color:#92400e">עדיפות</th>' +
            '<th style="padding:8px 12px;text-align:right;font-size:11px;color:#92400e">התקדמות</th>' +
          '</tr></thead>' +
          '<tbody style="color:#374151">' + tableRows + '</tbody>' +
        '</table>' +
        '<a href="' + SITE_URL_ + '/admin/tasks" style="display:inline-block;margin-top:18px;' +
          'background:' + headerColor + ';color:#fff;padding:10px 20px;' +
          'border-radius:8px;font-weight:700;font-size:13px;text-decoration:none">פתח לוח משימות</a>' +
      '</div>' +
    '</div></body></html>';

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'LOOKLI משימות <noreply@lookli.co.il>',
      to: NOTIFY.split(',').map(e => e.trim()),
      subject: `⏰ תזכורת: ${due.length} משימות מסתיימות בעוד ${daysLabel} (${dateLabel})`,
      html,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) { console.error(`[tasks-due] Resend error (${storeKey}):`, JSON.stringify(data)); return; }
  console.log(`[tasks-due] ✅ ${daysLabel} לפני — נשלח: ${due.length} משימות → ${NOTIFY}`);
}

function startDueReminderLoop() {
  // הרצה ראשונה אחרי 2 דקות (לתת לשרת לעלות)
  setTimeout(() => {
    runDueReminderCheck();
    setInterval(runDueReminderCheck, 30 * 60 * 1000); // כל 30 דקות
  }, 2 * 60 * 1000);
  console.log('[tasks-due] לולאת תזכורות הופעלה (כל 30 דקות, 07:00–21:00)');
}