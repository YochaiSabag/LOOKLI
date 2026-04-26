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
// איסוף קישורים
// ======================================================================
async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-avivit-weizman.co.il (sitemap)...\n');
  const allUrls = new Set();

  // ניסיון לקרוא sitemap ישירות (HTTP, לא Playwright - עוקף Cloudflare)
  const sitemapSources = [
    'https://avivit-weizman.co.il/wp-sitemap-posts-product-1.xml',
    'https://avivit-weizman.co.il/wp-sitemap-posts-product-2.xml',
    'https://avivit-weizman.co.il/wp-sitemap-posts-product-3.xml',
    'https://avivit-weizman.co.il/wp-sitemap-posts-product-4.xml',
    'https://avivit-weizman.co.il/wp-sitemap-posts-product-5.xml',
  ];

  for (const sitemapUrl of sitemapSources) {
    try {
      const res = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
      });
      if (!res.ok) { console.log(`  ⏭️ ${sitemapUrl.split('/').pop()} — ${res.status}`); break; }
      const xml = await res.text();
      const matches = [...xml.matchAll(/<loc>(https:\/\/avivit-weizman\.co\.il\/product\/[^<]+)<\/loc>/g)];
      matches.forEach(m => allUrls.add(m[1].trim()));
      console.log(`  ✓ ${sitemapUrl.split('/').pop()} → ${matches.length} URLs`);
      if (matches.length === 0) break;
    } catch(e) {
      console.log(`  ✗ ${e.message.substring(0, 40)}`);
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
async function scrapeProduct(page, url) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 40) || url.substring(0, 50);
  console.log(`\n🔍 ${shortUrl}...`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    // גלילה להפעיל lazy loading
    await page.evaluate(() => { window.scrollTo(0, 400); });
    await page.waitForTimeout(1500);

    const data = await page.evaluate(() => {
      // === כותרת ===
      let title = document.querySelector(
        'h1.product_title, h1.entry-title, .elementor-widget-heading h1, .elementor-widget-heading h2, h1'
      )?.innerText?.trim() || '';
      title = title.replace(/\s*W?\d{6,}\s*/gi, '').trim();

      // === מחיר (WooCommerce del/ins) ===
      let price = 0, originalPrice = null;
      const priceEl = document.querySelector('p.price, .price, .jet-woo-product-price');
      if (priceEl) {
        const hasDel = priceEl.querySelector('del');
        const hasIns = priceEl.querySelector('ins');
        if (hasDel && hasIns) {
          const t1 = hasDel.querySelector('bdi')?.textContent.replace(/[^\d.]/g, '');
          const t2 = hasIns.querySelector('bdi')?.textContent.replace(/[^\d.]/g, '');
          if (t1) originalPrice = parseFloat(t1);
          if (t2) price = parseFloat(t2);
        } else {
          const bdi = priceEl.querySelector('.woocommerce-Price-amount bdi, bdi');
          if (bdi) { const t = bdi.textContent.replace(/[^\d.]/g, ''); if (t) price = parseFloat(t); }
        }
      }

      // === תמונות — JetWoo + WooCommerce + fallbacks ===
      const images = [];
      const addImg = src => { if (src && src.includes('uploads') && !images.includes(src)) images.push(src); };

      // JetWoo gallery
      document.querySelectorAll('.jet-woo-product-gallery__image img').forEach(img => {
        addImg(img.getAttribute('data-large_image') || img.getAttribute('data-src') || img.src);
      });
      document.querySelectorAll('.jet-woo-swiper-control-thumbs__item img').forEach(img => {
        addImg(img.getAttribute('data-large_image') || img.getAttribute('data-src'));
      });
      // Standard WooCommerce gallery links (full size)
      document.querySelectorAll('.woocommerce-product-gallery__image a').forEach(a => addImg(a.href));
      document.querySelectorAll('.woocommerce-product-gallery__image img').forEach(img => {
        addImg(img.getAttribute('data-large_image') || img.getAttribute('data-src'));
      });
      // WooCommerce Blocks gallery
      document.querySelectorAll('.wc-block-components-product-image img, [class*="product-gallery"] img').forEach(img => {
        addImg(img.getAttribute('data-src') || img.src);
      });
      // Elementor image widgets with srcset
      if (images.length === 0) {
        document.querySelectorAll('img[srcset], img[data-srcset]').forEach(img => {
          const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
          const parts = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(s => s.includes('uploads'));
          parts.forEach(addImg);
          addImg(img.getAttribute('data-src') || img.src);
        });
      }

      // === תיאור ===
      let description = '';
      const descEl = document.querySelector(
        '.woocommerce-product-details__short-description, [class*="short-description"], .product-short-description'
      );
      if (descEl) description = descEl.innerText?.trim() || '';

      // === משלוח — מ-accordion / tabs ===
      let shipping = null;
      const tabContents = document.querySelectorAll(
        '.wc-tab-inner, .elementor-tab-content, [class*="tab-content"], .wc-tab, [id*="tab-shipping"]'
      );
      for (const tab of tabContents) {
        const text = tab.innerText || '';
        if (text.includes('משלוח') || text.includes('שליח')) {
          const costMatch = text.match(/(\d+)\s*(?:ש["״]ח|₪)/);
          const thresholdMatch = text.match(/(?:מעל|מעל\s+רכישה\s+של)\s*(\d+)/);
          if (costMatch) {
            shipping = {
              cost: parseInt(costMatch[1]),
              threshold: thresholdMatch ? parseInt(thresholdMatch[1]) : 399
            };
          }
          break;
        }
      }

      // ===  Variations JSON (WooCommerce classic) ===
      let variationsData = null;
      const form = document.querySelector('form.variations_form');
      if (form) {
        const json = form.getAttribute('data-product_variations');
        if (json && json !== '[]' && json !== 'false') {
          try { variationsData = JSON.parse(json); } catch(e) {}
        }
      }

      // === Debug: כל ה-selects וה-swatches בדף ===
      const debugSelects = [...document.querySelectorAll('select')].map(s => ({
        name: s.name, id: s.id, cls: s.className.substring(0,50),
        options: [...s.options].map(o => o.text.trim()).filter(Boolean)
      }));
      const debugSwatchWrappers = [...document.querySelectorAll('[data-attribute_name]')].map(w => ({
        attr: w.getAttribute('data-attribute_name'),
        cls: w.className.substring(0,60),
        liCount: w.querySelectorAll('li').length
      }));
      const debugForms = [...document.querySelectorAll('form')].map(f => ({
        cls: f.className.substring(0,60), id: f.id,
        hasDataVariations: !!f.getAttribute('data-product_variations'),
        dataLen: f.getAttribute('data-product_variations')?.length
      }));
      // Global WC data from window
      const debugGlobals = Object.keys(window).filter(k =>
        k.toLowerCase().includes('wc') || k.toLowerCase().includes('product') || k.toLowerCase().includes('variation')
      ).slice(0, 15);

      // === צבעים ומידות — כל השיטות ===
      const rawColors = [], rawSizes = [];

      // שיטה 1: WooCommerce Variation Swatches plugin (.variable-items-wrapper)
      document.querySelectorAll('.variable-items-wrapper li, ul.variable-items-wrapper li').forEach(el => {
        const wrapper = el.closest('[data-attribute_name]');
        const attrName = (wrapper?.getAttribute('data-attribute_name') || el.getAttribute('data-attribute_name') || '').toLowerCase();
        const val = el.getAttribute('data-title') || el.getAttribute('title') || el.innerText?.trim() || '';
        const isDisabled = el.classList.contains('disabled') || el.classList.contains('out-of-stock');
        if (!val) return;
        if (attrName.includes('color') || attrName.includes('צבע') || attrName.includes('tzba')) rawColors.push({ name: val, disabled: isDisabled });
        else if (attrName.includes('size') || attrName.includes('מידה') || attrName.includes('mida')) rawSizes.push({ name: val, disabled: isDisabled });
        else {
          // attribute name לא ברור — נסה לגלות לפי context
          rawSizes.push({ name: val, disabled: isDisabled });
        }
      });

      // שיטה 2: selects (כולל כל attribute_pa_*)
      document.querySelectorAll('select').forEach(sel => {
        const name = (sel.name || sel.id || sel.className || '').toLowerCase();
        const isColor = name.includes('color') || name.includes('tzba') || name.includes('pa_color') || name.includes('colour');
        const isSize  = name.includes('size') || name.includes('pa_size') || name.includes('mida') || name.includes('pa_mida');
        if (!isColor && !isSize && !name.includes('attribute_pa_')) return;
        Array.from(sel.options).forEach(opt => {
          const val = opt.textContent?.trim();
          if (!val || /בחירת|choose|select/i.test(val)) return;
          if (isColor) rawColors.push({ name: val, disabled: opt.disabled });
          else rawSizes.push({ name: val, disabled: opt.disabled });
        });
      });

      // שיטה 3: radio buttons
      document.querySelectorAll('input[type="radio"][name^="attribute_"]').forEach(radio => {
        const name = radio.name.toLowerCase();
        const val = radio.getAttribute('data-original_value') || radio.value;
        const label = document.querySelector(`label[for="${radio.id}"]`)?.innerText?.trim() || val;
        if (!val || val === '') return;
        if (name.includes('color') || name.includes('tzba')) rawColors.push({ name: label, disabled: radio.disabled });
        else rawSizes.push({ name: label, disabled: radio.disabled });
      });

      // שיטה 4: TAWCVS / YITH swatches
      document.querySelectorAll('.tawcvs-swatches span[data-value], .wvs-product-attribute-item').forEach(el => {
        const wrapper = el.closest('[data-attribute_name], [data-taxonomy]');
        const attrName = (wrapper?.getAttribute('data-attribute_name') || wrapper?.getAttribute('data-taxonomy') || '').toLowerCase();
        const val = el.getAttribute('data-value') || el.getAttribute('data-title') || el.innerText?.trim() || '';
        if (!val) return;
        if (attrName.includes('color') || attrName.includes('tzba')) rawColors.push({ name: val, disabled: el.classList.contains('disabled') });
        else rawSizes.push({ name: val, disabled: el.classList.contains('disabled') });
      });

      return {
        title, price, originalPrice, images, description, shipping,
        rawColors, rawSizes, variationsData,
        _debug: { selects: debugSelects, swatchWrappers: debugSwatchWrappers, forms: debugForms, globals: debugGlobals }
      };
    });

    // === Debug log ===
    const d = data._debug;
    if (d.selects.length > 0) console.log(`    🔧 selects: ${d.selects.map(s=>`${s.name||s.id}(${s.options.length})`).join(', ')}`);
    if (d.swatchWrappers.length > 0) console.log(`    🔧 swatches: ${d.swatchWrappers.map(w=>`${w.attr}[${w.liCount}li]`).join(', ')}`);
    if (d.forms.length > 0) console.log(`    🔧 forms: ${d.forms.map(f=>`${f.cls||f.id}(vars:${f.dataLen||0})`).join(', ')}`);
    if (data.rawColors.length === 0 && data.rawSizes.length === 0 && !data.variationsData) {
      console.log(`    ⚠️ DEBUG - אין צבעים/מידות/JSON`);
      console.log(`    ⚠️ selects: ${JSON.stringify(d.selects)}`);
      console.log(`    ⚠️ swatches: ${JSON.stringify(d.swatchWrappers)}`);
      console.log(`    ⚠️ forms: ${JSON.stringify(d.forms)}`);
    }

    if (!data.title) { console.log('  ✗ no title'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ מדלג (לא רלוונטי): ${data.title.substring(0,30)}`); return null; }

    const style = detectStyle(data.title, data.description);
    const fit = detectFit(data.title, data.description);
    const category = detectCategory(data.title);
    const pattern = detectPattern(data.title, data.description);
    const fabric = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);


    const colorSizesMap = {};
    const availableSizes = new Set();
    const allSizesSet = new Set();
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

    // collect all sizes regardless of disabled status
    (data.rawSizes || []).forEach(size => {
      normalizeSize(size.name).forEach(s => allSizesSet.add(s));
    });

    const uniqueColors = [...availableColors];
    const uniqueSizes = [...availableSizes];
    const allUniqueSizes = [...allSizesSet];

    // חילוץ צבע מהכותרת אם לא נמצא מהסלקטורים (כי אביבית שמה צבע בשם מוצר)
    let mainColor = uniqueColors[0] || null;
    if (!mainColor) {
      const titleWords = (data.title || '').split(/[\s\-–,]+/);
      for (const word of titleWords) {
        if (word.length < 2) continue;
        const c = normalizeColor(word.toLowerCase().trim());
        if (c && c !== 'אחר') { mainColor = c; break; }
      }
      if (!mainColor) {
        const c = normalizeColor(data.title);
        if (c && c !== 'אחר') mainColor = c;
      }
      if (!mainColor) console.log(`    ⚠️ לא זוהה צבע מכותרת: ${data.title}`);
    }

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
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${mainColor || '-'} | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    console.log(`    📊 סגנון: ${style || '-'} | קטגוריה: ${category || '-'} | גיזרה: ${fit || '-'} | בד: ${fabric || '-'} | דוגמא: ${pattern || '-'}`);

    // אם צבע מהכותרת — בנה colorSizesMap ממנו
    const finalColors = mainColor ? (uniqueColors.length > 0 ? uniqueColors : [mainColor]) : uniqueColors;
    if (mainColor && Object.keys(colorSizesMap).length === 0 && uniqueSizes.length > 0) {
      colorSizesMap[mainColor] = uniqueSizes;
    }

    return {
      title: data.title,
      price: data.price,
      originalPrice: data.originalPrice,
      images: data.images,
      colors: finalColors,
      sizes: uniqueSizes,
      allSizes: allUniqueSizes,
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
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, pattern, fabric, design_details, all_sizes, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title=EXCLUDED.title, price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url, images=EXCLUDED.images, sizes=EXCLUDED.sizes,
         color=EXCLUDED.color, colors=EXCLUDED.colors, style=EXCLUDED.style, fit=EXCLUDED.fit,
         category=EXCLUDED.category, description=EXCLUDED.description,
         color_sizes=EXCLUDED.color_sizes, pattern=EXCLUDED.pattern, fabric=EXCLUDED.fabric,
         design_details=EXCLUDED.design_details, all_sizes=EXCLUDED.all_sizes, last_seen=NOW()`,
      ['AVIVIT', product.title, product.price || 0, product.originalPrice || null,
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
