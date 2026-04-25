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
console.log('🚀 Rare Scraper');

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



// איסוף קישורים מעמוד הכל
// ======================================================================
async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-rare.co.il...\n');
  const allUrls = new Set();

  await page.goto('https://rare.co.il/all', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // טען את העמוד וחכה
  await page.waitForTimeout(3000);

  // גלול פעם אחת למטה ובחזרה — לטעינת כל המוצרים
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // איסוף קישורים — לפי PicID מ-hidden inputs
  const urls = await page.evaluate(() => {
    const seen = new Set();
    const base = 'https://rare.co.il/catalog.asp?page=newshowprod.asp&prodid=';
    document.querySelectorAll('input[name="PicID"]').forEach(input => {
      const picid = input.value;
      if (picid) seen.add(base + picid);
    });
    return [...seen];
  });

  urls.forEach(u => allUrls.add(u));
  console.log(`\n  ✓ סה"כ: ${allUrls.size} קישורים ייחודיים\n`);
  return [...allUrls];
}

// ======================================================================
// סריקת מוצר בודד
// ======================================================================
async function scrapeProduct(page, url) {
  const shortUrl = url.substring(url.lastIndexOf('/') + 1, url.lastIndexOf('/') + 40);
  console.log(`\n🔍 ${shortUrl}...`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);

    // המתן לכותרת
    try {
      await page.waitForSelector('.CssCatProductAdjusted_header, h1', { timeout: 8000 });
    } catch(e) {}

    const data = await page.evaluate(() => {
      // === כותרת ===
      const titleEl = document.querySelector('.CssCatProductAdjusted_header span[itemprop="name"], .CssCatProductAdjusted_header h1, h1');
      const title = titleEl?.innerText?.trim() || '';

      // === מחיר ===
      let price = 0, originalPrice = null;
      // מחיר מבצע
      const saleEl = document.querySelector('.CssCatProductAdjusted_PriceSpecial .CAT_Values');
      // מחיר רגיל (עם קו)
      const regularEl = document.querySelector('.CssCatProductAdjusted_Price .CAT_Values');

      if (saleEl) {
        const t = saleEl.textContent.replace(/[^\d.]/g, '');
        if (t) price = parseFloat(t);
        if (regularEl) {
          const t2 = regularEl.textContent.replace(/[^\d.]/g, '');
          if (t2) originalPrice = parseFloat(t2);
        }
      } else if (regularEl) {
        const t = regularEl.textContent.replace(/[^\d.]/g, '');
        if (t) price = parseFloat(t);
      }

      // === תמונות ===
      const images = [];
      const baseUrl = window.location.origin + '/';

      // תמונה ראשית
      const mainImg = document.querySelector('.CssCatProductAdjusted_BigPic a.CatIMG_PictureBig_Clean_Link');
      if (mainImg) {
        const href = mainImg.getAttribute('href') || '';
        if (href) {
          const full = href.startsWith('http') ? href : baseUrl + href;
          images.push(full);
        }
      }

      // תמונות משניות
      document.querySelectorAll('.CssCatProductAdjusted_MorePics a').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (href) {
          const full = href.startsWith('http') ? href : baseUrl + href;
          if (!images.includes(full)) images.push(full);
        }
      });

      // === תיאור ===
      const descEl = document.querySelector('.CssCatProductAdjusted_PicDesc span[itemprop="description"]');
      const description = descEl?.innerText?.trim().replace(/טבלת מידות בתחתית העמוד[\s\S]*/i, '').trim() || '';

      // === מידות — רשימה בלבד, בדיקת מלאי תיעשה אחרי ===
      const sizeItems = [];
      document.querySelectorAll('ul.clsUlChooseProduct li.clsLIChooseProduct').forEach(li => {
        const text = li.querySelector('span.cls_elm_extra_product_Li_Text')?.innerText?.trim() || '';
        if (text) sizeItems.push(text);
      });

      return { title, price, originalPrice, images, description, sizeItems };
    });

    if (!data.title) { console.log('  ✗ no title'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ דלג: ${data.title.substring(0, 30)}`); return null; }

    // === בדיקת מלאי לכל מידה בלחיצה ===
    const rawSizes = [];
    for (const sizeName of (data.sizeItems || [])) {
      try {
        // לחץ על המידה
        await page.evaluate((name) => {
          const li = [...document.querySelectorAll('ul.clsUlChooseProduct li.clsLIChooseProduct')]
            .find(el => el.querySelector('span.cls_elm_extra_product_Li_Text')?.innerText?.trim() === name);
          if (li) li.click();
        }, sizeName);
        await page.waitForTimeout(600);

        // בדוק אם מופיע "אזל במלאי"
        const isOutOfStock = await page.evaluate(() => {
          const inv = document.querySelector('.CssCatProductAdjusted_InventoryDesc');
          return inv ? inv.innerText.includes('אזל') || inv.innerText.includes('אין במלאי') : false;
        });
        rawSizes.push({ name: sizeName, disabled: isOutOfStock });
      } catch(e) {
        rawSizes.push({ name: sizeName, disabled: false });
      }
    }

    // fallback אם אין מידות
    if (rawSizes.length === 0) {
      const fallback = await page.evaluate(() => {
        const sizes = [];
        document.querySelectorAll('select.clsSelectChooseProduct option').forEach(opt => {
          const val = opt.textContent?.trim();
          if (!val || val.includes('בחירת') || val === '---') return;
          sizes.push({ name: val, disabled: opt.disabled });
        });
        return sizes;
      });
      rawSizes.push(...fallback);
    }

    // זיהוי מטא-דאטה
    const category = detectCategory(data.title);
    const style = detectStyle(data.title, data.description);
    const fit = detectFit(data.title, data.description);
    const pattern = detectPattern(data.title, data.description);
    const fabric = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);

    console.log(`    מידות: ${rawSizes.map(s=>(s.disabled?'✗':'✓')+' '+s.name).join(' | ')}`);

    // עיבוד מידות
    const availableSizes = new Set();
    const allSizesSet = new Set();
    for (const size of rawSizes) {
      if (size.disabled) continue;
      normalizeSize(size.name).forEach(s => availableSizes.add(s));
    }
    // collect all sizes regardless of disabled status
    rawSizes.forEach(size => {
      normalizeSize(size.name).forEach(s => allSizesSet.add(s));
    });

    const uniqueSizes = [...availableSizes];
    const allUniqueSizes = [...allSizesSet];

    // דלג על מוצרים ללא מידות
    if (uniqueSizes.length === 0) {
      console.log(`  ⏭️ דלג - אין מידות`);
      return null;
    }

    // חילוץ צבע מהכותרת
    let mainColor = null;
    const titleWords = (data.title || '').split(/[\s\-–,]+/);
    for (const word of titleWords) {
      if (word.length < 2) continue;
      const lower = word.toLowerCase().trim();
      const c = normalizeColor(lower);
      if (c && c !== 'אחר') { mainColor = c; break; }
    }
    if (!mainColor) mainColor = normalizeColor(data.title) !== 'אחר' ? normalizeColor(data.title) : null;

    console.log(`  ✓ ${data.title.substring(0, 40)}`);
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${mainColor || '-'} | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    console.log(`    📊 קטגוריה: ${category || '-'} | סגנון: ${style || '-'} | גיזרה: ${fit || '-'} | בד: ${fabric || '-'}`);

    return {
      title: data.title,
      price: data.price,
      originalPrice: data.originalPrice,
      images: data.images,
      colors: mainColor ? [mainColor] : [],
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
      colorSizes: {},
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
      ['RARE', product.title, product.price || 0, product.originalPrice || null,
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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 }
});
const page = await context.newPage();

try {
  const urls = await getAllProductUrls(page);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);

  let ok = 0, fail = 0;
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
    for (const c of unknownColors) problems.push(`   ❓ "${c}"`);
  }

  const mi = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='RARE' AND (images IS NULL OR array_length(images,1)=0)`);
  if (parseInt(mi.rows[0].c) > 0) problems.push(`⚠️ ללא תמונות: ${mi.rows[0].c}`);

  const ms = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='RARE' AND (sizes IS NULL OR array_length(sizes,1)=0)`);
  if (parseInt(ms.rows[0].c) > 0) problems.push(`⚠️ ללא מידות: ${ms.rows[0].c}`);

  const total = await db.query(`SELECT COUNT(*) as c FROM products WHERE store='RARE'`);
  console.log(`\n📊 סה"כ RARE ב-DB: ${total.rows[0].c}`);

  if (problems.length > 0) {
    console.log(`\n${'='.repeat(50)}\n🚨 בעיות:`);
    problems.forEach(p => console.log('   ' + p));
    console.log('='.repeat(50));
  } else {
    console.log('\n✅ הכל תקין!');
  }
}
