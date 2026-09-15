import 'dotenv/config';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as cheerio from 'cheerio';
import pkg from 'pg';
console.log("ENV DATABASE_URL =", process.env.DATABASE_URL ? "SET" : "MISSING");
const { Pool } = pkg;

const connStr = process.env.DATABASE_URL;
const useSSL = connStr && (connStr.includes('rlwy.net') || connStr.includes('amazonaws.com') || connStr.includes('supabase'));

// Pool במקום Client בודד — חוסן מפני חיבור "שקט" שנסגר (AVIVIT סורקת הכל לזיכרון
// לפני שהיא שומרת, מה שמשאיר את החיבור פתוח וריק לאורך זמן ארוך)
const db = new Pool({
  connectionString: connStr,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});
db.on('error', (err) => {
  console.log(`  ⚠️ DB pool error (חיבור לא פעיל נזרק, לא קורס): ${err.message}`);
});

console.log('🚀 Avivit Weizman Scraper — גרסת HTTP ישיר דרך פרוקסי (בלי Playwright)');

// טוען config מ-DB דרך scraper_utils
import { loadScraperConfig, getProxyConfig } from './scraper_utils.js';
const { normalizeColor, normalizeColorFromTitle, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails } = await loadScraperConfig(db);

const BASE = 'https://avivit-weizman.co.il';

const sizeMapping = {
  'Y': ['XS'], '0': ['S'], '1': ['M'], '2': ['L'], '3': ['XL'], '4': ['XXL'], '5': ['XXXL'],
  '34': ['XS'], '36': ['XS','S'], '38': ['S','M'], '40': ['M','L'], '42': ['L','XL'], '44': ['XL','XXL'], '46': ['XXL','XXXL'], '48': ['XXXL'], '50': ['XXXL']
};
function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  if (/^(XS|S|M|L|XL|XXL|XXXL)$/i.test(val)) return [val];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (sizeMapping[val]) return sizeMapping[val];
  return [];
}

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
  //return ['https://avivit-weizman.co.il/product/%d7%a9%d7%9e%d7%9c%d7%aa-%d7%91%d7%99%d7%99%d7%9c%d7%99-%d7%a0%d7%a7%d7%95%d7%93%d7%95%d7%aa/'];
  // ===== END TEST MODE =====
  console.log('\n📂 איסוף קישורים מ-avivit-weizman.co.il/shop/ (כל המוצרים, לא לפי קטגוריה)...\n');
  const allUrls = new Set();
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 50;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? `${BASE}/shop/` : `${BASE}/shop/page/${p}/`;
    console.log(`  → page ${p}`);

    let html = '';
    try {
      const res = await fetchHTML(url);
      console.log(`    📄 סטטוס: ${res.status}, אורך: ${res.html.length}`);
      if (res.status === 200) html = res.html;
    } catch (e) {
      console.log(`    ⚠ שגיאה בעמוד ${p}: ${e.message.substring(0,50)}`);
    }

    const $ = cheerio.load(html || '');
    const found = new Set();
    $('a[href*="/product/"]').each((_, a) => {
      let h = ($(a).attr('href') || '').split('?')[0];
      if (!h) return;
      try { h = new URL(h, BASE).href; } catch { return; }
      if (h.includes(BASE + '/product/')) found.add(h);
    });
    const urls = [...found];

    if (urls.length === 0) { console.log(`    ⏹ עמוד ריק — עוצר`); break; }

    const before = allUrls.size;
    urls.forEach(u => allUrls.add(u));
    console.log(`    ✓ ${urls.length} (סה"כ: ${allUrls.size})`);

    if (allUrls.size === before && p > 1) {
      console.log(`    ⏹ אין URL-ים חדשים - עוצר`);
      break;
    }
  }

  const result = [...allUrls];
  console.log(`\n  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}

// ======================================================================
// סריקת מוצר בודד
// ======================================================================
async function scrapeProduct(url) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 40) || url.substring(0, 50);
  console.log(`\n🔍 ${shortUrl}...`);

  try {
    const res = await fetchHTML(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const $ = cheerio.load(res.html);

    // === כותרת — Elementor h2 ===
    let title = (
      $('.elementor-widget-heading h1').first().text() ||
      $('.elementor-widget-heading h2').first().text() ||
      $('h1.product_title').first().text() ||
      $('h1').first().text() || ''
    ).trim();
    title = title.replace(/\s*W?\d{6,}\s*/gi, '').trim();

    // === מחיר (WooCommerce del/ins) ===
    let price = 0, originalPrice = null;
    const priceContainer = $('p.price').first();
    if (priceContainer.length) {
      const delEl = priceContainer.find('del').first();
      const insEl = priceContainer.find('ins').first();
      if (delEl.length && insEl.length) {
        const t1 = (delEl.find('bdi').first().text() || '').replace(/[^\d.]/g, '');
        const t2 = (insEl.find('bdi').first().text() || '').replace(/[^\d.]/g, '');
        if (t1) originalPrice = parseFloat(t1);
        if (t2) price = parseFloat(t2);
      } else {
        const bdi = priceContainer.find('.woocommerce-Price-amount bdi').first();
        if (bdi.length) {
          const t = (bdi.text() || '').replace(/[^\d.]/g, '');
          if (t) price = parseFloat(t);
        }
      }
    }

    // === תמונות — JetWoo gallery ===
    const images = [];
    $('.jet-woo-product-gallery__image img').each((_, img) => {
      const $img = $(img);
      const src = $img.attr('data-large_image') || $img.attr('data-src') || $img.attr('src') || '';
      if (src && src.includes('uploads') && !images.includes(src)) images.push(src);
    });
    $('.jet-woo-swiper-control-thumbs__item img').each((_, img) => {
      const $img = $(img);
      const src = $img.attr('data-large_image') || $img.attr('data-src') || '';
      if (src && src.includes('uploads') && !images.includes(src)) images.push(src);
    });
    if (images.length === 0) {
      $('.woocommerce-product-gallery__image a').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (href && href.includes('uploads') && !images.includes(href)) images.push(href);
      });
    }
    const absImages = images.map(u => { try { return new URL(u, BASE).href; } catch { return null; } }).filter(Boolean);

    // === תיאור ===
    const description = $('.woocommerce-product-details__short-description').first().text()?.trim() || '';

    // === משלוח — מ-accordion ===
    let shipping = null;
    $('.wc-tab-inner, .elementor-tab-content').each((_, tab) => {
      if (shipping) return;
      const text = $(tab).text() || '';
      if (text.includes('משלוח') || text.includes('שליח')) {
        const costMatch = text.match(/עלות\s*(\d+)/);
        const thresholdMatch = text.match(/מעל\s*(\d+)/);
        if (costMatch) {
          const cost = parseInt(costMatch[1]);
          const threshold = thresholdMatch ? parseInt(thresholdMatch[1]) : 300;
          shipping = { cost, threshold };
        }
      }
    });

    // === צבעים ומידות (WooCommerce variation swatches) ===
    const rawColors = [];
    const rawSizes = [];

    $('.variable-items-wrapper li').each((_, el) => {
      const $el = $(el);
      const attrName = (
        $el.closest('[data-attribute_name]').attr('data-attribute_name') ||
        $el.attr('data-attribute_name') || ''
      ).toLowerCase();
      const t = $el.attr('data-title') || $el.attr('title') || '';
      const isDisabled = ($el.attr('class') || '').includes('disabled');
      if (!t) return;

      if (attrName.includes('color') || attrName.includes('צבע') || attrName.includes('pa_color')) {
        rawColors.push({ name: t, disabled: isDisabled });
      } else if (attrName.includes('size') || attrName.includes('מידה') || attrName.includes('pa_size')) {
        rawSizes.push({ name: t, disabled: isDisabled });
      }
    });

    // fallback: select
    if (rawColors.length === 0) {
      $('select').each((_, sel) => {
        const $sel = $(sel);
        const name = ($sel.attr('name') || $sel.attr('id') || '').toLowerCase();
        if (name.includes('color') || name.includes('pa_color') || name.includes('צבע')) {
          $sel.find('option').each((_, opt) => {
            const val = $(opt).text()?.trim();
            if (!val || /בחירת|choose/i.test(val)) return;
            rawColors.push({ name: val, disabled: $(opt).attr('disabled') !== undefined });
          });
        }
      });
    }
    if (rawSizes.length === 0) {
      $('select').each((_, sel) => {
        const $sel = $(sel);
        const name = ($sel.attr('name') || $sel.attr('id') || '').toLowerCase();
        if (name.includes('size') || name.includes('pa_size') || name.includes('מידה')) {
          $sel.find('option').each((_, opt) => {
            const val = $(opt).text()?.trim();
            if (!val || /בחירת|choose/i.test(val)) return;
            rawSizes.push({ name: val, disabled: $(opt).attr('disabled') !== undefined });
          });
        }
      });
    }

    // === Variations JSON ===
    let variationsData = null;
    const form = $('form.variations_form').first();
    if (form.length) {
      try {
        const json = form.attr('data-product_variations');
        if (json) variationsData = JSON.parse(json);
      } catch(e) {}
    }

    const data = { title, price, originalPrice, images: absImages, description, shipping, rawColors, rawSizes, variationsData };

    if (!data.title) { console.log('  ✗ no title'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ מדלג (לא רלוונטי): ${data.title.substring(0,30)}`); return null; }

    const style = detectStyle(data.title, data.description);
    const fit = detectFit(data.title, data.description);
    const category = detectCategory(data.title);
    const pattern = detectPattern(data.title, data.description);
    const fabric = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);

    console.log(`    Raw colors: ${data.rawColors.map(c => c.name + (c.disabled ? ' ✗' : ' ✓')).join(', ') || 'none'}`);
    console.log(`    Raw sizes:  ${data.rawSizes.map(s => s.name + (s.disabled ? ' ✗' : ' ✓')).join(', ') || 'none'}`);

    const colorSizesMap = {};
    const availableSizes = new Set();
    const availableColors = new Set();

    if (data.variationsData && data.variationsData.length > 0) {
      console.log(`    📋 ${data.variationsData.length} וריאציות ב-JSON`);

      for (const v of data.variationsData) {
        if (!v.is_in_stock) continue;
        const attrs = v.attributes || {};
        let colorVal = null, sizeVal = null;

        for (const [key, val] of Object.entries(attrs)) {
          const k = key.toLowerCase();
          if (k.includes('color') || k.includes('צבע')) colorVal = val;
          else if (k.includes('size') || k.includes('מידה')) sizeVal = val;
        }

        let normColor = null;
        if (colorVal) {
          let displayColor = colorVal;
          try { displayColor = decodeURIComponent(colorVal); } catch(e) {}
          for (const rc of data.rawColors) {
            const rcL = rc.name.toLowerCase();
            const dcL = displayColor.toLowerCase();
            if (rcL === dcL || rcL.includes(dcL) || dcL.includes(rcL)) { displayColor = rc.name; break; }
          }
          normColor = normalizeColor(displayColor);
        }
        if (!normColor) {
          normColor = normalizeColorFromTitle(data.title);
        }

        let normSizes = [];
        if (sizeVal) {
          let displaySize = sizeVal;
          try { displaySize = decodeURIComponent(sizeVal); } catch(e) {}
          normSizes = normalizeSize(displaySize);
        }

        if (normSizes.length > 0) {
          for (const ns of normSizes) {
            availableSizes.add(ns);
            if (normColor) {
              availableColors.add(normColor);
              if (!colorSizesMap[normColor]) colorSizesMap[normColor] = [];
              if (!colorSizesMap[normColor].includes(ns)) colorSizesMap[normColor].push(ns);
            }
          }
          console.log(`      ✓ ${normColor || '-'} + ${normSizes.join('/')}`);
        }
      }
    } else {
      console.log(`    ⚠️ אין JSON - משתמש ב-swatches`);
      for (const color of data.rawColors) {
        if (color.disabled) continue;
        const normColor = normalizeColor(color.name);
        if (!normColor) continue;
        availableColors.add(normColor);
        if (!colorSizesMap[normColor]) colorSizesMap[normColor] = [];
        for (const size of data.rawSizes) {
          if (size.disabled) continue;
          const normSizes = normalizeSize(size.name);
          for (const ns of normSizes) {
            availableSizes.add(ns);
            if (!colorSizesMap[normColor].includes(ns)) colorSizesMap[normColor].push(ns);
          }
        }
      }
      console.log(`    🔍 rawColors.length=${data.rawColors.length} rawColors=${JSON.stringify(data.rawColors.map(c=>c.name))}`);
      if (data.rawColors.length === 0) {
        const colorFromTitle = normalizeColorFromTitle(data.title);
        console.log(`    🔍 colorFromTitle("${data.title}") = ${colorFromTitle}`);
        if (colorFromTitle) {
          availableColors.add(colorFromTitle);
          if (!colorSizesMap[colorFromTitle]) colorSizesMap[colorFromTitle] = [];
        }
        for (const size of data.rawSizes) {
          if (size.disabled) continue;
          const normSizes = normalizeSize(size.name);
          for (const ns of normSizes) {
            availableSizes.add(ns);
            if (colorFromTitle && !colorSizesMap[colorFromTitle].includes(ns)) {
              colorSizesMap[colorFromTitle].push(ns);
            }
          }
        }
      }
    }

    const uniqueColors = [...availableColors];
    const allSizesSet = new Set();
    data.rawSizes.forEach(size => { normalizeSize(size.name).forEach(s => allSizesSet.add(s)); });
    const allUniqueSizes = [...allSizesSet];
    const uniqueSizes = [...availableSizes];
    const mainColor = uniqueColors[0] || null;

    if (uniqueSizes.length === 0) {
      console.log(`  ⚠️ אין מידות במלאי כרגע — שומר בכל זאת עם רשימת מידות ריקה`);
    }

    let shippingObj = null;
    if (data.shipping) {
      shippingObj = { cost: data.shipping.cost, threshold: data.shipping.threshold, isFree: false };
    } else {
      shippingObj = { cost: 35, threshold: 399, isFree: data.price >= 399 };
    }

    console.log(`  ✓ ${data.title.substring(0, 40)}`);
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${mainColor || '-'} (${uniqueColors.join(',')}) | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    console.log(`    📊 סגנון: ${style || '-'} | קטגוריה: ${category || '-'} | גיזרה: ${fit || '-'} | בד: ${fabric || '-'} | דוגמא: ${pattern || '-'}`);

    const baseTitle = computeBaseTitle(data.title, mainColor);
    return {
      baseTitle,
      title: data.title,
      price: data.price,
      originalPrice: data.originalPrice,
      images: data.images,
      colors: uniqueColors,
      sizes: uniqueSizes,
      mainColor,
      category,
      style,
      fit,
      pattern,
      fabric,
      designDetails,
      description: data.description,
      colorSizes: colorSizesMap,
      shipping: shippingObj,
      url
    };

  } catch (err) {
    console.log(`  ✗ ${err.message.substring(0, 40)}`);
    return null;
  }
}

// ======================================================================
// שמירה ל-DB
// ======================================================================
// מחשב כותרת בסיס ללא ציון הצבע (לאיחוד ווריאנטים)
function computeBaseTitle(title, mainColor) {
  if (!title) return title;

  const dashMatch = title.match(/^(.*\S)\s*-\s*\S.*$/);
  if (dashMatch) {
    const base = dashMatch[1].trim();
    if (base.length > 1) return base;
  }

  if (!mainColor || mainColor === 'אחר') return title;
  const variants = [mainColor, mainColor + 'ה', mainColor + 'ות', mainColor + 'ים',
                    mainColor + 'ת', mainColor.replace(/ה$/, '')].filter(v => v.length > 1);
  const words = title.split(/\s+/);
  const filtered = words.filter(w => !variants.some(v => w.toLowerCase() === v.toLowerCase()));
  return (filtered.join(' ').trim()) || title;
}

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
         price_dropped_at = CASE
           WHEN EXCLUDED.original_price IS NOT NULL
            AND EXCLUDED.original_price > EXCLUDED.price * 1.10
            AND (products.original_price IS NULL OR products.original_price <= products.price * 1.10)
           THEN NOW()
           ELSE products.price_dropped_at
         END`,
      ['AVIVIT', product.title, product.price || 0, product.originalPrice || null,
       product.images[0] || '', product.images, product.sizes, product.mainColor,
       product.colors, product.style || null, product.fit || null, product.category,
       product.description || null, product.url, JSON.stringify(product.colorSizes),
       product.pattern || null, product.fabric || null,
       product.designDetails?.length ? product.designDetails : null,
       product.allSizes || []]
    );
    console.log('  💾 saved');
  } catch (err) {
    console.log(`  ✗ DB: ${err.message.substring(0, 50)}`);
  }
}

// ======================================================================
// בדיקת בריאות
// ======================================================================
async function runHealthCheck(scraped, failed) {
  console.log('\n🔍 בודק תקינות נתונים...');
  const problems = [];

  if (unknownColors.size > 0) {
    problems.push(`⚠️ צבעים לא מזוהים (${unknownColors.size}):`);
    for (const c of unknownColors) problems.push(`   ❓ "${c}" - הוסף ל-colorMap`);
  }

  const missingImages = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='AVIVIT' AND (images IS NULL OR array_length(images, 1) = 0)`);
  if (parseInt(missingImages.rows[0].c) > 0) problems.push(`⚠️ מוצרים בלי תמונות: ${missingImages.rows[0].c}`);

  const missingSizes = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='AVIVIT' AND (sizes IS NULL OR array_length(sizes, 1) = 0)`);
  if (parseInt(missingSizes.rows[0].c) > 0) problems.push(`⚠️ מוצרים בלי מידות: ${missingSizes.rows[0].c}`);

  const failRate = scraped + failed > 0 ? failed / (scraped + failed) * 100 : 0;
  if (failRate > 15) problems.push(`⚠️ אחוז כשלונות גבוה: ${failRate.toFixed(1)}%`);

  const total = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='AVIVIT'`);
  console.log(`\n📊 סה"כ AVIVIT ב-DB: ${total.rows[0].c}`);

  if (problems.length > 0) {
    console.log(`\n${'='.repeat(50)}\n🚨 נמצאו בעיות:`);
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

  let ok = 0, fail = 0;
  const MAX_PRODUCTS = parseInt(process.env.SCRAPER_MAX_PRODUCTS) || 99999;

  // שלב א: סרוק הכל לזיכרון
  const rawProducts = [];
  for (let i = 0; i < Math.min(urls.length, MAX_PRODUCTS); i++) {
    console.log(`\n[${i + 1}/${urls.length}]`);
    const p = await scrapeProduct(urls[i]);
    if (p) rawProducts.push(p); else fail++;
    await new Promise(r => setTimeout(r, 300)); // השהיה קלה בין בקשות
  }

  // שלב ב: מזג לפי base_title + price — ווריאנטים של אותו מוצר באותו מחיר → שורה אחת.
  console.log(`\n🔀 מאחד ווריאנטים (${rawProducts.length} מוצרים)...`);
  const grouped = new Map();
  for (const p of rawProducts) {
    const key = `${p.baseTitle || p.title}__${p.price || 0}`;
    if (!grouped.has(key)) {
      grouped.set(key, { ...p, colors: [...(p.colors || [])], colorSizes: { ...(p.colorSizes || {}) }, allSizes: [...(p.allSizes || [])] });
    } else {
      const ex = grouped.get(key);
      ex.colors = [...new Set([...ex.colors, ...(p.colors || [])])];
      Object.assign(ex.colorSizes, p.colorSizes || {});
      ex.sizes = [...new Set([...(ex.sizes || []), ...(p.sizes || [])])];
      ex.allSizes = [...new Set([...(ex.allSizes || []), ...(p.allSizes || [])])];
    }
  }
  const uniqueCount = grouped.size;
  console.log(`  ✓ ${rawProducts.length} ווריאנטים → ${uniqueCount} מוצרים ייחודיים`);

  // שלב ג: שמור מוצרים מאוחדים
  for (const product of grouped.values()) {
    await saveProduct(product);
    ok++;
  }

  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  await runHealthCheck(ok, fail);

} finally {
  await db.end();
}
