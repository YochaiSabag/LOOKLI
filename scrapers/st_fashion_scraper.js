import 'dotenv/config';
import { chromium } from 'playwright';
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
console.log('🚀 ST Fashion Scraper');

// טוען config מ-DB דרך scraper_utils
import { loadScraperConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails } = await loadScraperConfig(db);

const sizeMapping = {
  'Y': ['XS'], '0': ['S'], '1': ['M'], '2': ['L'], '3': ['XL'], '4': ['XXL'], '5': ['XXXL'],
  '34': ['XS'], '36': ['XS','S'], '38': ['S','M'], '40': ['M','L'], '42': ['L','XL'], '44': ['XL','XXL'], '46': ['XXL','XXXL'], '48': ['XXXL'], '50': ['XXXL']
};
function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  if (/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)$/i.test(val)) return [val.toUpperCase()];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (sizeMapping[val]) return sizeMapping[val];
  return [];
}

// ======================================================================
// איסוף קישורים
// ======================================================================
async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-st-fashion.co.il...\n');
  const allUrls = new Set();
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 50;

  const categories = [
    { base: 'https://www.st-fashion.co.il/product-category/sale/', label: 'sale', maxPages: MAX_PAGES },
    { base: 'https://www.st-fashion.co.il/product-category/%d7%97%d7%a6%d7%90%d7%99%d7%95%d7%aa/', label: 'חצאיות', maxPages: MAX_PAGES },
    { base: 'https://www.st-fashion.co.il/product-category/%d7%97%d7%95%d7%9c%d7%a6%d7%95%d7%aa/', label: 'חולצות', maxPages: MAX_PAGES },
    { base: 'https://www.st-fashion.co.il/product-category/%d7%9b%d7%95%d7%aa%d7%a0%d7%95%d7%aa/', label: 'כותנות', maxPages: MAX_PAGES },
    { base: 'https://www.st-fashion.co.il/product-category/%d7%a9%d7%9e%d7%9c%d7%95%d7%aa-%d7%91%d7%99%d7%aa/', label: 'שמלות בית', maxPages: MAX_PAGES },
    { base: 'https://www.st-fashion.co.il/product-category/new-collection/', label: 'new-collection', maxPages: MAX_PAGES },
  ];

  for (const cat of categories) {
    console.log(`\n  📁 ${cat.label}`);
    for (let p = 1; p <= cat.maxPages; p++) {
      const url = p === 1 ? cat.base : `${cat.base}page/${p}/`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(800);
        }

        const urls = await page.evaluate(() =>
          [...document.querySelectorAll('a[href*="/product/"]')]
            .map(a => a.href.split('?')[0])
            .filter(h => h.includes('st-fashion.co.il/product/'))
            .filter((v, i, a) => a.indexOf(v) === i)
        );

        if (urls.length === 0) { console.log(`    ⏹ עמוד ריק — עוצר`); break; }
        const before = allUrls.size;
        urls.forEach(u => allUrls.add(u));
        console.log(`    ✓ עמוד ${p}: ${urls.length} (סה"כ: ${allUrls.size})`);
        if (allUrls.size === before) break; // לא התווסף שום דבר חדש
      } catch(e) {
        console.log(`    ⏹ שגיאה: ${e.message.substring(0, 50)}`);
        break;
      }
    }
  }

  const result = [...allUrls];
  console.log(`\n  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}

// ======================================================================
// סריקת מוצר
// ======================================================================
async function scrapeProduct(page, url) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 40) || url.substring(0, 50);
  console.log(`\n🔍 ${shortUrl}...`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);

    // המתן למידות — נסה כמה selectors
    try {
      await page.waitForSelector('.wd-swatch, select[name*="pa_size"], .variations', { timeout: 8000 });
    } catch(e) {}
    await page.waitForTimeout(1000);

    const data = await page.evaluate(() => {
      // === כותרת ===
      const title = document.querySelector('h1.product_title, h1.entry-title, .wd-entities-title')
        ?.innerText?.trim() || '';

      // === מחיר ===
      let price = 0, originalPrice = null;
      const priceEl = document.querySelector('p.price, .price');
      if (priceEl) {
        const ins = priceEl.querySelector('ins .woocommerce-Price-amount bdi');
        const del = priceEl.querySelector('del .woocommerce-Price-amount bdi');
        const regular = priceEl.querySelector('.woocommerce-Price-amount bdi');
        if (ins) {
          price = parseFloat(ins.textContent.replace(/[^\d.]/g, '')) || 0;
          if (del) originalPrice = parseFloat(del.textContent.replace(/[^\d.]/g, '')) || null;
        } else if (regular) {
          price = parseFloat(regular.textContent.replace(/[^\d.]/g, '')) || 0;
        }
      }

      // === תמונות ===
      const images = [];
      const seen = new Set();
      const addImg = (src) => {
        if (!src || src.startsWith('data:') || seen.has(src)) return;
        if (!src.includes('st-fashion.co.il')) return;
        seen.add(src); images.push(src);
      };
      document.querySelectorAll('.woocommerce-product-gallery__image a').forEach(a => addImg(a.href));
      document.querySelectorAll('.woocommerce-product-gallery__image img').forEach(img => {
        addImg(img.getAttribute('data-large_image') || img.getAttribute('data-src') || img.src);
      });
      document.querySelectorAll('.wd-carousel-item img').forEach(img => {
        addImg(img.getAttribute('data-large_image') || img.getAttribute('data-src') || img.src);
      });

      // === תיאור ===
      const description = document.querySelector(
        '.woocommerce-product-details__short-description, [class*="short-description"]'
      )?.innerText?.trim() || '';

      // === מידות — wd-swatches ===
      const rawSizes = [];

      // שיטה 1: wd-swatches (הפורמט של st-fashion)
      document.querySelectorAll('.wd-swatches-product .wd-swatch').forEach(el => {
        const title = el.getAttribute('title') || el.querySelector('.wd-swatch-text')?.innerText?.trim() || '';
        const disabled = el.classList.contains('wd-out-of-stock') || el.classList.contains('wd-disabled') ||
                         !el.classList.contains('wd-enabled');
        if (title) rawSizes.push({ name: title.toUpperCase(), disabled });
      });

      // שיטה 2: variable-items-wrapper (WooCommerce Swatches plugin)
      if (rawSizes.length === 0) {
        document.querySelectorAll('.variable-items-wrapper li[data-title]').forEach(el => {
          const title = el.getAttribute('data-title') || '';
          const disabled = el.classList.contains('disabled') || el.classList.contains('out-of-stock');
          if (title) rawSizes.push({ name: title.toUpperCase(), disabled });
        });
      }

      // שיטה 3: select options
      if (rawSizes.length === 0) {
        document.querySelectorAll('select[name*="pa_size"] option, select[name*="pa_"] option').forEach(opt => {
          const val = opt.value;
          if (!val || val === '') return;
          rawSizes.push({ name: opt.text.trim().toUpperCase(), disabled: opt.disabled });
        });
      }

      return { title, price, originalPrice, images, description, rawSizes };
    });

    if (!data.title) { console.log('  ✗ אין כותרת'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ דלג: ${data.title.substring(0, 30)}`); return null; }

    // === עיבוד מידות ===
    const availableSizes = new Set();
    console.log(`    מידות: ${data.rawSizes.map(s => (s.disabled ? '✗' : '✓') + ' ' + s.name).join(' | ')}`);
    for (const size of data.rawSizes) {
      if (size.disabled) continue;
      normalizeSize(size.name).forEach(s => availableSizes.add(s));
    }
    const uniqueSizes = [...availableSizes];

    if (uniqueSizes.length === 0) {
      console.log(`  ⏭️ דלג — אין מידות`);
      return null;
    }

    // === צבע מהכותרת ===
    let mainColor = null;
    const titleWords = (data.title || '').split(/[\s\-–,/]+/);
    for (const word of titleWords) {
      if (word.length < 2) continue;
      const c = normalizeColor(word.toLowerCase().trim());
      if (c && c !== 'אחר') { mainColor = c; break; }
    }
    if (!mainColor) {
      const c = normalizeColor(data.title);
      if (c && c !== 'אחר') mainColor = c;
    }

    // === מטא-דאטה ===
    const category    = detectCategory(data.title);
    const style       = detectStyle(data.title, data.description);
    const fit         = detectFit(data.title, data.description);
    const pattern     = detectPattern(data.title, data.description);
    const fabric      = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);

    console.log(`  ✓ ${data.title.substring(0, 40)}`);
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${mainColor || '-'} | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    console.log(`    📁 ${category || '-'} | סגנון: ${style || '-'} | גיזרה: ${fit || '-'} | בד: ${fabric || '-'}`);

    return {
      title: data.title,
      price: data.price,
      originalPrice: data.originalPrice,
      images: data.images,
      sizes: uniqueSizes,
      mainColor,
      colors: mainColor ? [mainColor] : [],
      colorSizes: {},
      category,
      style,
      fit,
      pattern,
      fabric,
      designDetails,
      description: data.description,
      url,
    };

  } catch(err) {
    console.log(`  ✗ ${err.message.substring(0, 50)}`);
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
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, pattern, fabric, design_details, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title=EXCLUDED.title, price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url, images=EXCLUDED.images, sizes=EXCLUDED.sizes,
         color=EXCLUDED.color, colors=EXCLUDED.colors, style=EXCLUDED.style, fit=EXCLUDED.fit,
         category=EXCLUDED.category, description=EXCLUDED.description,
         color_sizes=EXCLUDED.color_sizes, pattern=EXCLUDED.pattern, fabric=EXCLUDED.fabric,
         design_details=EXCLUDED.design_details, last_seen=NOW()`,
      ['ST-FASHION', product.title, product.price || 0, product.originalPrice || null,
       product.images[0] || '', product.images, product.sizes, product.mainColor,
       product.colors, product.style || null, product.fit || null, product.category,
       product.description || null, product.url, JSON.stringify(product.colorSizes),
       product.pattern || null, product.fabric || null,
       product.designDetails?.length ? product.designDetails : null]
    );
    console.log('  💾 saved');
  } catch(err) {
    console.log(`  ✗ DB: ${err.message.substring(0, 60)}`);
  }
}

// ======================================================================
// health check
// ======================================================================
async function runHealthCheck(ok, fail) {
  console.log('\n🔍 בודק תקינות נתונים...');
  const problems = [];

  if (unknownColors.size > 0) {
    problems.push(`⚠️ צבעים לא מזוהים (${unknownColors.size}):`);
    for (const c of unknownColors) problems.push(`   ❓ "${c}"`);
  }

  const mi = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='ST-FASHION' AND (images IS NULL OR array_length(images,1)=0)`);
  if (parseInt(mi.rows[0].c) > 0) problems.push(`⚠️ ללא תמונות: ${mi.rows[0].c}`);

  const ms = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='ST-FASHION' AND (sizes IS NULL OR array_length(sizes,1)=0)`);
  if (parseInt(ms.rows[0].c) > 0) problems.push(`⚠️ ללא מידות: ${ms.rows[0].c}`);

  const total = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='ST-FASHION'`);
  console.log(`\n📊 סה"כ ST-FASHION ב-DB: ${total.rows[0].c}`);

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
const browser = await chromium.launch({ headless: true, slowMo: 30 });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 }
});
const page = await context.newPage();

try {
  const urls = await getAllProductUrls(page);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);

  const MAX_PRODUCTS = parseInt(process.env.SCRAPER_MAX_PRODUCTS) || 99999;
  let ok = 0, fail = 0;
  for (let i = 0; i < Math.min(urls.length, MAX_PRODUCTS); i++) {
    console.log(`\n[${i + 1}/${Math.min(urls.length, MAX_PRODUCTS)}]`);
    const p = await scrapeProduct(page, urls[i]);
    if (p) { await saveProduct(p); ok++; } else fail++;
    await page.waitForTimeout(400);
  }

  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  await runHealthCheck(ok, fail);

} finally {
  await browser.close();
  await db.end();
}
