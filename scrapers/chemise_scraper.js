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

console.log('🚀 Chemise Scraper');

// ======================================================================
// מיפוי צבעים
// ======================================================================
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



async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים...\n');
  const allUrls = new Set();
  
  const MAX_PAGES = parseInt(process.env.SCRAPER_MAX_PAGES) || 50;
  const categories = [
    { base: 'https://chemise.co.il/product-category/%d7%a0%d7%a9%d7%99%d7%9d/', maxPages: MAX_PAGES },
    { base: 'https://chemise.co.il/product-category/new-%d7%a0%d7%a9%d7%99%d7%9d/', maxPages: MAX_PAGES },
    { base: 'https://chemise.co.il/product-category/%d7%94%d7%91%d7%99%d7%99%d7%a1%d7%99%d7%a7-%d7%a9%d7%9c%d7%a0%d7%95/%d7%91%d7%99%d7%99%d7%a1%d7%99%d7%a7-%d7%9c%d7%a0%d7%a9%d7%99%d7%9d/', maxPages: MAX_PAGES },
  ];
  
  for (const cat of categories) {
    console.log(`  📁 ${cat.base.split('category/')[1]?.substring(0, 30)}...`);
    
    for (let p = 1; p <= cat.maxPages; p++) {
      const url = p === 1 ? cat.base : `${cat.base}page/${p}/`;
      try {
        console.log(`  → page ${p}`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 });
        await page.waitForTimeout(2000);
        
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1000);
        }
        
        const urls = await page.evaluate(() => 
          [...document.querySelectorAll('a[href*="/product/"]')]
            .map(a => a.href)
            .filter(h => h.includes('chemise.co.il/product/'))
            .filter((v, i, a) => a.indexOf(v) === i)
        );
        
        if (urls.length === 0) {
          console.log(`    ⏹ עמוד ריק - עוצר`);
          break;
        }
        
        urls.forEach(u => allUrls.add(u));
        console.log(`    ✓ ${urls.length} (סה"כ: ${allUrls.size})`);
      } catch (e) {
        console.log(`    ⏹ שגיאה - עוצר`);
        break;
      }
    }
  }
  
  return [...allUrls];
}

// ======================================================================
// סריקת מוצר
// ======================================================================
async function scrapeProduct(page, url) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 40) || url;
  console.log(`\n🔍 ${shortUrl}...`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    
    const data = await page.evaluate(() => {
      // === כותרת ===
      let title = document.querySelector('h1.product_title, h1.elementor-heading-title')?.innerText?.trim() || '';
      
      // === מחיר (WooCommerce del/ins) ===
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

      // פונקציה: מחלץ את ה-URL הכי גדול מ-srcset (אלה הקבצים שבטוח קיימים בשרת)
      function getBestSrcsetUrl(img) {
        const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
        if (!srcset || srcset.startsWith('data:')) return '';
        const parts = srcset.split(',').map(s => s.trim());
        let best = '', bestW = 0;
        parts.forEach(p => {
          const m = p.match(/(\S+)\s+(\d+)w/);
          if (m && parseInt(m[2]) > bestW) { bestW = parseInt(m[2]); best = m[1]; }
        });
        return best;
      }

      // מחלץ URL מ-img: srcset > src (אם לא data URI) > data-large_image
      function getImgUrl(img) {
        const srcset = getBestSrcsetUrl(img);
        if (srcset && srcset.includes('uploads')) return srcset;
        const src = img.getAttribute('src') || '';
        if (src && !src.startsWith('data:') && src.includes('uploads')) return src;
        const large = img.getAttribute('data-large_image') || '';
        if (large && large.includes('uploads')) return large;
        return '';
      }

      // שלב 1: סליידים אמיתיים בלבד (ללא clones) לפי data-index ייחודי
      const seenIndexes = new Set();
      document.querySelectorAll('.iconic-woothumbs-images__slide').forEach(slide => {
        const idx = slide.getAttribute('data-index');
        if (idx === null || seenIndexes.has(idx)) return; // דלג על clones
        seenIndexes.add(idx);
        const img = slide.querySelector('img');
        if (!img) return;
        const url = getImgUrl(img);
        if (url && !images.includes(url)) images.push(url);
      });

      // שלב 2: fallback — WooCommerce gallery
      if (images.length === 0) {
        document.querySelectorAll('.woocommerce-product-gallery__image a').forEach(a => {
          if (a.href && a.href.includes('uploads') && !images.includes(a.href)) images.push(a.href);
        });
      }
      
      // === תיאור מ-Elementor toggle "תיאור מוצר" ===
      let description = '';
      document.querySelectorAll('.elementor-toggle-title').forEach(titleEl => {
        const titleText = titleEl.textContent?.trim() || '';
        if (titleText.includes('תיאור מוצר') || titleText.includes('תיאור')) {
          const tabId = titleEl.closest('.elementor-tab-title')?.getAttribute('data-tab');
          if (tabId) {
            const contentEl = document.querySelector(`.elementor-tab-content[data-tab="${tabId}"]`);
            if (contentEl) {
              const text = contentEl.innerText?.trim();
              if (text) description = text;
            }
          }
        }
      });
      
      // fallback: short description
      if (!description) {
        const descEl = document.querySelector('.woocommerce-product-details__short-description');
        if (descEl) description = descEl.innerText?.trim() || '';
      }
      
      // === צבעים ומידות מ-WooCommerce variation swatches ===
      const rawColors = [];
      const rawSizes = [];
      
      // שיטה 1: swatches buttons + select
      document.querySelectorAll('.variable-items-wrapper li').forEach(el => {
        const attrName = el.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || 
                        el.getAttribute('data-attribute_name') || '';
        const title = el.getAttribute('data-title') || el.getAttribute('title') || '';
        const isDisabled = el.classList.contains('disabled');
        
        if (!title) return;
        
        if (attrName.includes('color') || attrName.includes('צבע') || attrName.includes('pa_color')) {
          rawColors.push({ name: title, disabled: isDisabled });
        } else if (attrName.includes('size') || attrName.includes('מידה') || attrName.includes('pa_size')) {
          rawSizes.push({ name: title, disabled: isDisabled });
        }
      });
      
      // שיטה 2: select fallback (select עם class out-of-stock)
      if (rawColors.length === 0) {
        document.querySelectorAll('select[name*="color"] option, select[name*="pa_color"] option').forEach(opt => {
          const val = opt.textContent?.trim();
          if (!val || val.includes('בחירת')) return;
          rawColors.push({ name: val, disabled: opt.classList.contains('out-of-stock') || opt.disabled });
        });
      }
      if (rawSizes.length === 0) {
        document.querySelectorAll('select[name*="size"] option, select[name*="pa_size"] option').forEach(opt => {
          const val = opt.textContent?.trim();
          if (!val || val.includes('בחירת')) return;
          rawSizes.push({ name: val, disabled: opt.classList.contains('out-of-stock') || opt.disabled });
        });
      }
      
      // === Variations JSON (לבדיקת מלאי מדויקת) ===
      let variationsData = null;
      const form = document.querySelector('form.variations_form');
      if (form) {
        try {
          const json = form.getAttribute('data-product_variations');
          if (json) variationsData = JSON.parse(json);
        } catch(e) {}
      }
      
      return { title, price, originalPrice, images, description, rawColors, rawSizes, variationsData };
    });
    
    if (!data.title) { console.log('  ✗ no title'); return null; }
    
    const style = detectStyle(data.title, data.description);
    const fit = detectFit(data.title, data.description);
    const category = detectCategory(data.title);
    const pattern = detectPattern(data.title, data.description);
    const fabric = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);
    
    // === עיבוד צבעים ומידות ===
    const colorSizesMap = {};
    const availableSizes = new Set();
    const allSizesSet = new Set();
    const availableColors = new Set();
    
    if (data.variationsData && data.variationsData.length > 0) {
      // שיטה 1: JSON מדויק
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
          // חפש שם תצוגה מ-rawColors
          for (const rc of data.rawColors) {
            const rcLower = rc.name.toLowerCase();
            const valLower = displayColor.toLowerCase();
            if (rcLower === valLower || rcLower.includes(valLower) || valLower.includes(rcLower)) {
              displayColor = rc.name;
              break;
            }
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
      // שיטה 2: מ-swatches (disabled class)
      console.log(`    ⚠️ אין JSON - משתמש ב-swatches`);
      
      for (const color of data.rawColors) {
        if (color.disabled) continue;
        const normColor = normalizeColor(color.name);
        if (!normColor) { console.log(`      ⚠️ צבע לא מזוהה: ${color.name}`); continue; }
        availableColors.add(normColor);
        if (!colorSizesMap[normColor]) colorSizesMap[normColor] = [];
        
        // כל מידה שלא disabled
        for (const size of data.rawSizes) {
          if (size.disabled) continue;
          const normSizes = normalizeSize(size.name);
          for (const ns of normSizes) {
            availableSizes.add(ns);
            if (!colorSizesMap[normColor].includes(ns)) colorSizesMap[normColor].push(ns);
          }
        }
      }
      
      // אם אין צבעים, רק מידות
      if (data.rawColors.length === 0) {
        for (const size of data.rawSizes) {
          if (size.disabled) continue;
          const normSizes = normalizeSize(size.name);
          normSizes.forEach(s => availableSizes.add(s));
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
    const mainColor = uniqueColors[0] || null;

    if (uniqueSizes.length === 0) {
      console.log(`  ✗ אין מידות במלאי — ${data.title.substring(0, 35)}`);
      return null;
    }

    console.log(`  ✓ ${data.title.substring(0, 40)}`);
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${mainColor || '-'} | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    console.log(`    📁 ${category || '-'} | סגנון: ${style || '-'} | גיזרה: ${fit || '-'} | בד: ${fabric || '-'}`);
    
    return {
      title: data.title,
      price: data.price,
      originalPrice: data.originalPrice,
      images: data.images,
      colors: uniqueColors,
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
      url
    };
    
  } catch (err) {
    console.log(`  ✗ ${err.message.substring(0, 40)}`);
    return null;
  }
}

// ======================================================================
// שמירה
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
      ['CHEMISE', product.title, product.price || 0, product.originalPrice || null,
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
// הרצה
// ======================================================================
const browser = await chromium.launch({ headless: true, slowMo: 30 });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  viewport: { width: 1920, height: 1080 }
});
const page = await context.newPage();

try {
  const urls = await getAllProductUrls(page);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);
  
  let ok = 0, fail = 0;
  const MAX_PRODUCTS = parseInt(process.env.SCRAPER_MAX_PRODUCTS) || 50;
  for (let i = 0; i < urls.length; i++) {
    if (ok >= MAX_PRODUCTS) { console.log(`\n⏹ הגענו ל-${MAX_PRODUCTS} מוצרים - עוצר`); break; }
    console.log(`\n[${i + 1}/${urls.length}]`);
    const p = await scrapeProduct(page, urls[i]);
    if (p) { await saveProduct(p); ok++; } else fail++;
    await page.waitForTimeout(500);
  }
  
  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  await runHealthCheck(ok, fail);
  
} finally {
  await browser.close();
  await db.end();
}

async function runHealthCheck(scraped, failed) {
  console.log('\n🔍 בודק תקינות נתונים...');
  const problems = [];
  
  if (unknownColors.size > 0) {
    problems.push(`⚠️ צבעים לא מזוהים (${unknownColors.size}):`);
    for (const c of unknownColors) problems.push(`   ❓ "${c}"`);
  }
  
  const missingImages = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='CHEMISE' AND (images IS NULL OR array_length(images, 1) = 0)`);
  if (parseInt(missingImages.rows[0].c) > 0) problems.push(`⚠️ מוצרים בלי תמונות: ${missingImages.rows[0].c}`);
  
  const missingSizes = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='CHEMISE' AND (sizes IS NULL OR array_length(sizes, 1) = 0)`);
  if (parseInt(missingSizes.rows[0].c) > 0) problems.push(`⚠️ מוצרים בלי מידות: ${missingSizes.rows[0].c}`);
  
  const total = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='CHEMISE'`);
  console.log(`\n📊 סה"כ CHEMISE ב-DB: ${total.rows[0].c}`);
  
  if (problems.length > 0) {
    console.log(`\n${'='.repeat(50)}\n🚨 בעיות:`);
    problems.forEach(p => console.log('   ' + p));
    console.log('='.repeat(50));
  } else console.log('\n✅ הכל תקין!');
}
