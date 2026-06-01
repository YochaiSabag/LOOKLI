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
console.log('🚀 Leaa (ליידיס) Scraper');

import { loadScraperConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails } = await loadScraperConfig(db);

const STORE = 'LEAA';
const BASE  = 'https://leaa.co.il';

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
async function getPageUrls(page, url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);
    }

    // גלילה הדרגתית לטעינת lazy content
    const height = await page.evaluate(() => document.body?.scrollHeight || 0);
    for (let y = 0; y <= height; y += 300) {
      await page.evaluate(y => window.scrollTo(0, y), y);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1500);

    const urls = await page.evaluate((base) => {
      const selectors = [
        'a.woocommerce-LoopProduct-link',
        '.products .product a[href]',
        'li.product a[href]',
        '.product-item a[href]',
        'a[href*="/product/"]',
      ];
      const found = new Set();
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(a => {
          const h = (a.href || '').split('?')[0];
          if (h.includes(base) && h.includes('/product') &&
              !h.endsWith('/shop/') && !h.includes('/page/') &&
              !h.includes('/product-category/') && h !== base + '/') {
            found.add(h);
          }
        });
      }
      return [...found];
    }, BASE);

    if (urls.length > 0) return urls;

    if (attempt < 3) {
      console.log(`    ⚠️ ניסיון ${attempt} — 0 קישורים, מנסה שוב...`);
      await page.waitForTimeout(3000 * attempt);
    }
  }
  return [];
}

async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-leaa.co.il...\n');
  const allUrls = new Set();
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 50;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? `${BASE}/shop/` : `${BASE}/shop/page/${p}/`;
    console.log(`  → עמוד ${p}`);

    const urls = await getPageUrls(page, url);

    if (urls.length === 0) { console.log(`    ⏹ עמוד ריק — עוצר`); break; }

    urls.forEach(u => allUrls.add(u));
    console.log(`    ✓ ${urls.length} קישורים`);
    await page.waitForTimeout(500);
  }

  const result = [...allUrls];
  console.log(`  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}

// ======================================================================
// גירוד מוצר
// ======================================================================
async function scrapeProduct(page, url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      } catch {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(2000);
      }

    // כותרת — הסר "חדש:" בתחילה
    const rawTitle = await page.$eval(
      'h1.elementor-heading-title, h1.product_title, h1.entry-title',
      el => el.textContent.trim()
    ).catch(() => '');
    const title = rawTitle.replace(/^חדש[:\s]+/i, '').trim();
    if (!title) return null;
    if (shouldSkip(title)) { console.log(`  ⏭ מדלג: ${title.substring(0, 40)}`); return null; }

    // מחיר — מ-elementor heading עם del/ins, או מ-.price רגיל
    const priceData = await page.evaluate(() => {
      const clean = t => parseFloat((t || '').replace(/[^\d.]/g, '')) || 0;
      // נסה מ-elementor heading
      const heading = document.querySelector('.elementor-heading-title');
      const ins = heading?.querySelector('ins .woocommerce-Price-amount, ins .amount')
                || document.querySelector('.price ins .amount, .price ins .woocommerce-Price-amount');
      const del = heading?.querySelector('del .woocommerce-Price-amount, del .amount')
                || document.querySelector('.price del .amount, .price del .woocommerce-Price-amount');
      const single = heading?.querySelector('.woocommerce-Price-amount, .amount')
                   || document.querySelector('.price .woocommerce-Price-amount, .price .amount');
      if (ins) return { price: clean(ins.textContent), original: del ? clean(del.textContent) : 0 };
      return { price: clean(single?.textContent), original: 0 };
    });
    if (!priceData.price) return null;

    // תיאור — סנן פסקאות טיפול ופסקאות ריקות
    const skipKw = SKIP_PARAGRAPHS;
    const allParagraphs = await page.evaluate((skipKw) =>
      [...document.querySelectorAll('.woocommerce-product-details__short-description p')]
        .map(p => p.textContent.trim())
        .filter(t => t && !skipKw.some(kw => t.includes(kw)))
    , skipKw);

    const firstParagraph = allParagraphs[0] || '';
    const description    = allParagraphs.slice(0, 3).join(' '); // 3 פסקאות ראשונות רלוונטיות

    // מידות — כל div.vi-wpvs-option-wrap שמופיע = במלאי
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll('div.vi-wpvs-option-wrap[data-attribute_value]')]
        .map(d => (d.getAttribute('data-attribute_label') || d.getAttribute('data-attribute_value') || '').trim())
        .filter(Boolean)
    );

    // בדיקת אזל מלאי כולל (badge)
    const fullyOos = await page.evaluate(() =>
      !!document.querySelector('.outofstock-badge, .out-of-stock')
    );

    // תמונות
    const images = await page.evaluate(() =>
      [...document.querySelectorAll('.woocommerce-product-gallery__image a, .product-images a')]
        .map(a => a.getAttribute('href') || a.getAttribute('data-src'))
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
    );

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
        await page.waitForTimeout(3000);
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
  slowMo: 0,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run', '--no-zygote',
    '--lang=he-IL,he,en-US,en',
  ],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'he-IL',
  timezoneId: 'Asia/Jerusalem',
  extraHTTPHeaders: {
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  },
});
// הסתר navigator.webdriver
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
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