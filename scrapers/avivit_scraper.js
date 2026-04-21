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

console.log('🚀 Avivit Weizman Scraper');

// טוען config מ-DB דרך scraper_utils
import { loadScraperConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails } = await loadScraperConfig(db);

// ======================================================================
// איסוף קישורים
// ======================================================================
async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-avivit-weizman.co.il...\n');
  const allUrls = new Set();

  const categories = [
    { base: 'https://avivit-weizman.co.il/product-category/%d7%a7%d7%95%d7%9c%d7%a7%d7%a6%d7%99%d7%99%d7%aa-%d7%90%d7%91%d7%99%d7%91-26/', label: 'קולקציית אביב 26', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/sale/', label: 'sale', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/basic/', label: 'basic', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/%d7%a9%d7%9e%d7%9c%d7%95%d7%aa-%d7%9c%d7%97%d7%92/', label: 'שמלות לחג', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/%d7%a0%d7%a2%d7%a8%d7%95%d7%aa/', label: 'נערות', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/%d7%a1%d7%98%d7%99%d7%9d/', label: 'סטים', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/%d7%a7%d7%95%d7%9c%d7%a7%d7%a6%d7%99%d7%99%d7%aa-%d7%90%d7%99%d7%a8%d7%95%d7%a2%d7%99%d7%9d/', label: 'קולקציית אירועים', maxPages: 50 },
  ];

  for (const cat of categories) {
    console.log(`  📁 [${cat.label}]`);

    for (let p = 1; p <= cat.maxPages; p++) {
      const url = p === 1 ? cat.base : `${cat.base}page/${p}/`;
      try {
        console.log(`  → page ${p}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);

        // גלילה למטה — האתר טוען עוד מוצרים בגלילה
        let lastCount = 0;
        for (let scroll = 0; scroll < 8; scroll++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1500);
          const count = await page.evaluate(() =>
            document.querySelectorAll('a[href*="/product/"]').length
          );
          if (count === lastCount) break;
          lastCount = count;
        }

        const urls = await page.evaluate(() =>
          [...document.querySelectorAll('a[href*="/product/"]')]
            .map(a => a.href.split('?')[0])
            .filter(h => h.includes('avivit-weizman.co.il/product/'))
            .filter((v, i, a) => a.indexOf(v) === i)
        );

        if (urls.length === 0) { console.log(`    ⏹ עמוד ריק - עוצר`); break; }

        const before = allUrls.size;
        urls.forEach(u => allUrls.add(u));
        console.log(`    ✓ ${urls.length} (סה"כ: ${allUrls.size})`);

        if (allUrls.size === before && p > 1) break;
      } catch (e) {
        console.log(`    ⏹ שגיאה - עוצר (${e.message.substring(0, 30)})`);
        break;
      }
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
      // === כותרת — Elementor h2 ===
      let title = document.querySelector('.elementor-widget-heading h1, .elementor-widget-heading h2, h1.product_title, h1')?.innerText?.trim() || '';
      title = title.replace(/\s*W?\d{6,}\s*/gi, '').trim();

      // === מחיר (WooCommerce del/ins) ===
      let price = 0, originalPrice = null;
      const priceContainer = document.querySelector('p.price');
      if (priceContainer) {
        const hasDel = priceContainer.querySelector('del');
        const hasIns = priceContainer.querySelector('ins');
        if (hasDel && hasIns) {
          const t1 = hasDel.querySelector('bdi')?.textContent.replace(/[^\d.]/g, '');
          const t2 = hasIns.querySelector('bdi')?.textContent.replace(/[^\d.]/g, '');
          if (t1) originalPrice = parseFloat(t1);
          if (t2) price = parseFloat(t2);
        } else {
          const bdi = priceContainer.querySelector('.woocommerce-Price-amount bdi');
          if (bdi) { const t = bdi.textContent.replace(/[^\d.]/g, ''); if (t) price = parseFloat(t); }
        }
      }

      // === תמונות — JetWoo gallery ===
      const images = [];

      // תמונה ראשית
      document.querySelectorAll('.jet-woo-product-gallery__image img').forEach(img => {
        const src = img.getAttribute('data-large_image') || img.getAttribute('data-src') || img.src || '';
        if (src && src.includes('uploads') && !images.includes(src)) images.push(src);
      });

      // תמונות משניות מ-swiper thumbs
      document.querySelectorAll('.jet-woo-swiper-control-thumbs__item img').forEach(img => {
        const src = img.getAttribute('data-large_image') || img.getAttribute('data-src') || '';
        if (src && src.includes('uploads') && !images.includes(src)) images.push(src);
      });

      // fallback: WooCommerce gallery
      if (images.length === 0) {
        document.querySelectorAll('.woocommerce-product-gallery__image a').forEach(a => {
          if (a.href && a.href.includes('uploads') && !images.includes(a.href)) images.push(a.href);
        });
      }

      // === תיאור ===
      let description = '';
      const descEl = document.querySelector('.woocommerce-product-details__short-description');
      if (descEl) description = descEl.innerText?.trim() || '';

      // === משלוח — מ-accordion ===
      let shipping = null;
      const tabContents = document.querySelectorAll('.wc-tab-inner, .elementor-tab-content');
      for (const tab of tabContents) {
        const text = tab.innerText || '';
        if (text.includes('משלוח') || text.includes('שליח')) {
          // חפש סכום וסף
          const costMatch = text.match(/עלות\s*(\d+)/);
          const thresholdMatch = text.match(/מעל\s*(\d+)/);
          if (costMatch) {
            const cost = parseInt(costMatch[1]);
            const threshold = thresholdMatch ? parseInt(thresholdMatch[1]) : 300;
            shipping = { cost, threshold };
          }
          break;
        }
      }

      // === צבעים ומידות (WooCommerce variation swatches) ===
      const rawColors = [];
      const rawSizes = [];

      document.querySelectorAll('.variable-items-wrapper li').forEach(el => {
        const attrName = (
          el.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') ||
          el.getAttribute('data-attribute_name') || ''
        ).toLowerCase();
        const title = el.getAttribute('data-title') || el.getAttribute('title') || '';
        const isDisabled = el.classList.contains('disabled');
        if (!title) return;

        if (attrName.includes('color') || attrName.includes('צבע') || attrName.includes('pa_color')) {
          rawColors.push({ name: title, disabled: isDisabled });
        } else if (attrName.includes('size') || attrName.includes('מידה') || attrName.includes('pa_size')) {
          rawSizes.push({ name: title, disabled: isDisabled });
        }
      });

      // fallback: select
      if (rawColors.length === 0) {
        document.querySelectorAll('select').forEach(sel => {
          const name = (sel.name || sel.id || '').toLowerCase();
          if (name.includes('color') || name.includes('pa_color') || name.includes('צבע')) {
            Array.from(sel.options).forEach(opt => {
              const val = opt.textContent?.trim();
              if (!val || /בחירת|choose/i.test(val)) return;
              rawColors.push({ name: val, disabled: opt.disabled });
            });
          }
        });
      }
      if (rawSizes.length === 0) {
        document.querySelectorAll('select').forEach(sel => {
          const name = (sel.name || sel.id || '').toLowerCase();
          if (name.includes('size') || name.includes('pa_size') || name.includes('מידה')) {
            Array.from(sel.options).forEach(opt => {
              const val = opt.textContent?.trim();
              if (!val || /בחירת|choose/i.test(val)) return;
              rawSizes.push({ name: val, disabled: opt.disabled });
            });
          }
        });
      }

      // === Variations JSON ===
      let variationsData = null;
      const form = document.querySelector('form.variations_form');
      if (form) {
        try {
          const json = form.getAttribute('data-product_variations');
          if (json) variationsData = JSON.parse(json);
        } catch(e) {}
      }

      return { title, price, originalPrice, images, description, shipping, rawColors, rawSizes, variationsData };
    });

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
      if (data.rawColors.length === 0) {
        for (const size of data.rawSizes) {
          if (size.disabled) continue;
          normalizeSize(size.name).forEach(s => availableSizes.add(s));
        }
      }
    }

    const uniqueColors = [...availableColors];
    const uniqueSizes = [...availableSizes];
    const mainColor = uniqueColors[0] || null;

    // דלג על מוצרים ללא מידות
    if (uniqueSizes.length === 0) {
      console.log(`  ⏭️ דלג - אין מידות`);
      return null;
    }

    // משלוח
    let shippingObj = null;
    if (data.shipping) {
      shippingObj = { cost: data.shipping.cost, threshold: data.shipping.threshold, isFree: false };
    } else {
      // ברירת מחדל לפי האתר: 35 ש"ח, חינם מעל 399
      shippingObj = { cost: 35, threshold: 399, isFree: data.price >= 399 };
    }

    console.log(`  ✓ ${data.title.substring(0, 40)}`);
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${mainColor || '-'} (${uniqueColors.join(',')}) | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    console.log(`    📊 סגנון: ${style || '-'} | קטגוריה: ${category || '-'} | גיזרה: ${fit || '-'} | בד: ${fabric || '-'} | דוגמא: ${pattern || '-'}`);

    return {
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
      ['AVIVIT', product.title, product.price || 0, product.originalPrice || null,
       product.images[0] || '', product.images, product.sizes, product.mainColor,
       product.colors, product.style || null, product.fit || null, product.category,
       product.description || null, product.url, JSON.stringify(product.colorSizes),
       product.pattern || null, product.fabric || null,
       product.designDetails?.length ? product.designDetails : null]
    );
    console.log('  💾 saved');
  } catch (err) {
    console.log(`  ✗ DB: ${err.message.substring(0, 50)}`);
  }
}

// ======================================================================
// הרצה ראשית
// ======================================================================
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'he-IL',
  extraHTTPHeaders: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  }
});
const page = await context.newPage();

try {
  // ביקור בדף הבית קודם — לבנות cookies ולהיראות אנושי
  console.log('🌐 ביקור בדף הבית...');
  await page.goto('https://avivit-weizman.co.il/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const urls = await getAllProductUrls(page);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);

  let ok = 0, fail = 0;
  const MAX_PRODUCTS = parseInt(process.env.SCRAPER_MAX_PRODUCTS) || 99999;
  for (let i = 0; i < Math.min(urls.length, MAX_PRODUCTS); i++) {
    console.log(`\n[${i + 1}/${urls.length}]`);
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
