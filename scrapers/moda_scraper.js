import 'dotenv/config';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as cheerio from 'cheerio';
import pkg from 'pg';
console.log("ENV DATABASE_URL =", process.env.DATABASE_URL ? "SET" : "MISSING");
const { Client } = pkg;

const connStr = process.env.DATABASE_URL;
const useSSL = connStr && (connStr.includes('rlwy.net') || connStr.includes('amazonaws.com') || connStr.includes('supabase'));

const db = new Client({
  connectionString: connStr,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

await db.connect();
console.log('🚀 Moda Fashion Scraper — גרסת HTTP ישיר דרך פרוקסי (בלי Playwright)');

import { loadScraperConfig, getProxyConfig } from './scraper_utils.js';
import { parseModaProduct } from './moda_parse.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails, reportScraperFinished } = await loadScraperConfig(db);

const STORE = 'MODA';
const BASE  = 'https://modafashion.co.il';

// ======================================================================
// תשתית HTTP דרך פרוקסי — האתר החדש חוסם דפדפן אוטומטי (403) בדפי מוצר.
// הפרוקסי מוגדר במשתני הסביבה PROXY_SERVER / PROXY_USERNAME / PROXY_PASSWORD (כמו ב-LEAA)
// ======================================================================
const __proxyDiag = getProxyConfig();
let proxyAgent = null;
if (__proxyDiag) {
  console.log(`  🧭 פרוקסי זוהה: ${__proxyDiag.server} (username: ${__proxyDiag.username ? __proxyDiag.username.substring(0,15) + '...' : 'ללא'})`);
  const [scheme, rest] = __proxyDiag.server.split('://');
  const user = encodeURIComponent(__proxyDiag.username || '');
  const pass = encodeURIComponent(__proxyDiag.password || '');
  proxyAgent = new HttpsProxyAgent(`${scheme}://${user}:${pass}@${rest}`);
} else {
  console.log('  🧭 לא זוהה פרוקסי (PROXY_SERVER לא מוגדר) - רץ ישירות');
}

function fetchHTML(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const opts = {
      timeout: 60000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
      },
    };
    if (proxyAgent) opts.agent = proxyAgent;
    const req = https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        fetchHTML(nextUrl, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode, html: Buffer.concat(chunks).toString('utf-8') });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout אחרי 60 שניות')));
    req.on('error', reject);
  });
}

// ממיר מידות מספריות לאותיות (כמו בגרסה הקודמת של מודה)
const sizeMapping = {
  '34': ['XS'], '36': ['XS','S'], '38': ['S','M'], '40': ['M','L'],
  '42': ['L','XL'], '44': ['XL','XXL'], '46': ['XXL','XXXL'], '48': ['XXXL'], '50': ['XXXL']
};
function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  if (/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL)$/i.test(val)) return [val];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (/^L-?XL$/i.test(val)) return ['L','XL'];
  if (/^S-?M$/i.test(val)) return ['S','M'];
  if (sizeMapping[val]) return sizeMapping[val];
  return [];
}

// ======================================================================
// איסוף קישורים
// ======================================================================
async function getPageUrls(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let html = '';
    let status = 0;
    try {
      const res = await fetchHTML(url);
      status = res.status;
      console.log(`    🔍 סטטוס: ${res.status}, אורך: ${res.html.length}`);
      if (res.status === 200) html = res.html;
      // 404 = עמוד מעבר לסוף הקטלוג — לא טעות, אין טעם לנסות שוב
      if (res.status === 404) return { urls: [], status };
    } catch (e) {
      console.log(`    ⚠️ שגיאת בקשה: ${e.message}`);
    }

    const $ = cheerio.load(html || '');
    const found = new Set();
    $('a[href*="/product/"]').each((_, el) => {
      let h = ($(el).attr('href') || '').split('?')[0].split('#')[0];
      if (!h) return;
      try { h = new URL(h, BASE).href; } catch { return; }
      if (h.startsWith(BASE + '/product/') && !h.includes('/page/')) found.add(h);
    });

    const urls = [...found];
    if (urls.length > 0) return { urls, status };

    if (attempt < 3) {
      console.log(`    ⚠️ ניסיון ${attempt} — 0 קישורים, מנסה שוב...`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
  return { urls: [], status: 0 };
}

async function getAllProductUrls() {
  console.log('\n📂 איסוף קישורים מ-modafashion.co.il (HTTP ישיר דרך פרוקסי)...\n');
  const allUrls = new Set();
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 50;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? `${BASE}/shop/` : `${BASE}/shop/page/${p}/`;
    console.log(`  → עמוד ${p}`);

    const { urls } = await getPageUrls(url);
    if (urls.length === 0) { console.log(`    ⏹ עמוד ריק — עוצר`); break; }

    const before = allUrls.size;
    urls.forEach(u => allUrls.add(u));
    console.log(`    ✓ ${urls.length} קישורים (חדשים: ${allUrls.size - before})`);

    // הגנה מלולאה: אם העמוד לא הוסיף שום קישור חדש (למשל הפניה לעמוד 1) — עוצרים
    if (allUrls.size === before) { console.log(`    ⏹ אין קישורים חדשים — עוצר`); break; }
  }

  const result = [...allUrls];
  console.log(`  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}

// ======================================================================
// גירוד מוצר
// ======================================================================
async function scrapeProduct(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchHTML(url);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

      const d = parseModaProduct(res.html, BASE);
      const title = d.title;
      if (!title || /403|forbidden/i.test(title)) throw new Error('עמוד חסום/ריק');
      if (shouldSkip(title)) { console.log(`  ⏭ מדלג: ${title.substring(0, 40)}`); return null; }
      if (!d.price) { console.log(`  ⚠️ אין מחיר — מדלג: ${title.substring(0, 40)}`); return null; }

      // מידות
      let sizes    = [...new Set(d.sizesInStock.flatMap(s => normalizeSize(s)))];
      let allSizes = [...new Set(d.allSizes.flatMap(s => normalizeSize(s)))];
      if (d.variationsCount === 0 && d.allSizes.length === 0) {
        // מוצר ללא בחירת מידה (אקססוריז וכד') — ONE SIZE
        sizes = d.inStockAny ? ['ONE SIZE'] : [];
        allSizes = ['ONE SIZE'];
      }

      // צבעים: ממאפיין צבע אם קיים, אחרת משם המוצר / התיאור (כמו בגרסה הקודמת)
      const colorOptions = d.colorsRaw;
      const mainColor = colorOptions.length > 0
        ? normalizeColor(colorOptions[0])
        : (normalizeColor(d.firstParagraph) || normalizeColor(title));
      const colors = colorOptions.length > 0
        ? [...new Set(colorOptions.map(c => normalizeColor(c)).filter(Boolean))]
        : (mainColor ? [mainColor] : []);

      const colorSizes = {};
      for (const [c, szs] of Object.entries(d.colorSizesRaw || {})) {
        const nc = normalizeColor(c);
        if (!nc) continue;
        colorSizes[nc] = [...new Set([...(colorSizes[nc] || []), ...szs.flatMap(s => normalizeSize(s))])];
      }

      const description = d.description;
      const category      = detectCategory(title, description);
      const style         = detectStyle(title, description);
      const fit           = detectFit(title, description);
      const pattern       = detectPattern(title, description);
      const fabric        = detectFabric(title, description);
      const designDetails = detectDesignDetails(title, description);

      if (!sizes.length) console.log(`  ⚠️ כל המידות אזלו כרגע — שומר בכל זאת עם רשימת מידות ריקה`);
      if (!d.images.length) console.log(`  ⚠️ לא נמצאו תמונות: ${url}`);

      console.log(`  ✓ ${title.substring(0, 40)}`);
      console.log(`    💰 ₪${d.price}${d.originalPrice ? ` (מקור: ₪${d.originalPrice})` : ''} | 🎨 ${mainColor || '-'} | 📏 ${sizes.join(',') || '-'} | 🖼️ ${d.images.length}`);

      return {
        title, price: d.price, originalPrice: d.originalPrice || null,
        images: d.images, sizes, allSizes,
        mainColor, colors,
        colorSizes, category, style, fit, pattern, fabric, designDetails,
        description, url,
      };
    } catch (err) {
      if (attempt < 2) {
        console.log(`  ⚠️ ניסיון ${attempt} נכשל (${err.message.substring(0, 50)}), מנסה שוב...`);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.log(`  ✗ ${err.message.substring(0, 60)} — ${url}`);
        return null;
      }
    }
  }
  return null;
}

// ======================================================================
// שמירה ל-DB
// ======================================================================
async function saveProduct(product) {
  if (!product) return;
  try {
    await db.query(
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, pattern, fabric, design_details, all_sizes, last_seen, first_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title=EXCLUDED.title, price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url, images=EXCLUDED.images, sizes=EXCLUDED.sizes,
         color=EXCLUDED.color, colors=EXCLUDED.colors, style=EXCLUDED.style, fit=EXCLUDED.fit,
         category=EXCLUDED.category, description=EXCLUDED.description,
         color_sizes=EXCLUDED.color_sizes, pattern=EXCLUDED.pattern, fabric=EXCLUDED.fabric,
         design_details=EXCLUDED.design_details, all_sizes=EXCLUDED.all_sizes, last_seen=NOW(),
         hidden_stale=false, not_seen_count=0,
         price_dropped_at = CASE
           WHEN EXCLUDED.original_price IS NOT NULL
            AND EXCLUDED.original_price > EXCLUDED.price * 1.10
            AND (products.original_price IS NULL OR products.original_price <= products.price * 1.10)
           THEN NOW()
           ELSE products.price_dropped_at
         END`,
      [STORE, product.title, product.price || 0, product.originalPrice || null,
       product.images[0] || '', product.images, product.sizes, product.mainColor,
       product.colors, product.style || null, product.fit || null, product.category,
       product.description || null, product.url, JSON.stringify(product.colorSizes),
       product.pattern || null, product.fabric || null,
       product.designDetails?.length ? product.designDetails : null,
       product.allSizes || []]
    );
    console.log('  💾 saved');
  } catch(err) {
    console.log(`  ✗ DB: ${err.message.substring(0, 60)}`);
  }
}

// ======================================================================
// health check
// ======================================================================
async function runHealthCheck() {
  console.log('\n🔍 בודק תקינות נתונים...');
  const problems = [];

  if (unknownColors.size > 0) {
    problems.push(`⚠️ צבעים לא מזוהים (${unknownColors.size}):`);
    for (const c of unknownColors) problems.push(`   ❓ "${c}"`);
  }

  const mi = await db.query(`SELECT COUNT(*) as c FROM products WHERE store=$1 AND (images IS NULL OR array_length(images,1)=0)`, [STORE]);
  if (parseInt(mi.rows[0].c) > 0) problems.push(`⚠️ ללא תמונות: ${mi.rows[0].c}`);

  const ms = await db.query(`SELECT COUNT(*) as c FROM products WHERE store=$1 AND (sizes IS NULL OR array_length(sizes,1)=0)`, [STORE]);
  if (parseInt(ms.rows[0].c) > 0) problems.push(`⚠️ ללא מידות: ${ms.rows[0].c}`);

  const total = await db.query(`SELECT COUNT(*) as c FROM products WHERE store=$1`, [STORE]);
  console.log(`\n📊 סה"כ ${STORE} ב-DB: ${total.rows[0].c}`);

  if (problems.length > 0) {
    console.log(`\n${'='.repeat(50)}\n🚨 בעיות:`);
    problems.forEach(p => console.log('   ' + p));
    console.log('='.repeat(50));
  } else {
    console.log('\n✅ הכל תקין!');
  }
}

// ======================================================================
// הרצה ראשית
// ======================================================================
try {
  const urls = await getAllProductUrls();
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);

  const MAX_PRODUCTS = parseInt(process.env.SCRAPER_MAX_PRODUCTS) || 99999;
  let ok = 0, fail = 0;

  for (let i = 0; i < Math.min(urls.length, MAX_PRODUCTS); i++) {
    console.log(`\n[${i + 1}/${Math.min(urls.length, MAX_PRODUCTS)}]`);
    const p = await scrapeProduct(urls[i]);
    if (p) { await saveProduct(p); ok++; } else fail++;
    await new Promise(r => setTimeout(r, 300)); // השהיה קלה בין בקשות
  }

  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);

  // ── דווח אילו מוצרים נמצאו — מסתיר מוצרים שירדו מהאתר אחרי 3 הרצות רצופות ──
  // (זה גם מה שיסתיר בהדרגה את מוצרי הדומיין הישן moda723.com שכבר לא נמצאים)
  const TEST_MODE = !!process.env.SCRAPER_MAX_PRODUCTS;
  if (TEST_MODE) {
    console.log(`🧪 SCRAPER_MAX_PRODUCTS מוגדר — דילוג על reportScraperFinished (ריצת בדיקה חלקית)`);
  } else if (urls.length === 0) {
    console.log(`⚠️ לא נאספה אף כתובת מוצר (איסוף ה-URLs נכשל לגמרי) — דילוג על reportScraperFinished למניעת הסתרה שגויה של כל המוצרים הקיימים`);
  } else if (fail > urls.length * 0.5 && urls.length > 10) {
    console.log(`⚠️ יחס כישלונות גבוה (${fail}/${urls.length}) — דילוג על reportScraperFinished למניעת הסתרה שגויה`);
  } else {
    await reportScraperFinished(db, STORE, urls);
  }
  await runHealthCheck();

} finally {
  await db.end();
}
