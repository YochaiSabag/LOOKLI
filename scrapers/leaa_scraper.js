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
console.log('🚀 Leaa (ליידיס) Scraper — גרסת HTTP ישיר דרך פרוקסי (בלי Playwright)');

import { loadScraperConfig, getProxyConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails, reportScraperFinished } = await loadScraperConfig(db);

const STORE = 'LEAA';
const BASE  = 'https://leaa.co.il';

// ======================================================================
// תשתית HTTP דרך פרוקסי (מחליפה את Playwright - האתר חוסם דפדפן אוטומטי,
// אבל מתיר בקשת HTTP ישירה. ראה תיעוד ב-scraper_utils.js / getProxyConfig)
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
    const opts = { timeout: 60000, rejectUnauthorized: false };
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

// ממיר מידות מספריות לאותיות
const sizeMapping = {
  '34': ['XS'], '36': ['XS','S'], '38': ['S','M'], '40': ['M','L'],
  '42': ['L','XL'], '44': ['XL','XXL'], '46': ['XXL','XXXL'], '48': ['XXXL'], '50': ['XXXL']
};
function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  if (/^(XS|S|M|L|XL|XXL|XXXL|ONE SIZE)$/i.test(val)) return [val];
  if (sizeMapping[val]) return sizeMapping[val];
  return [val]; // שמור כמו שהוא אם לא מזוהה
}

// פסקאות שיש לסנן מהתיאור
const SKIP_PARAGRAPHS = ['מרכך','כביסה','לכבס','לשמור על צבע','תשארנה','פרטים לגבי משלוח','&nbsp;'];

// ======================================================================
// איסוף קישורים
// ======================================================================
async function getPageUrls(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let html = '';
    try {
      const res = await fetchHTML(url);
      console.log(`    🔍 סטטוס: ${res.status}, אורך: ${res.html.length}`);
      if (res.status === 200) html = res.html;
    } catch (e) {
      console.log(`    ⚠️ שגיאת בקשה: ${e.message}`);
    }

    const $ = cheerio.load(html || '');
    const found = new Set();
    const selectors = [
      'a.woocommerce-LoopProduct-link',
      '.products .product a[href]',
      'li.product a[href]',
      '.product-item a[href]',
      'a[href*="/product/"]',
    ];
    for (const sel of selectors) {
      $(sel).each((_, el) => {
        let h = $(el).attr('href') || '';
        h = h.split('?')[0];
        if (!h) return;
        try { h = new URL(h, BASE).href; } catch { return; }
        if (h.includes(BASE) && h.includes('/product') &&
            !h.endsWith('/shop/') && !h.includes('/page/') &&
            !h.includes('/product-category/') && h !== BASE + '/') {
          found.add(h);
        }
      });
    }

    const urls = [...found];
    if (urls.length > 0) return urls;

    if (attempt < 3) {
      console.log(`    ⚠️ ניסיון ${attempt} — 0 קישורים, מנסה שוב...`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
  return [];
}

async function getAllProductUrls() {
  console.log('\n📂 איסוף קישורים מ-leaa.co.il (HTTP ישיר דרך פרוקסי)...\n');
  const allUrls = new Set();
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 50;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? `${BASE}/shop/` : `${BASE}/shop/page/${p}/`;
    console.log(`  → עמוד ${p}`);

    const urls = await getPageUrls(url);

    if (urls.length === 0) { console.log(`    ⏹ עמוד ריק — עוצר`); break; }

    urls.forEach(u => allUrls.add(u));
    console.log(`    ✓ ${urls.length} קישורים`);
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
      const $ = cheerio.load(res.html);

      // כותרת — הסר "חדש:" בתחילה
      const rawTitle = (
        $('h1.elementor-heading-title').first().text() ||
        $('h1.product_title').first().text() ||
        $('h1.entry-title').first().text() || ''
      ).trim();
      const title = rawTitle.replace(/^חדש[:\s]+/i, '').trim();
      if (!title) return null;
      if (shouldSkip(title)) { console.log(`  ⏭ מדלג: ${title.substring(0, 40)}`); return null; }

      // מחיר — מ-elementor heading עם del/ins, או מ-.price רגיל
      const clean = t => parseFloat((t || '').replace(/[^\d.]/g, '')) || 0;
      const heading = $('.elementor-heading-title').first();
      let ins = heading.find('ins .woocommerce-Price-amount, ins .amount').first();
      if (!ins.length) ins = $('.price ins .amount, .price ins .woocommerce-Price-amount').first();
      let del = heading.find('del .woocommerce-Price-amount, del .amount').first();
      if (!del.length) del = $('.price del .amount, .price del .woocommerce-Price-amount').first();
      let single = heading.find('.woocommerce-Price-amount, .amount').first();
      if (!single.length) single = $('.price .woocommerce-Price-amount, .price .amount').first();

      let priceData;
      if (ins.length) {
        priceData = { price: clean(ins.text()), original: del.length ? clean(del.text()) : 0 };
      } else {
        priceData = { price: clean(single.text()), original: 0 };
      }
      if (!priceData.price) return null;

      // תיאור — סנן פסקאות טיפול ופסקאות ריקות
      const skipKw = SKIP_PARAGRAPHS;
      const allParagraphs = $('.woocommerce-product-details__short-description p')
        .map((_, p) => $(p).text().trim()).get()
        .filter(t => t && !skipKw.some(kw => t.includes(kw)));

      const firstParagraph = allParagraphs[0] || '';
      const description    = allParagraphs.slice(0, 3).join(' '); // 3 פסקאות ראשונות רלוונטיות

      // מידות — כל div.vi-wpvs-option-wrap שמופיע = במלאי
      const sizes = $('div.vi-wpvs-option-wrap[data-attribute_value]')
        .map((_, d) => ($(d).attr('data-attribute_label') || $(d).attr('data-attribute_value') || '').trim())
        .get().filter(Boolean);

      // בדיקת אזל מלאי כולל (badge)
      const fullyOos = $('.outofstock-badge, .out-of-stock').length > 0;

      // תמונות - עדיפות לגרסה המוקטנת (src של ה-img בפועל, למשל -400x600.webp),
      // כי href של ה-a מצביע על התמונה המקורית הענקית (לזום), בלי סיומת מידה בכלל -
      // מה שגורם ל-thumbUrl() בפרונט לא לזהות אותה ולהעלות את המקור הענק כמו שהוא
      const images = $('.woocommerce-product-gallery__image a, .product-images a')
        .map((_, a) => {
          const $a = $(a);
          const img = $a.find('img').first();
          const resized = img.attr('src') || img.attr('data-src');
          return resized || $a.attr('href') || $a.attr('data-src');
        }).get().filter(Boolean)
        .map(u => { try { return new URL(u, BASE).href; } catch { return null; } })
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i);

      // צבע — מהפסקה הראשונה בלבד
      const mainColor     = normalizeColor(firstParagraph) || normalizeColor(title);
      const category      = detectCategory(title, description);
      const style         = detectStyle(title, description);
      const fit           = detectFit(title, description);
      const pattern       = detectPattern(title, description);
      const fabric        = detectFabric(title, description);
      const designDetails = detectDesignDetails(title, description);

      const uniqueSizes    = fullyOos ? [] : [...new Set(sizes.flatMap(s => normalizeSize(s)))];
      const allUniqueSizes = [...new Set(sizes.flatMap(s => normalizeSize(s)))];

      console.log(`  ✓ ${title.substring(0, 40)}`);
      console.log(`    💰 ₪${priceData.price}${priceData.original ? ` (מקור: ₪${priceData.original})` : ''} | 🎨 ${mainColor || '-'} | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${images.length}`);

      return {
        title, price: priceData.price, originalPrice: priceData.original || null,
        images, sizes: uniqueSizes, allSizes: allUniqueSizes,
        mainColor, colors: mainColor ? [mainColor] : [],
        colorSizes: {}, category, style, fit, pattern, fabric, designDetails,
        description, url,
      };
    } catch(err) {
      if (attempt < 2) {
        console.log(`    ⚠️ ניסיון ${attempt} נכשל: ${err.message.substring(0,40)}, מנסה שוב...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      console.log(`  ✗ ${err.message.substring(0, 60)}`);
      return null;
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
  if (urls.length === 0) {
    console.log(`⚠️ לא נאספה אף כתובת מוצר (איסוף ה-URLs נכשל לגמרי) — דילוג על reportScraperFinished למניעת הסתרה שגויה של כל המוצרים הקיימים`);
  } else if (fail > urls.length * 0.5 && urls.length > 10) {
    console.log(`⚠️ יחס כישלונות גבוה (${fail}/${urls.length}) — דילוג על reportScraperFinished למניעת הסתרה שגויה`);
  } else {
    await reportScraperFinished(db, 'LEAA', urls);
  }
  await runHealthCheck();

} finally {
  await db.end();
}
