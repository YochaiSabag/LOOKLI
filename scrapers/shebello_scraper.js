import 'dotenv/config';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as cheerio from 'cheerio';
import pkg from 'pg';
console.log("ENV DATABASE_URL =", process.env.DATABASE_URL ? "SET" : "MISSING");
const { Pool } = pkg;

const connStr = process.env.DATABASE_URL;
const useSSL = connStr && (connStr.includes('rlwy.net') || connStr.includes('amazonaws.com') || connStr.includes('supabase'));

// Pool במקום Client בודד — חוסן מפני חיבור "שקט" שנסגר ע"י הפרוקסי של Railway
const db = new Pool({
  connectionString: connStr,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});
db.on('error', (err) => {
  console.log(`  ⚠️ DB pool error (חיבור לא פעיל נזרק, לא קורס): ${err.message}`);
});

console.log('🚀 Shebello Scraper — גרסת HTTP ישיר דרך פרוקסי (בלי Playwright)');

import { loadScraperConfig, getProxyConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails, reportScraperFinished } = await loadScraperConfig(db);

const STORE = 'SHEBELLO';
const BASE  = 'https://shebello.co.il';

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

// ======================================================================
// איסוף קישורים
// ======================================================================
async function getAllProductUrls() {
  // ===== TEST MODE — הסר את השורות הבאות להחזרה לרגיל =====
  //console.log('\n🧪 TEST MODE — מוצר בודד\n');
  //return ['https://shebello.co.il/product/%d7%97%d7%a6%d7%90%d7%99%d7%aa-%d7%99%d7%a8%d7%95%d7%a7-%d7%91%d7%a7%d7%91%d7%95%d7%a7/'];
  // ===== END TEST MODE =====
  console.log('\n📂 איסוף קישורים מ-shebello.co.il (HTTP ישיר דרך פרוקסי)...\n');
  const allUrls = new Set();
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 50;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? `${BASE}/shop/` : `${BASE}/shop/page/${p}/`;
    console.log(`  → עמוד ${p}`);

    try {
      const res = await fetchHTML(url);
      console.log(`    🔍 סטטוס: ${res.status}, אורך: ${res.html.length}`);
      if (res.status !== 200) { console.log(`    ⏹ סטטוס לא תקין — עוצר`); break; }

      const $ = cheerio.load(res.html);
      const found = new Set();
      $('a.jet-engine-listing-overlay-link, .jet-engine-listing-overlay-wrap[data-url], a[href*="/product/"]').each((_, el) => {
        const $el = $(el);
        let h = ($el.attr('href') || $el.attr('data-url') || '').split('?')[0];
        if (!h) return;
        try { h = new URL(h, BASE).href; } catch { return; }
        if (h.includes(BASE) && !h.endsWith('/shop/') && !h.includes('/page/') && !h.includes('/product-category/') && h !== BASE + '/') {
          found.add(h);
        }
      });

      const urls = [...found];
      if (urls.length === 0) { console.log(`    ⏹ עמוד ריק — עוצר`); break; }
      urls.forEach(u => allUrls.add(u));
      console.log(`    ✓ ${urls.length} קישורים`);
    } catch(e) {
      console.log(`    ⚠ שגיאה בעמוד ${p}: ${e.message.substring(0,60)} — ממשיך`);
    }
  }

  const result = [...allUrls];
  console.log(`  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}

// ======================================================================
// גירוד מוצר
// ======================================================================
async function scrapeProduct(url) {
  try {
    const res = await fetchHTML(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const $ = cheerio.load(res.html);

    // כותרת
    const title = ($('h1.product_title').first().text() || $('h1.entry-title').first().text() || '').trim();
    if (!title) return null;

    if (shouldSkip(title)) { console.log(`  ⏭ מדלג: ${title.substring(0, 40)}`); return null; }

    // מחיר
    const clean = t => parseFloat((t || '').replace(/[^\d.]/g, '')) || 0;
    const ins = $('.price ins .woocommerce-Price-amount bdi, .price ins .amount bdi').first();
    const del = $('.price del .woocommerce-Price-amount bdi, .price del .amount bdi').first();
    const single = $('.price .woocommerce-Price-amount bdi, .price .amount bdi').first();

    let priceData;
    if (ins.length) {
      priceData = { price: clean(ins.text()), original: del.length ? clean(del.text()) : 0 };
    } else {
      priceData = { price: clean(single.text()), original: 0 };
    }
    if (!priceData.price) return null;

    // בדיקת אזל מלאי כולל — רק מטקסט מפורש
    const fullyOosMatches = $('.elementor-heading-title').filter((_, el) => $(el).text().includes('אזל מהמלאי'));
    const fullyOos = fullyOosMatches.length > 0;
    console.log(`    🔬 DEBUG fullyOos=${fullyOos} (${fullyOosMatches.length} אלמנטים תואמים בעמוד כולו)`);

    // דלג על סטים עם select "פריט" (חולצה/חצאית) — מלאי לא ניתן לבדיקה אמינה
    const isSetWithItems = $('select[name^="attribute_"] option').filter((_, o) =>
      ['חולצה','חצאית','מכנסיים'].includes($(o).text().trim())
    ).length > 0;
    if (isSetWithItems) { console.log(`  ⏭ מדלג — סט עם בחירת פריט`); return null; }

    // מידות זמינות — מ-WooCommerce variation JSON (המקור האמין ביותר)
    let sizes = [];
    if (!fullyOos) {
      try {
        const form = $('form.variations_form').first();
        console.log(`    🔬 DEBUG variations_form נמצא? ${form.length > 0}`);
        if (form.length) {
          const json = JSON.parse(form.attr('data-product_variations') || '[]');
          console.log(`    🔬 DEBUG וריאציות ב-JSON: ${json.length}`);
          if (json.length > 0) {
            const inStock = new Set();
            for (const v of json) {
              if (!v.is_in_stock) continue;
              for (const [key, val] of Object.entries(v.attributes || {})) {
                if (!key.includes('size') && !key.includes('skirt') && !key.includes('shirt') && !key.includes('pa_')) continue;
                // val הוא slug — חפש את ה-data-title המתאים
                const li = $(`li.variable-item[data-value="${val}"]`).first();
                const t = li.attr('data-title') || val;
                if (t) inStock.add(t);
              }
            }
            if (inStock.size > 0) sizes = [...inStock];
          }
        }
      } catch(e) {}
      // fallback — select
      if (sizes.length === 0) {
        const sel = $('select[name^="attribute_pa_"]').first();
        if (sel.length) {
          sizes = sel.find('option')
            .filter((_, o) => $(o).attr('value') && ($(o).attr('class') || '').includes('enabled'))
            .map((_, o) => $(o).attr('data-title') || $(o).text().trim())
            .get().filter(Boolean);
        } else {
          // אבחון: הדפס את כל ה-class בפועל של כל li.variable-item, כדי לדעת בוודאות
          // איזה קלאס מסמן "אזל" אצל שיבלו במקום לנחש (AVIVIT השתמש ב-"disabled" אבל זה
          // כנראה שונה כאן, כי הפילטור לא שינה כלום בהרצה הקודמת)
          const allLis = $('li.variable-item[data-title]');
          console.log(`    🔬 DEBUG li classes: ${allLis.map((_, li) => `${$(li).attr('data-title')}="${$(li).attr('class') || ''}"`).get().join(' | ')}`);
          // fallback נוסף — אין select בכלל, רק li.variable-item (swatches) בלי JSON וריאציות תקין.
          sizes = allLis
            .filter((_, li) => !($(li).attr('class') || '').includes('disabled'))
            .map((_, li) => $(li).attr('data-title') || $(li).text().trim())
            .get().filter(Boolean);
        }
      }
    }

    // כל המידות (כולל אזל) — מ-li elements
    let allSizes = [];
    const sel = $('select[name^="attribute_pa_"]').first();
    if (sel.length) {
      allSizes = sel.find('option')
        .filter((_, o) => $(o).attr('value'))
        .map((_, o) => {
          const val = $(o).attr('value');
          const li = $(`li.variable-item[data-value="${val}"]`).first();
          return li.attr('data-title') || $(o).text().trim();
        })
        .get().filter(Boolean);
    } else {
      allSizes = $('li.variable-item[data-title]')
        .map((_, li) => $(li).attr('data-title') || $(li).text().trim())
        .get().filter(Boolean);
    }

    if (!allSizes.length && !sizes.length) { console.log(`  ⏭ מדלג — אין מידות`); return null; }

    console.log(`    🔍 DEBUG sizes: [${sizes.join(',')}] allSizes: [${allSizes.join(',')}]`);

    // תמונות
    const images = $('.woocommerce-product-gallery__image a')
      .map((_, a) => $(a).attr('href'))
      .get().filter(Boolean)
      .map(u => { try { return new URL(u, BASE).href; } catch { return null; } })
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);

    // תיאור
    const description = (
      $('.jet-single-content p').first().text() ||
      $('.woocommerce-product-details__short-description p').first().text() ||
      $('.elementor-jet-single-content p').first().text() || ''
    ).trim();

    // צבע, קטגוריה, סגנון
    const mainColor    = normalizeColor(title + ' ' + description);
    const category     = detectCategory(title, description);
    const style        = detectStyle(title, description);
    const fit          = detectFit(title, description);
    const pattern      = detectPattern(title, description);
    const fabric       = detectFabric(title, description);
    const designDetails = detectDesignDetails(title, description);

    const uniqueSizes    = [...new Set(sizes)];
    const allUniqueSizes = [...new Set(allSizes)];

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
    console.log(`  ✗ ${err.message.substring(0, 60)}`);
    return null;
  }
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
    await reportScraperFinished(db, 'SHEBELLO', urls);
  }
  await runHealthCheck();

} finally {
  await db.end();
}
