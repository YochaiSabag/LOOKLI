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

console.log('🚀 Aviyah Yosef Scraper');

// טוען config מ-DB דרך scraper_utils
import { loadScraperConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails, reportScraperFinished } = await loadScraperConfig(db);
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
async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים...\n');
  const allUrls = new Map(); // url -> { isEvening: boolean }
  
  // קטגוריית שמלות ערב - סימון כ"ערב"
  const eveningPages = [];
  for (let p = 1; p <= 15; p++) {
    const url = p === 1 
      ? 'https://aviyahyosef.com/product-category/%d7%a9%d7%9e%d7%9c%d7%95%d7%aa-%d7%a2%d7%a8%d7%91/'
      : `https://aviyahyosef.com/product-category/%d7%a9%d7%9e%d7%9c%d7%95%d7%aa-%d7%a2%d7%a8%d7%91/page/${p}/`;
    eveningPages.push(url);
  }
  
  // קטגוריה ראשית (כל המוצרים)
  const mainPages = [];
  for (let p = 1; p <= 15; p++) {
    const url = p === 1
      ? 'https://aviyahyosef.com/product-category/uncategorized/'
      : `https://aviyahyosef.com/product-category/uncategorized/page/${p}/`;
    mainPages.push(url);
  }
  
  // סריקת עמודי ערב קודם (לסמן אותם)
  console.log('  🌙 סורק קטגוריית שמלות ערב...');
  for (const url of eveningPages) {
    try {
      console.log(`  → ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      
      // גלגול למטה לטעינת מוצרים
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }
      
      const urls = await page.evaluate(() => 
        [...document.querySelectorAll('a[href*="/product/"]')]
          .map(a => a.href)
          .filter(h => h.includes('aviyahyosef.com/product/'))
          .filter((v, i, a) => a.indexOf(v) === i)
      );
      
      if (urls.length === 0) {
        console.log(`    ⏹ עמוד ריק - עוצר`);
        break;
      }
      
      urls.forEach(u => allUrls.set(u, { isEvening: true }));
      console.log(`    ✓ ${urls.length} (ערב)`);
    } catch (e) {
      console.log(`    ⚠ שגיאה - ${e.message.substring(0, 30)} - מנסה שוב`);
      try {
        await page.waitForTimeout(3000);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const urls2 = await page.evaluate(() =>
          [...document.querySelectorAll('a[href*="/product/"]')]
            .map(a => a.href)
            .filter(h => h.includes('aviyahyosef.com/product/'))
            .filter((v, i, a) => a.indexOf(v) === i)
        );
        if (urls2.length > 0) {
          urls2.forEach(u => allUrls.set(u, { isEvening: true }));
          console.log(`    ✓ ניסיון שני הצליח: ${urls2.length} (ערב)`);
        } else {
          console.log(`    ⏭ ניסיון שני גם ריק - ממשיך (לא עוצר קטגוריה)`);
        }
      } catch (e2) {
        console.log(`    ⏭ ניסיון שני נכשל - ממשיך (לא עוצר קטגוריה)`);
      }
    }
  }
  
  // סריקת עמודים ראשיים
  console.log('\n  📦 סורק קטגוריה ראשית...');
  for (const url of mainPages) {
    try {
      console.log(`  → ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }
      
      const urls = await page.evaluate(() => 
        [...document.querySelectorAll('a[href*="/product/"]')]
          .map(a => a.href)
          .filter(h => h.includes('aviyahyosef.com/product/'))
          .filter((v, i, a) => a.indexOf(v) === i)
      );
      
      if (urls.length === 0) {
        console.log(`    ⏹ עמוד ריק - עוצר`);
        break;
      }
      
      // אל תדרוס isEvening אם כבר סומן
      urls.forEach(u => { if (!allUrls.has(u)) allUrls.set(u, { isEvening: false }); });
      console.log(`    ✓ ${urls.length}`);
    } catch (e) {
      console.log(`    ⚠ שגיאה - ${e.message.substring(0, 30)} - מנסה שוב`);
      try {
        await page.waitForTimeout(3000);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const urls2 = await page.evaluate(() =>
          [...document.querySelectorAll('a[href*="/product/"]')]
            .map(a => a.href)
            .filter(h => h.includes('aviyahyosef.com/product/'))
            .filter((v, i, a) => a.indexOf(v) === i)
        );
        if (urls2.length > 0) {
          urls2.forEach(u => { if (!allUrls.has(u)) allUrls.set(u, { isEvening: false }); });
          console.log(`    ✓ ניסיון שני הצליח: ${urls2.length}`);
        } else {
          console.log(`    ⏭ ניסיון שני גם ריק - ממשיך (לא עוצר קטגוריה)`);
        }
      } catch (e2) {
        console.log(`    ⏭ ניסיון שני נכשל - ממשיך (לא עוצר קטגוריה)`);
      }
    }
  }
  
  return allUrls; // Map<url, { isEvening }>
}

// ======================================================================
// סריקת מוצר בודד
// ======================================================================
async function scrapeProduct(page, url, isEvening = false) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 40) || url;
  console.log(`\n🔍 ${shortUrl}...`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    
    const data = await page.evaluate(() => {
      // === כותרת ===
      let title = document.querySelector('h1.product_title, h1')?.innerText?.trim() || '';
      // ניקוי קודי מוצר
      title = title.replace(/\s*W?\d{6,}\s*/gi, '').trim();
      title = title.replace(/\s+[A-Z]?\d{3,}\s*$/g, '').trim();
      
      // === מחיר (WooCommerce: del=מקורי, ins=נוכחי) ===
      let price = 0;
      let originalPrice = null;
      
      const priceContainer = document.querySelector('p.price');
      if (priceContainer) {
        const hasDel = priceContainer.querySelector('del');
        const hasIns = priceContainer.querySelector('ins');
        
        if (hasDel && hasIns) {
          const delBdi = hasDel.querySelector('bdi');
          const insBdi = hasIns.querySelector('bdi');
          if (delBdi) { const t = delBdi.textContent.replace(/[^\d.]/g, ''); if (t) originalPrice = parseFloat(t); }
          if (insBdi) { const t = insBdi.textContent.replace(/[^\d.]/g, ''); if (t) price = parseFloat(t); }
        } else {
          const regularBdi = priceContainer.querySelector('.woocommerce-Price-amount bdi');
          if (regularBdi) { const t = regularBdi.textContent.replace(/[^\d.]/g, ''); if (t) price = parseFloat(t); }
        }
      }
      
      // === תמונות ===
      const images = [];
      
      // תמונה ראשית מ-gallery figure
      document.querySelectorAll('.woocommerce-product-gallery__image a').forEach(a => {
        if (a.href && a.href.includes('uploads') && !images.includes(a.href)) images.push(a.href);
      });
      
      // תמונות מ-data-large_image
      document.querySelectorAll('.woocommerce-product-gallery__image img').forEach(img => {
        const src = img.getAttribute('data-large_image');
        if (src && !images.includes(src)) images.push(src);
      });
      
      // תמונות משנה מ-carousel — רק בתוך גלריית המוצר (לא related products)
      const gallery = document.querySelector('.woocommerce-product-gallery');
      if (gallery) {
        gallery.querySelectorAll('.wd-carousel-item img').forEach(img => {
          const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
          if (srcset) {
            const parts = srcset.split(',').map(s => s.trim());
            let largest = '', largestWidth = 0;
            parts.forEach(part => {
              const match = part.match(/(\S+)\s+(\d+)w/);
              if (match && parseInt(match[2]) > largestWidth) {
                largestWidth = parseInt(match[2]);
                largest = match[1];
              }
            });
            if (largest && !images.includes(largest)) images.push(largest);
          } else {
            const src = img.src;
            if (src && src.includes('uploads') && !src.includes('-150x') && !images.includes(src)) images.push(src);
          }
        });
      }
      
      // fallback כללי
      if (images.length === 0) {
        document.querySelectorAll('.woocommerce-product-gallery img, .product-images img').forEach(img => {
          if (img.src && img.src.includes('uploads') && !img.src.includes('-150x') && !images.includes(img.src)) 
            images.push(img.src);
        });
      }
      
      // === תיאור - רק ה-<p> הראשון ===
      let description = '';
      const descContainer = document.querySelector('.woocommerce-product-details__short-description');
      if (descContainer) {
        const firstP = descContainer.querySelector('p[data-fontsize]');
        if (firstP) {
          description = firstP.innerText?.trim() || '';
        } else {
          // fallback: הפסקה הראשונה
          const firstPAny = descContainer.querySelector('p');
          if (firstPAny) description = firstPAny.innerText?.trim() || '';
        }
        // אם התיאור מתחיל ב"טיפ:" זה הפסקה הלא נכונה, קח את הקודמת
        if (description.startsWith('טיפ:') || description.startsWith('טיפ ')) {
          description = '';
        }
      }
      
      // === מידות מ-WooCommerce variation swatches ===
      const rawSizes = [];
      const sizeStock = {}; // { sizeTitle: isInStock }
      
      // שיטה 1: swatches buttons (כמו באלמנט שצורף)
      document.querySelectorAll('.variable-items-wrapper li').forEach(el => {
        const attrName = el.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || '';
        if (attrName.includes('size') || attrName.includes('מידה') || attrName.includes('pa_size')) {
          const title = el.getAttribute('data-title') || el.getAttribute('title');
          if (title && !rawSizes.includes(title)) {
            rawSizes.push(title);
            const isDisabled = el.classList.contains('disabled');
            sizeStock[title] = !isDisabled;
          }
        }
      });
      
      // שיטה 2: select options
      if (rawSizes.length === 0) {
        document.querySelectorAll('select').forEach(select => {
          const name = (select.name || select.id || '').toLowerCase();
          if (name.includes('size') || name.includes('pa_size') || name.includes('מידה')) {
            Array.from(select.options).forEach(opt => {
              const val = opt.value?.trim();
              const text = opt.textContent?.trim();
              if (!val || val === '' || val.includes('בחירת') || val.includes('choose')) return;
              const display = text || val;
              if (!rawSizes.includes(display)) {
                rawSizes.push(display);
                sizeStock[display] = !opt.disabled;
              }
            });
          }
        });
      }
      
      // אין צבעים בבורר - כל צבע מופיע בעמוד חדש
      // ננסה לחלץ צבע מהכותרת
      const rawColors = [];
      
      return { title, price, originalPrice, images, description, rawColors, rawSizes, sizeStock };
    });
    
    if (!data.title) { console.log('  ✗ no title'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ מדלג: ${data.title.substring(0,40)}`); return null; }
    
    // זיהוי מטא-דאטה
    const style = detectStyle(data.title, data.description, isEvening);
    const fit = detectFit(data.title, data.description);
    const category = detectCategory(data.title);
    const pattern = detectPattern(data.title, data.description);
    const fabric = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);
    
    // עיבוד מידות - פשוט, אין צבעים בבורר
    const availableSizes = new Set();
    const allSizesSet = new Set();
    const colorSizesMap = {};
    
    // חילוץ צבע מהכותרת (כל צבע בעמוד נפרד)
    // בדיקת ג'ינס בכותרת → כחול
    const titleLower = (data.title || '').toLowerCase();
    if (titleLower.includes("ג'ינס") || titleLower.includes("ג׳ינס") || titleLower.includes('jeans') || titleLower.includes('denim')) {
      if (!data.rawColors.length) data.rawColors.push('כחול');
    }
    // רק מילים שמתאימות בדיוק לצבעים ידועים
    let titleColor = null;
    const titleWords = (data.title || '').split(/[\s\-–,]+/);
    for (const word of titleWords) {
      if (word.length < 2) continue;
      const lower = word.toLowerCase().trim();
      const c = normalizeColor(lower);
      if (c && c !== 'אחר') { titleColor = c; break; }
    }
    if (!titleColor) {
      console.log(`    ⚠️ לא נמצא צבע בכותרת: "${data.title}"`);
    }
    
    console.log(`    Raw sizes: ${data.rawSizes.join(', ') || 'none'}`);
    console.log(`    Size stock: ${JSON.stringify(data.sizeStock)}`);
    
    for (const size of data.rawSizes) {
      const inStock = data.sizeStock[size] !== false; // ברירת מחדל: במלאי
      const normSizes = normalizeSize(size);
      normSizes.forEach(s => allSizesSet.add(s));
      if (inStock && normSizes.length > 0) {
        normSizes.forEach(s => availableSizes.add(s));
        console.log(`      ✓ ${normSizes.join('/')}`);
      } else if (normSizes.length > 0) {
        console.log(`      ✗ ${normSizes.join('/')} (אזל)`);
      }
    }

    const uniqueSizes = [...availableSizes];
    const allUniqueSizes = [...allSizesSet];
    
    console.log(`  ✓ ${data.title.substring(0, 40)}`);
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${titleColor || '-'} | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    console.log(`    📊 סגנון: ${style || '-'} | קטגוריה: ${category || '-'} | גיזרה: ${fit || '-'} | בד: ${fabric || '-'} | דוגמא: ${pattern || '-'}`);
    if (isEvening) console.log(`    🌙 שמלת ערב`);
    
    return {
      title: data.title,
      price: data.price,
      originalPrice: data.originalPrice,
      images: data.images,
      colors: titleColor ? [titleColor] : [],
      sizes: uniqueSizes,
      allSizes: allUniqueSizes,
      mainColor: titleColor,
      category,
      style,
      fit,
      pattern,
      fabric,
      designDetails,
      description: data.description,
      colorSizes: colorSizesMap,
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

async function saveProduct(product) {
  if (!product) return;
  try {
    await db.query(
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, pattern, fabric, design_details, all_sizes, last_seen, first_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title          = EXCLUDED.title,
         price          = EXCLUDED.price,
         original_price = EXCLUDED.original_price,
         image_url      = EXCLUDED.image_url,
         images         = EXCLUDED.images,
         sizes          = EXCLUDED.sizes,
         color          = CASE WHEN products.tagged_fields @> ARRAY['color']          THEN products.color          ELSE EXCLUDED.color          END,
         colors         = EXCLUDED.colors,
         style          = CASE WHEN products.tagged_fields @> ARRAY['style']          THEN products.style          ELSE EXCLUDED.style          END,
         fit            = CASE WHEN products.tagged_fields @> ARRAY['fit']            THEN products.fit            ELSE EXCLUDED.fit            END,
         category       = CASE WHEN products.tagged_fields @> ARRAY['category']       THEN products.category       ELSE EXCLUDED.category       END,
         description    = EXCLUDED.description,
         color_sizes    = EXCLUDED.color_sizes,
         pattern        = CASE WHEN products.tagged_fields @> ARRAY['pattern']        THEN products.pattern        ELSE EXCLUDED.pattern        END,
         fabric         = CASE WHEN products.tagged_fields @> ARRAY['fabric']         THEN products.fabric         ELSE EXCLUDED.fabric         END,
         design_details = CASE WHEN products.tagged_fields @> ARRAY['design_details'] THEN products.design_details ELSE EXCLUDED.design_details END,
         all_sizes      = EXCLUDED.all_sizes,
         last_seen      = NOW(),
         tagged_fields  = (
           SELECT COALESCE(array_agg(DISTINCT f), '{}') FROM unnest(
             COALESCE(products.tagged_fields, ARRAY[]::TEXT[]) ||
             CASE WHEN EXCLUDED.style IS NOT NULL          THEN ARRAY['style']          ELSE ARRAY[]::TEXT[] END ||
             CASE WHEN EXCLUDED.category IS NOT NULL       THEN ARRAY['category']       ELSE ARRAY[]::TEXT[] END ||
             CASE WHEN EXCLUDED.fit IS NOT NULL            THEN ARRAY['fit']            ELSE ARRAY[]::TEXT[] END ||
             CASE WHEN EXCLUDED.fabric IS NOT NULL         THEN ARRAY['fabric']         ELSE ARRAY[]::TEXT[] END ||
             CASE WHEN EXCLUDED.pattern IS NOT NULL        THEN ARRAY['pattern']        ELSE ARRAY[]::TEXT[] END ||
             CASE WHEN EXCLUDED.color IS NOT NULL          THEN ARRAY['color']          ELSE ARRAY[]::TEXT[] END ||
             CASE WHEN cardinality(COALESCE(EXCLUDED.design_details, ARRAY[]::TEXT[])) > 0 THEN ARRAY['design_details'] ELSE ARRAY[]::TEXT[] END
           ) AS f
         ),
         price_dropped_at = CASE
           WHEN EXCLUDED.original_price IS NOT NULL
            AND EXCLUDED.original_price > EXCLUDED.price * 1.10
            AND (products.original_price IS NULL OR products.original_price <= products.price * 1.10)
           THEN NOW()
           ELSE products.price_dropped_at
         END`,
      ['AVIYAH', product.title, product.price || 0, product.originalPrice || null,
       product.images[0] || '', product.images, product.sizes, product.mainColor,
       product.colors, product.style || null, product.fit || null, product.category,
       product.description || null, product.url, JSON.stringify(product.colorSizes),
       product.pattern || null, product.fabric || null,
       product.designDetails?.length ? product.designDetails : null,
       product.allSizes]
    );
    console.log('  💾 saved');
  } catch (err) {
    console.log(`  ✗ DB: ${err.message.substring(0, 30)}`);
  }
}

// ======================================================================
// הרצה ראשית
// ======================================================================
async function launchBrowser() {
  const browser = await chromium.launch({ headless: true, slowMo: 30 });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  return { browser, context, page };
}

let { browser, context, page } = await launchBrowser();

// ספירה לפני ההרצה — כמה מוצרים היו "פעילים" (נראו ב-48 השעות האחרונות)
const beforeRun = await db.query(
  `SELECT COUNT(*) as c FROM products WHERE store='AVIYAH' AND last_seen > NOW() - INTERVAL '48 hours'`
);
const activeBeforeCount = parseInt(beforeRun.rows[0].c);

try {
  const urlMap = await getAllProductUrls(page);
  const totalUrls = urlMap.size;
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${totalUrls} products\n${'='.repeat(50)}`);
  
  let ok = 0, fail = 0, idx = 0;
  const successfulUrls = []; // רק URLs שבאמת הצליחו להישמר ב-DB
  const MAX_PRODUCTS = parseInt(process.env.SCRAPER_MAX_PRODUCTS) || 9999;
  for (const [url, meta] of urlMap) {
    if (ok >= MAX_PRODUCTS) { console.log(`\n⏹ הגענו ל-${MAX_PRODUCTS} מוצרים - עוצר`); break; }
    if (idx > 0 && idx % 100 === 0) {
      console.log(`\n🔄 מאתחל דפדפן (מוצר ${idx + 1})...`);
      await browser.close();
      ({ browser, context, page } = await launchBrowser());
    }
    idx++;
    console.log(`\n[${idx}/${totalUrls}]`);
    const p = await scrapeProduct(page, url, meta.isEvening);
    if (p) { await saveProduct(p); ok++; successfulUrls.push(url); } else fail++;
    await page.waitForTimeout(500);
  }
  
  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  
  await runHealthCheck(ok, fail, activeBeforeCount, totalUrls);

  // ── דווח רק מוצרים שבאמת נשמרו בהצלחה — מוצרים שנכשלו בעיבוד (לא רק שנעלמו מהקטגוריה)
  // יחשבו כ"לא נמצאו" וייספרו לקראת ה-3 הרצות שמסתירות מוצר תקוע/פגום ──
  if (fail > totalUrls * 0.5 && totalUrls > 10) {
    console.log(`\n⚠️ ${fail}/${totalUrls} מוצרים נכשלו בעיבוד — דילוג על reportScraperFinished למניעת הסתרה גורפת שגויה`);
  } else {
    await reportScraperFinished(db, 'AVIYAH', successfulUrls);
  }
  
} finally {
  await browser.close();
  await db.end();
}

// ======================================================================
// בדיקת בריאות
// ======================================================================
async function runHealthCheck(scraped, failed, activeBeforeCount, totalUrlsFound) {
  console.log('\n🔍 בודק תקינות נתונים...');
  
  const problems = [];

  // ── בדיקת "נעלמו" — האם זו ירידה אמיתית או כשל סקרייפר? ──────────
  const notSeenToday = await db.query(
    `SELECT COUNT(*) as c FROM products
     WHERE store='AVIYAH' AND last_seen < NOW() - INTERVAL '20 hours'
       AND last_seen > NOW() - INTERVAL '72 hours'`
  );
  const notSeenCount = parseInt(notSeenToday.rows[0].c);
  const dropPct = activeBeforeCount > 0 ? Math.round((notSeenCount / activeBeforeCount) * 100) : 0;

  if (activeBeforeCount > 0 && totalUrlsFound < activeBeforeCount * 0.85) {
    // נמצאו הרבה פחות קישורים מהצפוי — זה חשוד כקריסת איסוף, לא ירידת מלאי
    problems.push(`🚨 חשד לכשל איסוף: נמצאו ${totalUrlsFound} קישורים מתוך ${activeBeforeCount} שהיו פעילים (${100-Math.round(totalUrlsFound/activeBeforeCount*100)}% ירידה) — בדוק לוג למעלה אם היו "שגיאה" חוזרות בעמודים`);
  }
  if (notSeenCount > 0) {
    problems.push(`📉 ${notSeenCount} מוצרים לא נראו ב-20+ שעות (${dropPct}% מהפעילים) — ייתכן שירדו מהאתר/אזלו, או שהסקרייפר פספס אותם`);
  }
  
  if (unknownColors.size > 0) {
    problems.push(`⚠️ צבעים לא מזוהים (${unknownColors.size}):`);
    for (const c of unknownColors) {
      problems.push(`   ❓ "${c}" - הוסף ל-colorMap בסקרייפר`);
    }
  }
  
  const missingImages = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='AVIYAH' AND (images IS NULL OR array_length(images, 1) = 0) AND (image_url IS NULL OR image_url = '')`);
  if (parseInt(missingImages.rows[0].c) > 0) {
    problems.push(`⚠️ מוצרים בלי תמונות: ${missingImages.rows[0].c}`);
  }
  
  const missingSizes = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='AVIYAH' AND (sizes IS NULL OR array_length(sizes, 1) = 0)`);
  if (parseInt(missingSizes.rows[0].c) > 0) {
    problems.push(`⚠️ מוצרים בלי מידות: ${missingSizes.rows[0].c}`);
  }
  
  const failRate = scraped + failed > 0 ? failed / (scraped + failed) * 100 : 0;
  if (failRate > 10) {
    problems.push(`⚠️ אחוז כשלונות גבוה: ${failRate.toFixed(1)}%`);
  }
  
  const totalProducts = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='AVIYAH'`);
  console.log(`\n📊 סה"כ מוצרים AVIYAH ב-DB: ${totalProducts.rows[0].c}`);
  
  if (problems.length > 0) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🚨 נמצאו בעיות:`);
    console.log('='.repeat(50));
    problems.forEach(p => console.log('   ' + p));
    console.log('='.repeat(50));
  } else {
    console.log('\n✅ הכל תקין!');
  }
}