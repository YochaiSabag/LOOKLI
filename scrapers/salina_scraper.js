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
console.log('🚀 Salina Fashion Scraper');

import { loadScraperConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails } = await loadScraperConfig(db);

const sizeMapping = {
  'Y': ['XS'], '0': ['S'], '1': ['M'], '2': ['L'], '3': ['XL'], '4': ['XXL'], '5': ['XXXL'],
  '34': ['XS'], '36': ['XS','S'], '38': ['S','M'], '40': ['M','L'], '42': ['L','XL'], '44': ['XL','XXL'], '46': ['XXL','XXXL'], '48': ['XXXL'], '50': ['XXXL']
};
function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  if (/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL)$/i.test(val)) return [val.toUpperCase()];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (/^L-?XL$/i.test(val)) return ['L','XL'];
  if (/^S-?M$/i.test(val)) return ['S','M'];
  if (sizeMapping[val]) return sizeMapping[val];
  return [val]; // שמור כפי שהוא אם לא ידוע
}

// ======================================================================
// איסוף קישורים
// ======================================================================
async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-salinafashion.com...\n');
  const allUrls = new Set();
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 50;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1
      ? 'https://salinafashion.com/shop/'
      : `https://salinafashion.com/shop/page/${p}/`;
    try {
      console.log(`  → עמוד ${p}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // גלילה לטעינה מלאה
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(800);
      }

      const urls = await page.evaluate(() =>
        [...document.querySelectorAll('h3.wd-entities-title a, a.wd-product-img-link')]
          .map(a => a.href.split('?')[0])
          .filter(h => h.includes('salinafashion.com/shop/') && !h.endsWith('/shop/'))
          .filter((v, i, a) => a.indexOf(v) === i)
      );

      if (urls.length === 0) { console.log(`    ⏹ עמוד ריק — עוצר`); break; }
      const before = allUrls.size;
      urls.forEach(u => allUrls.add(u));
      console.log(`    ✓ ${urls.length} (סה"כ: ${allUrls.size})`);
      if (allUrls.size === before) break;
    } catch(e) {
      console.log(`    ⏹ שגיאה: ${e.message.substring(0, 50)}`);
      break;
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
  const shortUrl = url.split('/shop/')[1]?.substring(0, 40) || url.substring(0, 50);
  console.log(`\n🔍 ${shortUrl}...`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);

    // המתן למידות/צבעים
    try {
      await page.waitForSelector('.wd-swatch, .variations', { timeout: 7000 });
    } catch(e) {}
    await page.waitForTimeout(800);

    // שלב 1: חלץ נתונים בסיסיים
    const data = await page.evaluate(() => {
      // כותרת
      const title = document.querySelector('h1.product_title, h1.entry-title, .wd-entities-title')
        ?.innerText?.trim() || '';

      // מחיר
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

      // תמונות
      const images = [];
      const seen = new Set();
      const addImg = (src) => {
        if (!src || src.startsWith('data:') || seen.has(src)) return;
        if (!src.includes('salinafashion.com')) return;
        if (src.includes('-150x') || src.includes('-300x') || src.includes('-100x')) return;
        seen.add(src); images.push(src);
      };
      document.querySelectorAll('.rtwpvg-gallery-image img').forEach(img => {
        addImg(img.getAttribute('data-large_image') || img.getAttribute('data-src') || img.src);
      });
      document.querySelectorAll('.woocommerce-product-gallery__image img').forEach(img => {
        addImg(img.getAttribute('data-large_image') || img.getAttribute('data-src') || img.src);
      });

      // תיאור
      const description = (
        document.querySelector('.woocommerce-Tabs-panel--description .wd-scroll-content') ||
        document.querySelector('.woocommerce-product-details__short-description')
      )?.innerText?.trim() || '';

      // צבעים — swatches של pa_color
      const colorSwatches = [];
      document.querySelectorAll('[data-id="pa_color"] .wd-swatch, [data-attribute_name="attribute_pa_color"] .wd-swatch').forEach(el => {
        const title = el.getAttribute('title') || el.querySelector('.wd-swatch-text')?.innerText?.trim() || '';
        if (title) colorSwatches.push(title.trim());
      });

      // מידות כלליות — כל המידות הקיימות
      const allSizeEls = [];
      document.querySelectorAll('[data-id="pa_size"] .wd-swatch, [data-attribute_name="attribute_pa_size"] .wd-swatch').forEach(el => {
        const t = el.getAttribute('title') || el.querySelector('.wd-swatch-text')?.innerText?.trim() || '';
        if (t) allSizeEls.push(t.trim());
      });

      // בדוק ONE SIZE בטקסט
      const bodyText = document.body?.innerText || '';
      const isOneSize = /ONE\s*SIZE/i.test(bodyText) && allSizeEls.length === 0;

      return { title, price, originalPrice, images, description, colorSwatches, allSizeEls, isOneSize };
    });

    if (!data.title) { console.log('  ✗ אין כותרת'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ דלג: ${data.title.substring(0, 30)}`); return null; }

    // שלב 2: לחץ על כל צבע ואסוף מידות זמינות
    const colorSizesMap = {};
    const availableSizes = new Set();
    const allSizesSet = new Set();

    // ONE SIZE — מוצר במידה אחת
    if (data.isOneSize) {
      allSizesSet.add('ONE SIZE');
      console.log(`    📏 ONE SIZE`);
      // לחץ על כל צבע ובדוק מלאי
      for (const colorName of data.colorSwatches) {
        try {
          await page.evaluate((name) => {
            const swatches = document.querySelectorAll('[data-id="pa_color"] .wd-swatch');
            for (const el of swatches) {
              const t = el.getAttribute('title') || el.querySelector('.wd-swatch-text')?.innerText?.trim() || '';
              if (t.trim() === name) { el.click(); return; }
            }
          }, colorName);
          await page.waitForTimeout(800);

          const inStock = await page.evaluate(() => {
            const avail = document.querySelector('.woocommerce-variation-availability');
            if (!avail) return true;
            return !avail.innerText.includes('אזל') && !avail.innerText.includes('אין במלאי');
          });

          const normalColor = normalizeColor(colorName) !== 'אחר' ? normalizeColor(colorName) : colorName;
          console.log(`    🎨 ${colorName} → ${inStock ? '✓' : '✗'}`);
          if (inStock) {
            colorSizesMap[normalColor] = ['ONE SIZE'];
            availableSizes.add('ONE SIZE');
          }
        } catch(e) {
          console.log(`    ⚠️ ${colorName}: ${e.message.substring(0,30)}`);
        }
      }
    } else if (data.colorSwatches.length > 0) {
      for (const colorName of data.colorSwatches) {
        try {
          // לחץ על ה-swatch של הצבע
          await page.evaluate((name) => {
            const swatches = document.querySelectorAll('[data-id="pa_color"] .wd-swatch, [data-attribute_name="attribute_pa_color"] .wd-swatch');
            for (const el of swatches) {
              const t = el.getAttribute('title') || el.querySelector('.wd-swatch-text')?.innerText?.trim() || '';
              if (t.trim() === name) { el.click(); return; }
            }
          }, colorName);
          await page.waitForTimeout(1000);

          // קרא מידות זמינות אחרי הלחיצה
          const sizesForColor = await page.evaluate(() => {
            const sizes = [];
            document.querySelectorAll('[data-id="pa_size"] .wd-swatch, [data-attribute_name="attribute_pa_size"] .wd-swatch').forEach(el => {
              const t = el.getAttribute('title') || el.querySelector('.wd-swatch-text')?.innerText?.trim() || '';
              const disabled = el.classList.contains('wd-out-of-stock') || el.classList.contains('wd-disabled');
              if (t) sizes.push({ name: t.trim(), disabled });
            });
            return sizes;
          });

          const normalColor = normalizeColor(colorName) !== 'אחר' ? normalizeColor(colorName) : colorName;
          const avail = [];
          const allForColor = [];

          for (const s of sizesForColor) {
            const norm = normalizeSize(s.name);
            norm.forEach(n => allForColor.push(n));
            allForColor.forEach(n => allSizesSet.add(n));
            if (!s.disabled) {
              norm.forEach(n => { avail.push(n); availableSizes.add(n); });
            }
          }

          if (avail.length > 0) colorSizesMap[normalColor] = avail;
          console.log(`    🎨 ${colorName} (${normalColor}): ${sizesForColor.map(s => (s.disabled?'✗':'✓')+s.name).join(' | ')}`);
        } catch(e) {
          console.log(`    ⚠️ שגיאה בצבע ${colorName}: ${e.message.substring(0,40)}`);
        }
      }
    } else {
      // אין צבעים — קרא מידות ישירות
      const sizes = await page.evaluate(() => {
        const res = [];
        document.querySelectorAll('[data-id="pa_size"] .wd-swatch, .wd-swatches-product .wd-swatch').forEach(el => {
          const t = el.getAttribute('title') || el.querySelector('.wd-swatch-text')?.innerText?.trim() || '';
          const disabled = el.classList.contains('wd-out-of-stock') || el.classList.contains('wd-disabled');
          if (t) res.push({ name: t.trim(), disabled });
        });
        return res;
      });
      sizes.forEach(s => {
        normalizeSize(s.name).forEach(n => {
          allSizesSet.add(n);
          if (!s.disabled) availableSizes.add(n);
        });
      });
    }

    // צבע ראשי מהכותרת
    let mainColor = null;
    const colors = Object.keys(colorSizesMap);
    if (colors.length === 1) {
      mainColor = colors[0];
    } else if (colors.length > 1) {
      for (const word of data.title.split(/[\s\-–,/]+/)) {
        const c = normalizeColor(word.toLowerCase().trim());
        if (c && c !== 'אחר') { mainColor = c; break; }
      }
    }
    if (!mainColor) {
      const c = normalizeColor(data.title);
      if (c && c !== 'אחר') mainColor = c;
    }

    const uniqueSizes = [...availableSizes];
    const allUniqueSizes = [...allSizesSet];

    if (uniqueSizes.length === 0) {
      console.log(`  ⏭️ דלג — אין מידות במלאי`);
      return null;
    }

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
      allSizes: allUniqueSizes,
      mainColor,
      colors: colors.length > 0 ? colors : (mainColor ? [mainColor] : []),
      colorSizes: colorSizesMap,
      category, style, fit, pattern, fabric, designDetails,
      description: data.description,
      url,
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
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, pattern, fabric, design_details, all_sizes, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title=EXCLUDED.title, price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url, images=EXCLUDED.images, sizes=EXCLUDED.sizes,
         color=EXCLUDED.color, colors=EXCLUDED.colors, style=EXCLUDED.style, fit=EXCLUDED.fit,
         category=EXCLUDED.category, description=EXCLUDED.description,
         color_sizes=EXCLUDED.color_sizes, pattern=EXCLUDED.pattern, fabric=EXCLUDED.fabric,
         design_details=EXCLUDED.design_details, all_sizes=EXCLUDED.all_sizes, last_seen=NOW()`,
      ['SALINA', product.title, product.price || 0, product.originalPrice || null,
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

  const mi = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='SALINA' AND (images IS NULL OR array_length(images,1)=0)`);
  if (parseInt(mi.rows[0].c) > 0) problems.push(`⚠️ ללא תמונות: ${mi.rows[0].c}`);

  const ms = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='SALINA' AND (sizes IS NULL OR array_length(sizes,1)=0)`);
  if (parseInt(ms.rows[0].c) > 0) problems.push(`⚠️ ללא מידות: ${ms.rows[0].c}`);

  const total = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='SALINA'`);
  console.log(`\n📊 סה"כ SALINA ב-DB: ${total.rows[0].c}`);

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
    await page.waitForTimeout(500);
  }

  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  await runHealthCheck();

} finally {
  await browser.close();
  await db.end();
}
