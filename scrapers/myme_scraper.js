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

console.log('🚀 MYME Scraper — myme.co.il');

// ======================================================================
// טעינת קונפיג
// ======================================================================
import { loadScraperConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails } = await loadScraperConfig(db);

// ======================================================================
// המרת מידות EU
// ======================================================================
const sizeMapping = {
  '34': ['XS'], '36': ['XS','S'], '38': ['S','M'], '40': ['M','L'],
  '42': ['L','XL'], '44': ['XL','XXL'], '46': ['XXL','XXXL'], '48': ['XXXL'], '50': ['XXXL']
};
function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  if (/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|ONE SIZE)$/i.test(val)) return [val];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (/^L-?XL$/i.test(val)) return ['L','XL'];
  if (/^S-?M$/i.test(val)) return ['S','M'];
  if (sizeMapping[val]) return sizeMapping[val];
  return [];
}

// ======================================================================
// איסוף קישורי מוצרים
// ======================================================================
async function getAllProductUrls(page) {
  // ===== TEST MODE — הסר את השורות הבאות להחזרה לרגיל =====
  //console.log('\n🧪 TEST MODE — מוצר בודד\n');
  //return ['https://myme.co.il/product/%d7%a9%d7%9e%d7%9c%d7%aa-%d7%a2%d7%a8%d7%91-%d7%9e%d7%a7%d7%a1%d7%99-%d7%a1%d7%90%d7%98%d7%9f-%d7%a4%d7%9c%d7%99%d7%a1%d7%94-%d7%a6%d7%91%d7%a2-%d7%9b%d7%97%d7%95%d7%9c/'];
  // ===== END TEST MODE =====
  console.log('\n📂 איסוף קישורים מ-myme.co.il...\n');
  const allUrls = new Set();
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 30;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? 'https://myme.co.il/shop/' : `https://myme.co.il/shop/page/${p}/`;
    console.log(`  → page ${p}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(
        () => document.querySelectorAll('a[href*="/product/"]').length > 0,
        { timeout: 15000 }
      ).catch(() => {});

      const urls = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/product/"]')]
          .map(a => a.href.split('?')[0])
          .filter(h => h.includes('myme.co.il/product/'))
          .filter((v, i, a) => a.indexOf(v) === i)
      );

      if (urls.length === 0) { console.log('    ⏹ עמוד ריק — עוצר'); break; }
      const before = allUrls.size;
      urls.forEach(u => allUrls.add(u));
      console.log(`    ✓ ${urls.length} (סה"כ: ${allUrls.size})`);
      if (allUrls.size === before) break;
    } catch (e) {
      console.log(`    ⏹ שגיאה: ${e.message.substring(0, 50)}`);
      break;
    }
  }

  return [...allUrls];
}

// ======================================================================
// סריקת מוצר בודד
// ======================================================================
async function scrapeProduct(page, url) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 40) || url;
  console.log(`\n🔍 ${shortUrl}...`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      // כותרת
      const title = document.querySelector('h1.product_title, h1.entry-title')?.innerText?.trim() || '';

      // מחיר
      const priceEl = document.querySelector('p.price');
      const saleEl = priceEl?.querySelector('ins .amount');
      const origEl = priceEl?.querySelector('del .amount');
      const anyEl  = priceEl?.querySelector('.amount');
      const parsePrice = el => parseFloat(el?.innerText?.replace(/[^\d.]/g, '') || '0') || null;
      const price         = parsePrice(saleEl || anyEl);
      const originalPrice = parsePrice(origEl);

      // תיאור
      const description = document.querySelector('.elementor-widget-woocommerce-product-content, .woocommerce-product-details__short-description, .product_description')
        ?.innerText?.trim() || '';

      // מידות + מלאי
      const cfvsw = document.querySelectorAll('.cfvsw-swatches-option[data-slug]');
      let sizeEls = cfvsw.length ? cfvsw : document.querySelectorAll('[data-slug].wvs-term');

      // תמונות מהגלריה — מוגדר לפני fallback
      const images = [...new Set(
        [...document.querySelectorAll('.jet-woo-product-gallery__image-link')]
          .map(a => a.href)
          .filter(h => h.match(/\.(jpg|jpeg|png|webp)/i))
      )].slice(0, 6);

      if (!sizeEls.length) {
        const sel = document.querySelector('select[name^="attribute_"]');
        if (sel) {
          return {
            title, price, originalPrice, description,
            sizes: [...sel.options].filter(o=>o.value && !o.className.includes('disabled')).map(o=>o.value.toUpperCase()),
            allSizes: [...sel.options].filter(o=>o.value).map(o=>o.value.toUpperCase()),
            images
          };
        }
      }
      const sizes = [];
      const allSizesArr = [];
      sizeEls.forEach(el => {
        const slug = el.dataset.slug?.toUpperCase();
        if (!slug) return;
        allSizesArr.push(slug);
        if (!el.classList.contains('cfvsw-swatches-disabled')) sizes.push(slug);
      });

      return { title, price, originalPrice, description, sizes, allSizes: allSizesArr, images };
    });

    if (!data.title) { console.log('  ✗ אין כותרת'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ מדלג: ${data.title.substring(0, 40)}`); return null; }

    // המרת מידות EU
    const sizes    = [...new Set(data.sizes.flatMap(s => normalizeSize(s)))];
    const allSizes = [...new Set(data.allSizes.flatMap(s => normalizeSize(s)))];
    if (!allSizes.length) { console.log(`  ⏭ מדלג — אין מידות כלל`); return null; }
    if (!sizes.length) { console.log(`  ⏭ מדלג — כל המידות אזלו`); return null; }

    // צבע — מתוך הכותרת
    const color = normalizeColor(data.title, data.title);
    const mainColor = color || 'אחר';

    // תגיות
    const category    = detectCategory(data.title);
    const style       = detectStyle(data.title, data.description);
    const fit         = detectFit(data.title, data.description);
    const fabric      = detectFabric(data.title, data.description);
    const pattern     = detectPattern(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);

    const colorSizes = {};
    if (mainColor) colorSizes[mainColor] = sizes;

    const saleStr = data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : '';
    console.log(`  ✓ ${data.title.substring(0, 40)}`);
    console.log(`    💰 ₪${data.price}${saleStr} | 🎨 ${mainColor} | 📏 ${sizes.join(',') || 'אין'} | 🖼️ ${data.images.length}`);
    console.log(`    📁 ${category || '-'} | סגנון: ${style || '-'} | גיזרה: ${fit || '-'} | בד: ${fabric || '-'}`);

    return {
      title: data.title,
      price: data.price,
      originalPrice: data.originalPrice,
      images: data.images,
      sizes,
      allSizes,
      mainColor,
      colors: [mainColor],
      colorSizes,
      description: data.description,
      category, style, fit, fabric, pattern, designDetails,
      url,
    };

  } catch (err) {
    console.log(`  ✗ שגיאה: ${err.message.substring(0, 50)}`);
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
      ['MYME', product.title, product.price || 0, product.originalPrice || null,
       product.images[0] || '', product.images, product.sizes, product.mainColor,
       product.colors, product.style || null, product.fit || null, product.category,
       product.description || null, product.url, JSON.stringify(product.colorSizes),
       product.pattern || null, product.fabric || null,
       product.designDetails?.length ? product.designDetails : null,
       product.allSizes]
    );
    console.log('  💾 saved');
  } catch (err) {
    console.log(`  ✗ DB: ${err.message.substring(0, 50)}`);
  }
}

// ======================================================================
// health check
// ======================================================================
async function runHealthCheck(ok, fail) {
  try {
    const r = await db.query(`SELECT COUNT(*) FROM products WHERE store='MYME'`);
    console.log(`\n🔍 MYME בDB: ${r.rows[0].count} מוצרים`);
    if (unknownColors.size > 0) {
      console.log(`\n🎨 צבעים לא מזוהים (${unknownColors.size}):`);
      [...unknownColors].forEach(c => console.log(`   ❓ "${c}"`));
    }
  } catch(e) {}
}

// ======================================================================
// הרצה ראשית
// ======================================================================
const MAX_PRODUCTS = parseInt(process.env.SCRAPER_MAX_PRODUCTS) || 99999;
const BROWSER_RESTART_EVERY = 100;

async function launchBrowser() {
  const browser = await chromium.launch({ headless: true, slowMo: 30 });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  return { browser, context, page };
}

let { browser, context, page } = await launchBrowser();

try {
  const urls = await getAllProductUrls(page);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} מוצרים\n${'='.repeat(50)}`);

  let ok = 0, fail = 0;
  for (let i = 0; i < Math.min(urls.length, MAX_PRODUCTS); i++) {
    if (i > 0 && i % BROWSER_RESTART_EVERY === 0) {
      console.log(`\n🔄 מאתחל דפדפן (מוצר ${i + 1})...`);
      await browser.close();
      ({ browser, context, page } = await launchBrowser());
    }
    console.log(`\n[${i + 1}/${urls.length}]`);
    const p = await scrapeProduct(page, urls[i]);
    if (p) { await saveProduct(p); ok++; } else { fail++; }
    await page.waitForTimeout(400);
  }

  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  await runHealthCheck(ok, fail);

} finally {
  await browser.close();
  await db.end();
}