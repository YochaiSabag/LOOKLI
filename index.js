console.log("BOOT DEBUG ROUTE VERSION 1");
import express from "express";
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
app.set('trust proxy', 1); // Railway רץ מאחורי proxy

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
});

app.use(express.json());

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
      `SELECT id, title, last_seen FROM products WHERE title IS NOT NULL ORDER BY last_seen DESC`
    );

    const staticUrls = [
      { loc: `${base}/`, priority: '1.0', changefreq: 'daily' },
      { loc: `${base}/about.html`, priority: '0.5', changefreq: 'monthly' },
      { loc: `${base}/contact.html`, priority: '0.5', changefreq: 'monthly' },
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

    if (!product) return res.sendFile(path.join(__dirname, "public", "index.html"));

    // בנה HTML עם OG tags מלאים
    const base = process.env.SITE_URL || 'https://www.lookli.co.il';
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
      `<meta property="og:title" content="${title} – LOOKLI"/>
<meta property="og:description" content="${desc.substring(0,200)}"/>
<meta property="og:image" content="${img}"/>
<meta property="og:url" content="${url}"/>
<meta property="og:type" content="product"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${title} – LOOKLI"/>
<meta name="twitter:image" content="${img}"/>
<title>${title} – LOOKLI</title>
</head>`
    );
    res.send(indexHtml);
  } catch(err) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Image Proxy — מגיש תמונות חיצוניות עם cache (מאיץ נייד)
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

    const imgRes = await fetch(url);
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

app.get("/api/filters", async (req, res) => {
  try {
    const { store, category, color, size, style, fit, fabric, pattern, design } = req.query;
    let baseWhere = '1=1';
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

    const validColorSet = new Set(validColors);
    res.json({
      stores: storesRes.rows.map(r => r.store).filter(Boolean),
      sizes: sizesRes.rows.map(r => r.size).filter(Boolean),
      colors: colorsRes.rows.map(r => r.color).filter(c => c && validColorSet.has(c)),
      styles: stylesRes.rows.map(r => r.style).filter(Boolean),
      fits: fitsRes.rows.map(r => r.fit).filter(Boolean),
      categories: categoriesRes.rows.map(r => r.category).filter(Boolean),
      patterns: patternsRes.rows.map(r => r.pattern).filter(Boolean),
      fabrics: fabricsRes.rows.map(r => r.fabric).filter(Boolean),
      designs: designRes.rows.map(r => r.detail).filter(Boolean),
      maxPrice: Math.ceil(parseFloat(maxPriceRes.rows[0]?.max_price) || 500)
    });
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
    const r = await pool.query(`SELECT type, name, aliases FROM scraper_config WHERE aliases IS NOT NULL`);
    r.rows.forEach(row => {
      (row.aliases || []).forEach(alias => {
        const key = alias.toLowerCase().trim();
        if (!SEARCH_ALIASES[key]) SEARCH_ALIASES[key] = { name: row.name, type: row.type };
      });
      // גם השם עצמו
      SEARCH_ALIASES[row.name.toLowerCase()] = { name: row.name, type: row.type };
    });
    // הוסף גם COLOR_ALIASES
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
    let sql = `SELECT id, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, store, source_url, description, pattern, fabric, design_details, color_sizes, image_size_bytes FROM products WHERE 1=1`;
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
    if (style) { 
      const styles = style.split(',').filter(Boolean);
      if (styles.length === 1) {
        const s = styles[0];
        if (s === '\u05d9\u05d5\u05dd \u05d7\u05d5\u05dc') {
          sql += ` AND (style = $${i} OR style = '\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9' OR title ILIKE '%\u05d9\u05d5\u05dd \u05d7\u05d5\u05dc%' OR title ILIKE '%\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9%' OR title ILIKE '%\u05d9\u05d5\u05dd \u05d9\u05d5\u05dd%' OR description ILIKE '%\u05d9\u05d5\u05dd \u05d7\u05d5\u05dc%' OR description ILIKE '%\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9%')`;
          params.push(s); i++;
        } else if (s === '\u05e9\u05d1\u05ea/\u05e2\u05e8\u05d1') {
          sql += ` AND (style IN ('\u05e2\u05e8\u05d1','\u05d7\u05d2\u05d9\u05d2\u05d9','\u05d0\u05dc\u05d2\u05e0\u05d8\u05d9','\u05e9\u05d1\u05ea') OR title ILIKE '%\u05e9\u05d1\u05ea%' OR title ILIKE '%\u05e2\u05e8\u05d1%' OR title ILIKE '%\u05d7\u05d2\u05d9\u05d2%' OR title ILIKE '%\u05d0\u05dc\u05d2\u05e0\u05d8%')`;
        } else {
          sql += ` AND (style = $${i} OR title ILIKE $${i+1})`; params.push(s, `%${s}%`); i += 2;
        }
      } else {
        const orParts = styles.map((_, idx) => `style = $${i + idx} OR title ILIKE $${i + styles.length + idx}`);
        sql += ` AND (${orParts.join(' OR ')})`;
        styles.forEach(s2 => params.push(s2));
        styles.forEach(s2 => params.push(`%${s2}%`));
        i += styles.length * 2;
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

    if (sort === 'price_asc') {
    } else if (sort === 'price_desc') {
      sql += ` ORDER BY price DESC`;
    } else if (sort === 'popular') {
      sql += ` ORDER BY (SELECT COUNT(*) FROM clicks WHERE clicks.source_url = products.source_url) DESC, id DESC`;
    } else if (isAliasMatch && q) {
      // כינוי צבע: מוצרים עם השם המדויק בכותרת קודם, שאר לפי id
      sql += ` ORDER BY (CASE WHEN title ILIKE $${i} THEN 0 ELSE 1 END), id DESC`;
      params.push(`%${q}%`); i++;
    } else {
      sql += ` ORDER BY (id % 7), id DESC`;
    }
    sql += ` LIMIT 2000`;

    const result = await pool.query(sql, params);
    let rows = result.rows;
    
    // סינון color+size ב-JS: אם שניהם צוינו, נבדוק ב-color_sizes שהצבע זמין במידה
    if (color && size) {
      const sizeList = size.split(',').filter(Boolean);
      const allExpandedSizes = [];
      sizeList.forEach(s => expandSize(s).forEach(es => { if (!allExpandedSizes.includes(es)) allExpandedSizes.push(es); }));
      const colorList = color.split(',').filter(Boolean);
      rows = rows.filter(p => {
        if (!p.color_sizes) return true; // אין מידע - מציג
        try {
          const cs = typeof p.color_sizes === 'string' ? JSON.parse(p.color_sizes) : p.color_sizes;
          if (!cs || Object.keys(cs).length === 0) return true;
          // Check if ANY selected color has ANY selected size
          return colorList.some(c => {
            const colorSizes = cs[c];
            if (!colorSizes) return false;
            return allExpandedSizes.some(sz => colorSizes.includes(sz));
          });
        } catch(e) { return true; }
      });
    }
    
    res.json(rows.map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) })));
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
      if (result.rows.length) {
        const product = result.rows[0];
        product.shipping = calculateShipping(product.store, product.price);
        return res.json(product);
      }
    }
    // חפש לפי slug — השווה את ה-title מנורמל
    const result = await pool.query(`SELECT * FROM products WHERE id = $1`, [0]); // placeholder
    // חיפוש אמיתי — title → slug
    const all = await pool.query(
      `SELECT * FROM products WHERE lower(regexp_replace(title, '[^\\u05D0-\\u05EAa-zA-Z0-9]+', '-', 'g')) = $1 LIMIT 1`,
      [slug.toLowerCase()]
    );
    if (!all.rows.length) return res.status(404).json({ error: "Not found" });
    const product = all.rows[0];
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
    
    let sql = `SELECT id, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, store, source_url, description, pattern, fabric, design_details, color_sizes, image_size_bytes FROM products WHERE 1=1`;
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
    if (analysis.category) { sql += ` AND (category = $${i} OR title ILIKE $${i+1})`; params.push(analysis.category, `%${analysis.category}%`); i += 2; }
    if (analysis.style) { sql += ` AND (style = $${i} OR title ILIKE $${i+1})`; params.push(analysis.style, `%${analysis.style}%`); i += 2; }
    if (analysis.fit) { sql += ` AND (fit = $${i} OR title ILIKE $${i+1})`; params.push(analysis.fit, `%${analysis.fit}%`); i += 2; }
    if (analysis.fabric) { sql += ` AND (fabric = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(analysis.fabric, `%${analysis.fabric}%`); i += 2; }
    if (analysis.pattern) { sql += ` AND (pattern = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(analysis.pattern, `%${analysis.pattern}%`); i += 2; }
    if (analysis.designDetails.length > 0) { sql += ` AND $${i++} = ANY(design_details)`; params.push(analysis.designDetails[0]); }
    if (analysis.maxPrice) { sql += ` AND price <= $${i++}`; params.push(analysis.maxPrice); }
    if (analysis.minDiscount) { sql += ` AND original_price > 0 AND ((original_price - price) / original_price * 100) >= $${i++}`; params.push(analysis.minDiscount); }

    sql += ` ORDER BY id DESC LIMIT 100`;
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

function analyzeQuery(query) {
  const analysis = { keywords: [], color: null, size: null, style: null, fit: null, category: null, maxPrice: null, minDiscount: null, pattern: null, fabric: null, designDetails: [], store: null };
  
  const priceMatch = query.match(/\u05e2\u05d3\s*\u20aa?\s*(\d+)|(\d+)\s*\u20aa|(\d+)\s*\u05e9"?\u05d7/i);
  if (priceMatch) analysis.maxPrice = parseInt(priceMatch[1] || priceMatch[2] || priceMatch[3]);
  
  const discountMatch = query.match(/(\d+)\s*%/i);
  if (discountMatch) analysis.minDiscount = parseInt(discountMatch[1]);

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
  const stopWords = new Set(['מידה', 'מידות', 'עד', 'של', 'עם', 'בלי', 'ללא', 'או', 'גם', 'רק', 'כל', 'את', 'זה', 'זו', 'הנחה', 'מבצע', 'sale', 'לי', 'אני', 'רוצה', 'מחפשת', 'מחפש', 'צבע', 'סגנון', 'גיזרה', 'בד', 'דוגמא', 'מחיר', 'שקל', 'שקלים', 'ש"ח', 'שח', 'אורך', 'באורך', 'חנות', 'באתר', 'מאתר', 'ב', 'מ']);
  // קטגוריות שלא מציגים (אקססוריז)
  const excludedCategories = new Set(['גומיות', 'גומייה', 'אקססוריז', 'אביזרים', 'תכשיטים', 'כובעים', 'צעיפים', 'תיקים']);


  // === שלב 1: בדיקת ביטויים רב-מילתיים BEFORE פירוק למילים ===
  const fullText = processedQuery.replace(/\u05e2\u05d3\s*\u20aa?\s*\d+/gi, '').replace(/\d+\s*\u20aa/gi, '').replace(/\d+\s*%/gi, '').trim();
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

  const text = processedQuery.replace(/\u05e2\u05d3\s*\u20aa?\s*\d+/gi, '').replace(/\d+\s*\u20aa/gi, '').replace(/\d+\s*%/gi, '').trim();
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
    
    // חנות
    if (!matched) {
      for (const [name, variants] of Object.entries(storeMap)) {
        if (variants.some(v => lower === v.toLowerCase()) || lower === name.toLowerCase()) { if (!analysis.store) analysis.store = name; matched = true; break; }
      }
    }
    if (!matched) {
    for (const [name, variants] of Object.entries(colorMap)) {
      if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.color) analysis.color = name; matched = true; break; }
    }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(categoryMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.category) analysis.category = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(styleMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.style) analysis.style = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(fitMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.fit) analysis.fit = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(fabricMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.fabric) analysis.fabric = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(patternMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.pattern) analysis.pattern = name; matched = true; break; }
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
    const r = await pool.query("SELECT * FROM sidebar_ads ORDER BY active DESC, created_at DESC");
    res.json({ ads: r.rows });
  } catch(e) { res.json({ ads: [] }); }
});

// POST /api/sidebar-ads/create
app.post("/api/sidebar-ads/create", adminAuth, async (req, res) => {
  try {
    const { title, image_url, link_url, caption, size=1, impression_weight=10, show_rate=100, days=0, starts_in=0, price_paid=null, notes=null } = req.body;
    let expires_at = null, starts_at = null;
    if (days > 0) { const d=new Date(); d.setDate(d.getDate()+days); expires_at=d.toISOString(); }
    if (starts_in > 0) { const d=new Date(); d.setDate(d.getDate()+starts_in); starts_at=d.toISOString(); }
    const r = await pool.query(
      `INSERT INTO sidebar_ads (title,image_url,link_url,caption,size,impression_weight,show_rate,expires_at,starts_at,price_paid,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [title,image_url,link_url,caption,size,impression_weight,show_rate??100,expires_at,starts_at,price_paid,notes]
    );
    res.json({ id: r.rows[0].id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/sidebar-ads/:id
app.put("/api/sidebar-ads/:id", adminAuth, async (req, res) => {
  try {
    const { title, image_url, link_url, caption, size, impression_weight, show_rate, days, price_paid, notes } = req.body;
    let expires_at = null;
    if (days > 0) { const d=new Date(); d.setDate(d.getDate()+days); expires_at=d.toISOString(); }
    await pool.query(
      `UPDATE sidebar_ads SET title=$2,image_url=$3,link_url=$4,caption=$5,size=$6,
       impression_weight=$7,show_rate=$8,expires_at=$9,price_paid=$10,notes=$11 WHERE id=$1`,
      [req.params.id, title, image_url, link_url, caption, size, impression_weight, show_rate??100, expires_at, price_paid, notes]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/sidebar-ads/:id/activate|deactivate
app.post("/api/sidebar-ads/:id/activate", adminAuth, async(req,res)=>{ await pool.query("UPDATE sidebar_ads SET active=true  WHERE id=$1",[req.params.id]); res.json({ok:true}); });
app.post("/api/sidebar-ads/:id/deactivate", adminAuth, async(req,res)=>{ await pool.query("UPDATE sidebar_ads SET active=false WHERE id=$1",[req.params.id]); res.json({ok:true}); });

// DELETE /api/sidebar-ads/:id
app.delete("/api/sidebar-ads/:id", adminAuth, async(req,res)=>{ await pool.query("DELETE FROM sidebar_ads WHERE id=$1",[req.params.id]); res.json({ok:true}); });

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

// POST /api/newsletter/unsubscribe
app.post("/api/newsletter/unsubscribe", async (req, res) => {
  try {
    const { email } = req.body;
    await pool.query("UPDATE newsletter_subscribers SET active=false WHERE email=$1", [email]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'שגיאה' }); }
});

// GET /api/newsletter/list  (מוגן — רק לשימוש פנימי)
app.get("/api/newsletter/list", adminAuth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT email, source, created_at FROM newsletter_subscribers WHERE active=true ORDER BY created_at DESC"
    );
    res.json({ count: r.rowCount, subscribers: r.rows });
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

// POST /api/auth/google — התחברות עם Google
app.post("/api/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
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
      // הרשמה אוטומטית
      const result = await pool.query(
        'INSERT INTO users (email, name, password_hash, newsletter, created_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING *',
        [emailLower, name || emailLower.split('@')[0], 'google_oauth_' + googleId, true]
      );
      user = result.rows[0];
    }

    const token = createToken(user.id, user.email);

    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('google auth error:', err.message);
    res.status(500).json({ error: "שגיאת שרת" });
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

app.get('/api/analytics', adminAuth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 28;
    const dateRange = [{ startDate: `${days}daysAgo`, endDate: 'today' }];
    const token = await getGA4Token();

    // סשנים, משתמשים, צפיות
    const [overview, daily, outbound] = await Promise.all([
      ga4Query(token, {
        dateRanges: dateRange,
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }]
      }),
      ga4Query(token, {
        dateRanges: dateRange,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }]
      }),
      ga4Query(token, {
        dateRanges: dateRange,
        dimensions: [{ name: 'eventName' }, { name: 'linkUrl' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'outbound_click' } } }
      })
    ]);

    const totals = {
      sessions: overview.rows?.[0]?.metricValues?.[0]?.value || 0,
      users: overview.rows?.[0]?.metricValues?.[1]?.value || 0,
      pageViews: overview.rows?.[0]?.metricValues?.[2]?.value || 0,
      outboundClicks: 0
    };

    const dailyData = (daily.rows || []).map(r => ({
      date: r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
      sessions: parseInt(r.metricValues[0].value)
    }));

    // קליקים לפי חנות מה-URL
    const storeMap = {};
    const STORES = { 'mima.co.il':'MIMA', 'mekimi.co.il':'MEKIMI', 'lichi.com':'LICHI', 'aviyah.co.il':'AVIYAH', 'chemise.co.il':'CHEMISE' };
    (outbound.rows || []).forEach(r => {
      const url = r.dimensionValues[1]?.value || '';
      const count = parseInt(r.metricValues[0].value);
      totals.outboundClicks += count;
      for (const [domain, name] of Object.entries(STORES)) {
        if (url.includes(domain)) {
          storeMap[name] = (storeMap[name] || 0) + count;
        }
      }
    });

    const stores = Object.entries(storeMap)
      .map(([name, clicks]) => ({ name, clicks }))
      .sort((a,b) => b.clicks - a.clicks);

    // מוצרים מה-DB
    const topProducts = [];
    try {
      const dbClicks = await pool.query(
        `SELECT product_title, store, COUNT(*) as clicks FROM clicks GROUP BY product_title, store ORDER BY clicks DESC LIMIT 20`
      );
      dbClicks.rows.forEach(r => topProducts.push({ title: r.product_title, store: r.store, clicks: parseInt(r.clicks) }));
    } catch(e) {}

    res.json({ totals, daily: dailyData, stores, topProducts });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/analytics', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_analytics.html')));
app.get('/admin/tasks', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_tasks.html')));
app.get('/admin/tagger', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_tagger.html')));
app.get('/admin/config', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin_config.html')));

// ===== TAGGER API =====
app.patch('/api/admin/tag-products', adminAuth, async (req, res) => {
  try {
    const { ids, field, value } = req.body;
    if (!ids?.length || !field || value === undefined) return res.status(400).json({ error: 'חסרים פרמטרים' });
    const ALLOWED = ['style','category','fit','fabric','pattern','color','design_details'];
    if (!ALLOWED.includes(field)) return res.status(400).json({ error: 'שדה לא מורשה' });

    if (field === 'design_details') {
      await pool.query(
        `UPDATE products SET design_details = array_append(COALESCE(design_details,'{}'), $1), updated_at=NOW()
         WHERE id = ANY($2::int[]) AND NOT (design_details @> ARRAY[$1])`,
        [value, ids]
      );
    } else if (field === 'fit') {
      await pool.query(
        `UPDATE products SET fit=$1, updated_at=NOW() WHERE id = ANY($2::int[])`,
        [value, ids]
      );
    } else {
      await pool.query(
        `UPDATE products SET ${field}=$1, updated_at=NOW() WHERE id = ANY($2::int[])`,
        [value, ids]
      );
    }
    res.json({ ok: true, updated: ids.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/tag-products/clear-design', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'חסרים ids' });
    await pool.query(`UPDATE products SET design_details=NULL, updated_at=NOW() WHERE id = ANY($1::int[])`, [ids]);
    res.json({ ok: true, updated: ids.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/tag-products/clear-fits', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'חסרים ids' });
    await pool.query(`UPDATE products SET fit=NULL, updated_at=NOW() WHERE id = ANY($1::int[])`, [ids]);
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
    const productCards = products.slice(0, 4).map(p => {
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
    }).join('');

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
          <tr>${productCards}</tr>
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
      <a href="${SITE_BASE}/unsubscribe?email={{email}}" style="color:#c48cb3">הסרה מרשימת תפוצה</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// שלח דרך Brevo
async function sendNewProductsEmail(toEmails, subject, htmlContent) {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_KEY) throw new Error('חסר BREVO_API_KEY');

  // Brevo batch — עד 50 נמענים בבקשה אחת
  const batchSize = 50;
  let sent = 0;
  for (let i = 0; i < toEmails.length; i += batchSize) {
    const batch = toEmails.slice(i, i + batchSize);
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'LOOKLI', email: process.env.BREVO_SENDER_EMAIL || 'info@lookli.co.il' },
        bcc: batch.map(e => ({ email: e })),
        to: [{ email: process.env.BREVO_SENDER_EMAIL || 'info@lookli.co.il' }],
        subject,
        htmlContent
      })
    });
    if (!resp.ok) {
      const err = await resp.json();
      console.error('Brevo send error:', err);
    } else {
      sent += batch.length;
    }
  }
  return sent;
}

// Cron endpoint — מופעל מ-Railway Cron
// GET /api/cron/new-products-email?secret=CRON_SECRET
app.get('/api/cron/new-products-email', async (req, res) => {
  // הגנה בסיסית — סוד cron
  const CRON_SECRET = process.env.CRON_SECRET || '';
  if (CRON_SECRET && req.query.secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const dryRun = req.query.dry === '1'; // ?dry=1 → לא שולח, רק מחזיר JSON

    // 1. בדוק אם עברו 5 ימים מהשליחה האחרונה
    const lastSentRow = await pool.query(
      `SELECT sent_at FROM email_campaign_log WHERE campaign_type='new_products' ORDER BY sent_at DESC LIMIT 1`
    ).catch(() => ({ rows: [] }));

    if (!dryRun && lastSentRow.rows.length) {
      const lastSent = new Date(lastSentRow.rows[0].sent_at);
      const daysSince = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        return res.json({ skipped: true, reason: `נשלח לפני ${daysSince.toFixed(1)} ימים — מינימום 7 ימים בין שליחות` });
      }
    }

    // 2. מצא חנויות עם 4+ מוצרים חדשים ב-4 ימים האחרונים
    const newProductsRes = await pool.query(`
      SELECT store, COUNT(*) as count
      FROM products
      WHERE created_at >= NOW() - INTERVAL '4 days'
        AND store IS NOT NULL
      GROUP BY store
      HAVING COUNT(*) >= 4
      ORDER BY count DESC
    `);

    if (!newProductsRes.rows.length) {
      return res.json({ skipped: true, reason: 'אין חנויות עם 4+ מוצרים חדשים ב-4 ימים האחרונים' });
    }

    // 3. שלוף את המוצרים עצמם לכל חנות
    const storeGroups = [];
    for (const row of newProductsRes.rows) {
      const productsRes = await pool.query(`
        SELECT id, title, price, original_price, image_url, images, store, category
        FROM products
        WHERE store = $1 AND created_at >= NOW() - INTERVAL '4 days'
        ORDER BY created_at DESC
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
    const productCards = products.slice(0, 4).map(p => {
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
          <tr>${productCards}</tr>
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
      <a href="${SITE_BASE}/unsubscribe?email={{email}}" style="color:#d191b0">הסרה מרשימת תפוצה</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// GET /api/cron/price-drop-email
app.get('/api/cron/price-drop-email', async (req, res) => {
  const CRON_SECRET = process.env.CRON_SECRET || '';
  if (CRON_SECRET && req.query.secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const dryRun = req.query.dry === '1';

    // בדוק 7 ימים מהשליחה האחרונה
    const lastSentRow = await pool.query(
      `SELECT sent_at FROM email_campaign_log WHERE campaign_type='price_drop' ORDER BY sent_at DESC LIMIT 1`
    ).catch(() => ({ rows: [] }));

    if (!dryRun && lastSentRow.rows.length) {
      const daysSince = (Date.now() - new Date(lastSentRow.rows[0].sent_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        return res.json({ skipped: true, reason: `נשלח לפני ${daysSince.toFixed(1)} ימים — מינימום 7 ימים בין שליחות` });
      }
    }

    // מצא מוצרים עם ירידת מחיר 10%+ ב-7 ימים האחרונים
    const priceDropRes = await pool.query(`
      SELECT store, COUNT(*) as count
      FROM products
      WHERE updated_at >= NOW() - INTERVAL '7 days'
        AND original_price IS NOT NULL
        AND original_price > 0
        AND price > 0
        AND original_price > price * 1.10
        AND store IS NOT NULL
      GROUP BY store
      HAVING COUNT(*) >= 1
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
          AND updated_at >= NOW() - INTERVAL '7 days'
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
    const htmlContent = buildPriceDropEmail(storeGroups);

    if (dryRun) return res.send(htmlContent);

    // שלוף מנויים
    const subscribersRes = await pool.query(
      `SELECT email FROM newsletter_subscribers WHERE active=true`
    );
    const emails = subscribersRes.rows.map(r => r.email);
    if (!emails.length) return res.json({ skipped: true, reason: 'אין מנויים פעילים' });

    const sent = await sendNewProductsEmail(emails, subject, htmlContent);

    await pool.query(
      `INSERT INTO email_campaign_log (campaign_type, stores, recipients, subject, sent_at)
       VALUES ('price_drop', $1, $2, $3, NOW())`,
      [storeGroups.map(s=>s.store).join(','), sent, subject]
    ).catch(() => {});

    res.json({ ok: true, sent, stores: storeGroups.map(s=>({ store:s.store, products:s.total })), subject });

  } catch(e) {
    console.error('price-drop-email error:', e.message);
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
    : `SELECT * FROM scraper_config ORDER BY type, name`;
  const r = await pool.query(q, type ? [type] : []);
  res.json({ ok: true, items: r.rows });
});

app.post('/api/admin/scraper-config', adminAuth, async (req, res) => {
  const { type, name, aliases = [], color_hex } = req.body;
  if (!type || !name) return res.status(400).json({ error: 'type ו-name חובה' });
  const r = await pool.query(
    `INSERT INTO scraper_config (type, name, aliases, color_hex)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (type, name) DO UPDATE SET aliases=$3, color_hex=$4, updated_at=NOW()
     RETURNING *`,
    [type, name, aliases, color_hex || null]
  );
  await loadSearchAliases(); // רענון מיידי
  res.json({ ok: true, item: r.rows[0] });
});

app.delete('/api/admin/scraper-config/:id', adminAuth, async (req, res) => {
  await pool.query(`DELETE FROM scraper_config WHERE id=$1`, [req.params.id]);
  await loadSearchAliases(); // רענון מיידי
  res.json({ ok: true });
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
    // טבלת טוקני תצוגה זמניים
    await pool.query(`CREATE TABLE IF NOT EXISTS preview_tokens (
      token VARCHAR(64) PRIMARY KEY,
      note TEXT,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    // migrations
    await pool.query(`ALTER TABLE sidebar_ads ADD COLUMN IF NOT EXISTS show_rate INTEGER DEFAULT 100`);
    await pool.query(`ALTER TABLE sponsored_products ADD COLUMN IF NOT EXISTS show_rate INTEGER DEFAULT 100`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS color_images JSONB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS scraper_config (
      id SERIAL PRIMARY KEY,
      type VARCHAR(30) NOT NULL,
      name VARCHAR(100) NOT NULL,
      aliases TEXT[] DEFAULT '{}',
      color_hex VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(type, name)
    )`);
    // טען aliases לחיפוש אחרי שהטבלה קיימת
    await loadSearchAliases();
  } catch(e) { console.error('clicks table init:', e.message); }
});
