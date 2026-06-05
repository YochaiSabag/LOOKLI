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

console.log('🚀 Chen Fashion Scraper');

// ======================================================================
// טעינת קונפיג מ-DB (צבעים, קטגוריות, סגנונות וכו')
// ======================================================================
import { loadScraperConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails } = await loadScraperConfig(db);

// ======================================================================
// מיפוי מידות — ייחודי לחן (מספרים → S/M/L)
// ======================================================================
const sizeMapping = {
  'Y': ['XS'], '0': ['S'], '1': ['M'], '2': ['L'], '3': ['XL'], '4': ['XXL'], '5': ['XXXL'],
  '34': ['XS'], '36': ['XS', 'S'], '38': ['S', 'M'], '40': ['M', 'L'],
  '42': ['L', 'XL'], '44': ['XL', 'XXL'], '46': ['XXL', 'XXXL'], '48': ['XXXL'], '50': ['XXXL']
};

function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  if (/^(XS|S|M|L|XL|2?XXL|XXXL|3XL|4XL|ONE SIZE)$/i.test(val))
    return [val.replace('2XL','XXL').replace('3XL','XXXL').replace('4XL','XXXL')];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (sizeMapping[val]) return sizeMapping[val];
  // פורמט "S-36", "L-40", "XS-34", "3XL-46" — מוצא חלק אות וחלק מספר
  if (val.includes('-')) {
    const [letterPart, numPart] = val.split('-');
    if (/^(XS|S|M|L|XL|XXL|XXXL|3XL|4XL)$/i.test(letterPart))
      return [letterPart.replace('3XL','XXXL').replace('4XL','XXXL')];
    if (sizeMapping[numPart]) return sizeMapping[numPart];
  }
  return [];
}


async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-chen-fashion.com/shop...\n');
  const allUrls = new Set();
  const BASE_SHOP = 'https://www.chen-fashion.com/shop/';
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 100;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? BASE_SHOP : `${BASE_SHOP}page/${p}/`;
    console.log(`  → עמוד ${p}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(800);
      }

      const urls = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/product/"]')]
          .map(a => a.href.split('?')[0])
          .filter(h => h.includes('chen-fashion.com/product/'))
          .filter((v, i, a) => a.indexOf(v) === i)
      ).catch(() => []);

      if (urls.length === 0) { console.log(`    ⏹ עמוד ריק — עוצר`); break; }

      urls.forEach(u => allUrls.add(u));
      console.log(`    ✓ ${urls.length} קישורים (סה"כ: ${allUrls.size})`);
      await page.waitForTimeout(500);

    } catch(e) {
      console.log(`    ⏹ שגיאה — עוצר (${e.message.substring(0, 30)})`);
      break;
    }
  }

  const result = [...allUrls];
  console.log(`  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}
  }

  const result = [...allUrls];
  console.log(`\n  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}

// ======================================================================
// סריקת מוצר בודד
// ======================================================================
async function scrapeProduct(page, url) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 40) || url.substring(0, 50);
  console.log(`\n🔍 ${shortUrl}...`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);

    const data = await page.evaluate(() => {
      // === כותרת ===
      // באתר chen: h4.product_title — fallback לכל h4/h1 עם class product_title
      let title = (
        document.querySelector('h4.product_title') ||
        document.querySelector('h1.product_title') ||
        document.querySelector('.elementor-heading-title.product_title') ||
        document.querySelector('h1.entry-title') ||
        document.querySelector('h4.entry-title')
      )?.innerText?.trim() || '';
      // ניקוי קודי מוצר מהסוף
      title = title.replace(/\s*W?\d{6,}\s*/gi, '').replace(/\s+[A-Z]?\d{3,}\s*$/g, '').trim();

      // === מחיר (WooCommerce del=מקורי, ins=נוכחי) ===
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
          const bdi = priceContainer.querySelector('.woocommerce-Price-amount bdi');
          if (bdi) { const t = bdi.textContent.replace(/[^\d.]/g, ''); if (t) price = parseFloat(t); }
        }
      }

      // === תמונות ===
      // chen: תמונות ב-.woocommerce-product-gallery__image a עם data-large_image על ה-img
      const images = [];

      // שיטה 1: gallery images — data-large_image על ה-img (הכי מדויק לפי ה-HTML)
      document.querySelectorAll('.woocommerce-product-gallery__image img').forEach(img => {
        const large = img.getAttribute('data-large_image') || img.getAttribute('data-src');
        if (large && large.includes('uploads') && !images.includes(large)) images.push(large);
      });

      // שיטה 2: gallery a href (קישור לתמונה מלאה)
      if (images.length === 0) {
        document.querySelectorAll('.woocommerce-product-gallery__image a').forEach(a => {
          const src = a.getAttribute('href') || '';
          if (src.includes('uploads') && !images.includes(src)) images.push(src);
        });
      }

      // שיטה 3: flex-viewport + flex-control-thumbs
      document.querySelectorAll('.flex-viewport img, .woocommerce-product-gallery img').forEach(img => {
        const large = img.getAttribute('data-large_image') || '';
        if (large && large.includes('uploads') && !images.includes(large)) images.push(large);
        else {
          const src = (img.getAttribute('data-src') || img.src || '').replace(/-\d+x\d+\./, '.');
          if (src && src.includes('uploads') && !src.includes('-150x') && !images.includes(src)) images.push(src);
        }
      });

      // === תיאור ===
      // chen: #tab-description
      let description = '';
      const tabDesc = document.querySelector('#tab-description');
      if (tabDesc) {
        // מסיר את כותרת הטאב עצמה אם קיימת
        const clone = tabDesc.cloneNode(true);
        clone.querySelectorAll('h2, .wc-tabs').forEach(el => el.remove());
        description = clone.innerText?.trim() || '';
      }
      if (!description) {
        const descEl = document.querySelector('.woocommerce-product-details__short-description');
        if (descEl) description = descEl.innerText?.trim() || '';
      }

      // === מידות — Variations JSON (המקור הכי מדויק) ===
      // chen: attribute_pa_mydh = המידה (34,36,38...)
      //        attribute_pa_orech = האורך (אם קיים)
      let variationsData = null;
      const form = document.querySelector('form.variations_form');
      if (form) {
        try {
          const json = form.getAttribute('data-product_variations');
          if (json) variationsData = JSON.parse(json);
        } catch(e) {}
      }

      // === swatches — fallback אם אין JSON ===
      // מזהה את שם האטריביוט בדינמיות (pa_mydh, pa_size, pa_מידה וכו')
      const rawSizeMap = {}; // { sizeValue: isInStock }
      const rawLengthMap = {}; // { lengthValue: isInStock } — אם קיים ציר אורך

      document.querySelectorAll('.variable-items-wrapper').forEach(wrapper => {
        const attrName = (wrapper.getAttribute('data-attribute_name') || '').toLowerCase();
        const isLength = attrName.includes('orech') || attrName.includes('אורך') || attrName.includes('length');
        const isSize = !isLength && (
          attrName.includes('mydh') || attrName.includes('מידה') ||
          attrName.includes('size') || attrName.includes('pa_s')
        );

        wrapper.querySelectorAll('li').forEach(li => {
          const val = li.getAttribute('data-title') || li.getAttribute('title') || '';
          const disabled = li.classList.contains('disabled');
          if (!val) return;
          if (isSize) rawSizeMap[val] = !disabled;
          else if (isLength) rawLengthMap[val] = !disabled;
        });
      });

      // select fallback
      if (Object.keys(rawSizeMap).length === 0) {
        document.querySelectorAll('select').forEach(sel => {
          const name = (sel.name || sel.id || '').toLowerCase();
          const isSize = name.includes('mydh') || name.includes('מידה') || name.includes('size');
          if (!isSize) return;
          Array.from(sel.options).forEach(opt => {
            const val = opt.value?.trim();
            if (!val || /בחירת|choose/i.test(val)) return;
            rawSizeMap[val] = !opt.disabled;
          });
        });
      }

      return { title, price, originalPrice, images, description, variationsData, rawSizeMap, rawLengthMap };
    });

    if (!data.title) { console.log('  ✗ no title'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ מדלג (לא רלוונטי): ${data.title.substring(0,30)}`); return null; }

    // זיהוי מטא-דאטה
    const style    = detectStyle(data.title, data.description);
    const fit      = detectFit(data.title, data.description);
    const category = detectCategory(data.title);
    const pattern  = detectPattern(data.title, data.description);
    const fabric   = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);

    // === צבע מהכותרת דרך normalizeColor מ-loadScraperConfig ===
    const titleColor = normalizeColor(data.title, data.title) !== 'אחר'
      ? normalizeColor(data.title, data.title)
      : null;
    if (!titleColor) {
      console.log(`    ⚠️ לא נמצא צבע בכותרת: "${data.title}"`);
    }

    // === עיבוד מלאי ===
    // לוגיקת אורך: מידה נחשבת "במלאי" אם היא זמינה באורך כלשהו.
    // אם אין ציר אורך כלל — הלוגיקה הרגילה.
    const availableSizes = new Set();
    const allSizesSet = new Set();
    const hasLengthAxis = data.variationsData
      ? data.variationsData.some(v => Object.keys(v.attributes || {}).some(k => k.includes('orech') || k.includes('אורך') || k.includes('length')))
      : Object.keys(data.rawLengthMap).length > 0;

    let twoLengths = false;

    if (data.variationsData && data.variationsData.length > 0) {
      console.log(`    📋 ${data.variationsData.length} וריאציות ב-JSON`);

      if (hasLengthAxis) {
        // יש ציר אורך — מידה במלאי אם קיימת באורך אחד לפחות
        // Map: sizeVal → Set of lengths that are in_stock
        const sizeStockByLength = {};
        for (const v of data.variationsData) {
          if (!v.is_in_stock) continue;
          const attrs = v.attributes || {};
          let sizeVal = null, lengthVal = null;
          for (const [k, val] of Object.entries(attrs)) {
            const kl = k.toLowerCase();
            if (kl.includes('orech') || kl.includes('אורך') || kl.includes('length')) lengthVal = val;
            else if (kl.includes('mydh') || kl.includes('מידה') || kl.includes('size')) sizeVal = val;
          }
          if (!sizeVal) continue;
          let displaySize = sizeVal;
          try { displaySize = decodeURIComponent(sizeVal); } catch(e) {}
          if (!sizeStockByLength[displaySize]) sizeStockByLength[displaySize] = new Set();
          if (lengthVal) sizeStockByLength[displaySize].add(lengthVal);
        }
        // מידה במלאי = יש לה לפחות אורך אחד בסט
        for (const [sizeVal, lengths] of Object.entries(sizeStockByLength)) {
          if (lengths.size > 0) {
            const normSizes = normalizeSize(sizeVal);
            normSizes.forEach(s => availableSizes.add(s));
            console.log(`      ✓ ${sizeVal} → ${normSizes.join('/')} (${lengths.size} אורך/ים)`);
          }
        }
        twoLengths = Object.values(sizeStockByLength).some(s => s.size >= 2);
      } else {
        // אין ציר אורך — לוגיקה רגילה
        for (const v of data.variationsData) {
          if (!v.is_in_stock) continue;
          const attrs = v.attributes || {};
          for (const [k, val] of Object.entries(attrs)) {
            const kl = k.toLowerCase();
            if (kl.includes('mydh') || kl.includes('מידה') || kl.includes('size')) {
              let displaySize = val;
              try { displaySize = decodeURIComponent(val); } catch(e) {}
              const normSizes = normalizeSize(displaySize);
              normSizes.forEach(s => availableSizes.add(s));
              if (normSizes.length) console.log(`      ✓ ${displaySize} → ${normSizes.join('/')}`);
            }
          }
        }
      }
    } else {
      // fallback: swatches
      console.log(`    ⚠️ אין JSON - משתמש ב-swatches`);
      for (const [sizeVal, inStock] of Object.entries(data.rawSizeMap)) {
        if (!inStock) continue;
        const normSizes = normalizeSize(sizeVal);
        normSizes.forEach(s => availableSizes.add(s));
      }
      twoLengths = Object.keys(data.rawLengthMap).length >= 2;
    }

    // collect all sizes regardless of stock
    if (data.variationsData && data.variationsData.length > 0) {
      for (const v of data.variationsData) {
        const attrs = v.attributes || {};
        for (const [k, val] of Object.entries(attrs)) {
          const kl = k.toLowerCase();
          if (kl.includes('mydh') || kl.includes('מידה') || kl.includes('size')) {
            let displaySize = val;
            try { displaySize = decodeURIComponent(val); } catch(e) {}
            normalizeSize(displaySize).forEach(s => allSizesSet.add(s));
          }
        }
      }
    } else {
      Object.keys(data.rawSizeMap).forEach(sizeVal => {
        normalizeSize(sizeVal).forEach(s => allSizesSet.add(s));
      });
    }

    const uniqueSizes = [...availableSizes];
    const allUniqueSizes = [...allSizesSet];

    // דלג על מוצרים ללא מידות
    if (uniqueSizes.length === 0) {
      console.log(`  ⏭️ דלג - אין מידות`);
      return null;
    }

    // הוסף הערת אורכים לתיאור אם רלוונטי
    let description = data.description || '';
    if (twoLengths) {
      const note = 'זמין ב-2 אורכים (קצר וארוך).';
      description = description ? `${description}\n${note}` : note;
      console.log(`    📏 זמין ב-2 אורכים - נוסף לתיאור`);
    }

    // colorSizes — צבע יחיד מהכותרת × כל המידות
    const colorSizesMap = {};
    if (titleColor) colorSizesMap[titleColor] = uniqueSizes;

    console.log(`  ✓ ${data.title.substring(0, 40)}`);
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${titleColor || '-'} | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    console.log(`    📊 סגנון: ${style || '-'} | קטגוריה: ${category || '-'} | גיזרה: ${fit || '-'} | בד: ${fabric || '-'} | דוגמא: ${pattern || '-'}`);

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
      description,
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
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, pattern, fabric, design_details, all_sizes, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title=EXCLUDED.title, price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url, images=EXCLUDED.images, sizes=EXCLUDED.sizes,
         color=EXCLUDED.color, colors=EXCLUDED.colors, style=EXCLUDED.style, fit=EXCLUDED.fit,
         category=EXCLUDED.category, description=EXCLUDED.description,
         color_sizes=EXCLUDED.color_sizes, pattern=EXCLUDED.pattern, fabric=EXCLUDED.fabric,
         design_details=EXCLUDED.design_details, all_sizes=EXCLUDED.all_sizes, last_seen=NOW()`,
      ['CHEN', product.title, product.price || 0, product.originalPrice || null,
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
// הרצה ראשית
// ======================================================================
const MAX_PRODUCTS = parseInt(process.env.SCRAPER_MAX_PRODUCTS) || 99999;

const BROWSER_RESTART_EVERY = 100; // אתחול דפדפן כל 100 מוצרים למניעת דליפת זיכרון

async function launchBrowser() {
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const pg = await ctx.newPage();
  return { browser: br, context: ctx, page: pg };
}

let { browser, context, page } = await launchBrowser();

try {
  const urls = await getAllProductUrls(page);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);

  let ok = 0, fail = 0;
  for (let i = 0; i < Math.min(urls.length, MAX_PRODUCTS); i++) {
    // אתחול דפדפן כל BROWSER_RESTART_EVERY מוצרים
    if (i > 0 && i % BROWSER_RESTART_EVERY === 0) {
      console.log(`\n🔄 מאתחל דפדפן (מוצר ${i + 1})...`);
      await browser.close();
      ({ browser, context, page } = await launchBrowser());
    }

    console.log(`\n[${i + 1}/${urls.length}]`);
    const p = await scrapeProduct(page, urls[i]);
    if (p) { await saveProduct(p); ok++; }
    else { fail++; }
    await page.waitForTimeout(400);
  }

  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  await runHealthCheck(ok, fail);

} finally {
  await browser.close();
  await db.end();
}

// ======================================================================
// בדיקת בריאות
// ======================================================================
async function runHealthCheck(scraped, failed) {
  console.log('\n🔍 בודק תקינות נתונים...');
  const problems = [];

  if (unknownColors.size > 0) {
    problems.push(`⚠️ צבעים לא מזוהים (${unknownColors.size}):`);
    for (const c of unknownColors) {
      problems.push(`   ❓ "${c}"`);
    }
  }

  const missingImages = await db.query(
    `SELECT COUNT(*) as c FROM products WHERE store='CHEN' AND (images IS NULL OR array_length(images, 1) = 0)`
  );
  if (parseInt(missingImages.rows[0].c) > 0)
    problems.push(`⚠️ מוצרים בלי תמונות: ${missingImages.rows[0].c}`);

  const missingSizes = await db.query(
    `SELECT COUNT(*) as c FROM products WHERE store='CHEN' AND (sizes IS NULL OR array_length(sizes, 1) = 0)`
  );
  if (parseInt(missingSizes.rows[0].c) > 0)
    problems.push(`⚠️ מוצרים בלי מידות: ${missingSizes.rows[0].c}`);

  const failRate = scraped + failed > 0 ? failed / (scraped + failed) * 100 : 0;
  if (failRate > 15) problems.push(`⚠️ אחוז כשלונות גבוה: ${failRate.toFixed(1)}%`);

  const total = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='CHEN'`);
  console.log(`\n📊 סה"כ CHEN ב-DB: ${total.rows[0].c}`);

  if (problems.length > 0) {
    console.log(`\n${'='.repeat(50)}\n🚨 נמצאו בעיות:`);
    problems.forEach(p => console.log('   ' + p));
    console.log('='.repeat(50));
  } else {
    console.log('\n✅ הכל תקין!');
  }
}