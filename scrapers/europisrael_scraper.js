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
console.log('🚀 EuropIsrael Scraper');

import { loadScraperConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails } = await loadScraperConfig(db);

const STORE = 'EUROPISRAEL';
const BASE  = 'https://europisrael.com';

// ======================================================================
// איסוף קישורים
// ======================================================================
async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-europisrael.com...\n');
  const allUrls = new Set();
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 50;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? `${BASE}/shop/` : `${BASE}/shop/page/${p}/`;
    console.log(`  → עמוד ${p}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(700);
    }

    const urls = await page.evaluate((base) =>
      [...document.querySelectorAll('a.woocommerce-LoopProduct-link, .products .product a')]
        .map(a => a.href.split('?')[0])
        .filter(h => h.includes(base) && !h.endsWith('/shop/') && !h.includes('/page/') && !h.includes('/product-category/') && h !== base + '/')
        .filter((v, i, a) => a.indexOf(v) === i)
    , BASE);

    if (urls.length === 0) { console.log(`    ⏹ עמוד ריק — עוצר`); break; }

    urls.forEach(u => allUrls.add(u));
    console.log(`    ✓ ${urls.length} קישורים`);
    await page.waitForTimeout(800);
  }

  const result = [...allUrls];
  console.log(`  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}

// ======================================================================
// גירוד מוצר
// ======================================================================
async function scrapeProduct(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // כותרת
    const title = await page.$eval('h1.product_title, h1.entry-title', el => el.textContent.trim()).catch(() => '');
    if (!title) return null;
    if (shouldSkip(title)) { console.log(`  ⏭ מדלג: ${title.substring(0, 40)}`); return null; }

    // מחיר — מ-.price-wrapper או .price רגיל
    const priceData = await page.evaluate(() => {
      const clean = t => parseFloat((t || '').replace(/[^\d.]/g, '')) || 0;
      const wrapper = document.querySelector('.price-wrapper .price, .price-wrapper p.price, p.price');
      const ins = wrapper?.querySelector('ins .woocommerce-Price-amount bdi') || document.querySelector('.price ins .amount bdi');
      const del = wrapper?.querySelector('del .woocommerce-Price-amount bdi') || document.querySelector('.price del .amount bdi');
      const single = wrapper?.querySelector('.woocommerce-Price-amount bdi') || document.querySelector('.price .amount bdi');
      if (ins) return { price: clean(ins.textContent), original: del ? clean(del.textContent) : 0 };
      return { price: clean(single?.textContent), original: 0 };
    });
    if (!priceData.price) return null;

    // תיאור
    const description = await page.evaluate(() =>
      [...document.querySelectorAll('.product-short-description p, .woocommerce-product-details__short-description p')]
        .map(p => p.textContent.trim())
        .filter(Boolean)
        .join(' ')
    );

    // מידות — סנן option עם "אזל" בטקסט, שמור טקסט מלא נקי
    const VALID_SIZES = /^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|ONE SIZE|OS|FREE SIZE|\d{2,3})$/i;
    const sizes = await page.evaluate((validRe) => {
      const sel = document.querySelector('select#pa_size, select[name="attribute_pa_size"]');
      if (!sel) return [];
      return [...sel.options]
        .filter(o => o.value && o.className.includes('enabled') && !o.textContent.includes('אזל'))
        .map(o => o.textContent.replace(/\s*[-–|].*$/, '').trim().toUpperCase())
        .filter(s => new RegExp(validRe).test(s));
    }, VALID_SIZES.source);

    // כל המידות (כולל אזל — נקי ללא טקסט נוסף)
    const allSizes = await page.evaluate((validRe) => {
      const sel = document.querySelector('select#pa_size, select[name="attribute_pa_size"]');
      if (!sel) return [];
      return [...sel.options]
        .filter(o => o.value && o.className.includes('enabled'))
        .map(o => o.textContent.replace(/\s*[-–|].*$/, '').trim().toUpperCase())
        .filter(s => new RegExp(validRe).test(s));
    }, VALID_SIZES.source);

    // תמונות — מ-flickity gallery ו-woocommerce gallery
    const images = await page.evaluate(() => {
      const imgs = [
        ...document.querySelectorAll('.woocommerce-product-gallery__image a, .flickity-slider .slide a'),
      ];
      return imgs
        .map(a => a.getAttribute('href') || a.getAttribute('data-o_href'))
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i);
    });

    // צבע — חפש כל הצבעים בכותרת
    const titleWords = title.split(/[\s\-–]+/);
    const allColors  = [...new Set(
      titleWords.map(w => normalizeColor(w)).filter(c => c && c !== 'אחר')
    )];
    const mainColor  = allColors[allColors.length - 1]  // הצבע האחרון = ראשי
      || normalizeColor(description)
      || 'אחר';
    const category      = detectCategory(title, description);
    const style         = detectStyle(title, description);
    const fit           = detectFit(title, description);
    const pattern       = detectPattern(title, description);
    const fabric        = detectFabric(title, description);
    const designDetails = detectDesignDetails(title, description);

    const uniqueSizes    = [...new Set(sizes)];
    const allUniqueSizes = [...new Set(allSizes)];

    console.log(`  ✓ ${title.substring(0, 40)}`);
    console.log(`    💰 ₪${priceData.price}${priceData.original ? ` (מקור: ₪${priceData.original})` : ''} | 🎨 ${mainColor || '-'} | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${images.length}`);

    return {
      title, price: priceData.price, originalPrice: priceData.original || null,
      images, sizes: uniqueSizes, allSizes: allUniqueSizes,
      mainColor, colors: allColors.length > 0 ? allColors : (mainColor !== 'אחר' ? [mainColor] : []),
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
const browser = await chromium.launch({
  headless: true,
  slowMo: 30,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=he-IL,he,en-US,en'],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
  locale: 'he-IL',
  timezoneId: 'Asia/Jerusalem',
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