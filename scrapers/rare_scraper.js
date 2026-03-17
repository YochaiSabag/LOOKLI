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
const colorMap = {
  'black': 'שחור', 'שחור': 'שחור',
  'white': 'לבן', 'לבן': 'לבן',
  'blue': 'כחול', 'כחול': 'כחול', 'navy': 'כחול', 'נייבי': 'כחול', 'denim': 'כחול', 'indigo': 'כחול',
  'red': 'אדום', 'אדום': 'אדום',
  'green': 'ירוק', 'ירוק': 'ירוק', 'olive': 'ירוק', 'זית': 'ירוק', 'khaki': 'ירוק', 'חאקי': 'ירוק',
  'brown': 'חום', 'חום': 'חום', 'coffee': 'חום', 'קפה': 'חום', 'mocha': 'חום', 'chestnut': 'חום',
  'camel': 'קאמל', 'קאמל': 'קאמל',
  'beige': "בז'", 'בז': "בז'", 'nude': "בז'", 'ניוד': "בז'", 'sand': "בז'",
  'gray': 'אפור', 'grey': 'אפור', 'אפור': 'אפור', 'charcoal': 'אפור',
  'pink': 'ורוד', 'ורוד': 'ורוד', 'coral': 'ורוד', 'קורל': 'ורוד', 'blush': 'ורוד', 'rose': 'ורוד', 'salmon': 'ורוד',
  'purple': 'סגול', 'סגול': 'סגול', 'lilac': 'סגול', 'לילך': 'סגול', 'lavender': 'סגול', 'violet': 'סגול', 'plum': 'סגול', 'ארגמן': 'סגול',
  'yellow': 'צהוב', 'צהוב': 'צהוב', 'mustard': 'צהוב', 'חרדל': 'צהוב', 'gold': 'צהוב',
  'orange': 'כתום', 'כתום': 'כתום', 'rust': 'כתום',
  'זהב': 'זהב', 'golden': 'זהב',
  'silver': 'כסף', 'כסף': 'כסף',
  'bordo': 'בורדו', 'בורדו': 'בורדו', 'burgundy': 'בורדו', 'wine': 'בורדו', 'maroon': 'בורדו',
  'cream': 'שמנת', 'שמנת': 'שמנת', 'ivory': 'שמנת', 'ecru': 'שמנת',
  'turquoise': 'תכלת', 'תכלת': 'תכלת', 'טורקיז': 'תכלת', 'aqua': 'תכלת',
  'פרחוני': 'פרחוני', 'צבעוני': 'צבעוני', 'multi': 'צבעוני',
  'mint': 'מנטה', 'מנטה': 'מנטה',
  'אפרסק': 'אפרסק', 'peach': 'אפרסק',
  'מוקה': 'חום', 'שזיף': 'סגול',
  'פודרה': 'ורוד', 'powder': 'ורוד',
  'אבן': 'אבן', 'stone': 'אבן',
  'בהיר': 'בהיר',
};

const unknownColors = new Set();

function normalizeColor(c) {
  if (!c) return null;
  const lower = c.toLowerCase().trim();
  const noSpaces = lower.replace(/[-_\s]/g, '');
  if (colorMap[noSpaces]) return colorMap[noSpaces];
  if (colorMap[lower]) return colorMap[lower];
  const words = lower.split(/[\s\-]+/);
  for (const word of words) {
    if (colorMap[word]) return colorMap[word];
  }
  for (const [key, val] of Object.entries(colorMap)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  unknownColors.add(c);
  return 'אחר';
}

// ======================================================================
// מיפוי מידות
// ======================================================================
const sizeMapping = {
  'Y': ['XS'], '0': ['S'], '1': ['M'], '2': ['L'], '3': ['XL'], '4': ['XXL'], '5': ['XXXL'],
  '34': ['XS'], '36': ['XS', 'S'], '38': ['S', 'M'], '40': ['M', 'L'],
  '42': ['L', 'XL'], '44': ['XL', 'XXL'], '46': ['XXL', 'XXXL'], '48': ['XXXL'], '50': ['XXXL']
};

function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  if (/^(XS|S|M|L|XL|2?XXL|XXXL)$/i.test(val)) return [val.replace('2XL', 'XXL')];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (sizeMapping[val]) return sizeMapping[val];
  return [];
}

// ======================================================================
// סינון מוצרים לא רלוונטיים
// ======================================================================
const SKIP_KEYWORDS = [
  'עגיל','עגילי','עגיות','שרשרת','צמיד','טבעת','תכשיט','כובע','צעיף','תיק','ארנק','משקפיים','משקפי שמש',
  'גומייה','מטפחת','קשת','שעון','קישוט שיער','שיער',
  'נעל','נעלי','סנדל','סנדלי','מגף','מגפיים','מגפון','כפכף','בלרינה','מוקסין','אספדריל','קבקב',
  'בגד ים','ביקיני','בגדי ים',
  'ילדה','ילדות',"ג'וניור",'junior','kids',
  "פיג'מה",'פיגמה','גרביון','גרביים',
];

function shouldSkip(title) {
  if (!title) return false;
  const t = title.toLowerCase().trim();
  for (const k of SKIP_KEYWORDS) {
    const kl = k.toLowerCase();
    let match = false;
    if (kl.includes(' ')) {
      match = t.includes(kl);
    } else {
      const idx = t.indexOf(kl);
      if (idx !== -1) {
        const before = idx === 0 || /[\s,\-–\/״"()]/.test(t[idx - 1]);
        const after = idx + kl.length === t.length || /[\s,\-–\/״"().!?]/.test(t[idx + kl.length]);
        match = before && after;
      }
    }
    if (match) return true;
  }
  return false;
}

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (/קרדיגן|cardigan/i.test(t)) return 'קרדיגן';
  if (/סוודר|sweater/i.test(t)) return 'סוודר';
  if (/טוניקה|tunic/i.test(t)) return 'טוניקה';
  if (/סרפן|pinafore/i.test(t)) return 'סרפן';
  if (/שמלה|שמלת|dress/i.test(t)) return 'שמלה';
  if (/חצאית|skirt/i.test(t)) return 'חצאית';
  if (/חולצה|חולצת|טופ|top|shirt|blouse/i.test(t)) return 'חולצה';
  if (/בלייזר|blazer/i.test(t)) return 'בלייזר';
  if (/ז׳קט|ג׳קט|jacket/i.test(t)) return 'מעיל';
  if (/וסט|vest/i.test(t)) return 'וסט';
  if (/מעיל|coat/i.test(t)) return 'מעיל';
  if (/חלוק|robe/i.test(t)) return 'חלוק';
  if (/אוברול|jumpsuit/i.test(t)) return 'אוברול';
  if (/סט|set/i.test(t)) return 'סט';
  if (/גולף|turtleneck/i.test(t)) return 'חולצה';
  return null;
}

function detectStyle(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/שבת|ערב|אירוע|מיוחד|חגיג|אלגנט|elegant|יוקרת/i.test(text)) return 'ערב';
  if (/יום.?חול|casual|יומיומי|daily/i.test(text)) return 'יום חול';
  if (/קלאסי|classic/i.test(text)) return 'קלאסי';
  if (/מינימליסט|minimal/i.test(text)) return 'מינימליסטי';
  if (/אוברסייז|oversize/i.test(text)) return 'אוברסייז';
  if (/בייסיק|basic/i.test(text)) return 'יום חול';
  return '';
}

function detectFit(title, description = '') {
  const text = (title || '').toLowerCase();
  if (/ישרה|straight/i.test(text)) return 'ישרה';
  if (/a.?line/i.test(text)) return 'A';
  if (/מתרחב|flare/i.test(text)) return 'מתרחבת';
  if (/רפוי|רחב|loose/i.test(text)) return 'רפויה';
  if (/מעטפ|wrap/i.test(text)) return 'מעטפת';
  if (/צמוד|tight|fitted/i.test(text)) return 'צמודה';
  if (/מקסי|maxi|ארוכ/i.test(text)) return 'ארוכה';
  if (/מידי|midi/i.test(text)) return 'מידי';
  if (/קצר|מיני|mini/i.test(text)) return 'קצרה';
  if (/מחויט|tailored/i.test(text)) return 'מחויטת';
  if (/הריון|maternity/i.test(text)) return 'הריון';
  if (/הנקה|nursing/i.test(text)) return 'הנקה';
  return '';
}

function detectPattern(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/פסים|striped/i.test(text)) return 'פסים';
  if (/פרחוני|פרחים|floral/i.test(text)) return 'פרחוני';
  if (/משבצות|plaid/i.test(text)) return 'משבצות';
  if (/נקודות|dots/i.test(text)) return 'נקודות';
  if (/הדפס|print/i.test(text)) return 'הדפס';
  if (/חלקה?\b|plain|solid/i.test(text)) return 'חלק';
  return '';
}

function detectFabric(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/סריג|knit/i.test(text)) return 'סריג';
  if (/שיפון|chiffon/i.test(text)) return 'שיפון';
  if (/קרפ|crepe/i.test(text)) return 'קרפ';
  if (/סאטן|satin/i.test(text)) return 'סאטן';
  if (/קטיפה|velvet/i.test(text)) return 'קטיפה';
  if (/תחרה|lace/i.test(text)) return 'תחרה';
  if (/טול|tulle/i.test(text)) return 'טול';
  if (/לייקרה|lycra/i.test(text)) return 'לייקרה';
  if (/ג׳רסי|jersey/i.test(text)) return "ג'רסי";
  if (/כותנה|cotton/i.test(text)) return 'כותנה';
  if (/פשתן|linen/i.test(text)) return 'פשתן';
  if (/משי|silk/i.test(text)) return 'משי';
  if (/צמר|wool/i.test(text)) return 'צמר';
  if (/פרווה|fur/i.test(text)) return 'פרווה';
  return '';
}

function detectDesignDetails(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  const details = [];
  if (/צווארון\s*וי|v.?neck/i.test(text)) details.push('צווארון V');
  if (/צווארון\s*עגול|round.?neck/i.test(text)) details.push('צווארון עגול');
  if (/גולף|turtle.?neck/i.test(text)) details.push('גולף');
  if (/סטרפלס|strapless/i.test(text)) details.push('סטרפלס');
  if (/כתפיי?ה|off.?shoulder/i.test(text)) details.push('חשוף כתפיים');
  if (/שרוול\s*ארוך|long.?sleeve/i.test(text)) details.push('שרוול ארוך');
  if (/שרוול\s*קצר|short.?sleeve/i.test(text)) details.push('שרוול קצר');
  if (/ללא\s*שרוול|sleeveless/i.test(text)) details.push('ללא שרוולים');
  if (/כפתור|button/i.test(text)) details.push('כפתורים');
  if (/רוכסן|zipper/i.test(text)) details.push('רוכסן');
  if (/חגורה|belt/i.test(text)) details.push('חגורה');
  if (/כיס|pocket/i.test(text)) details.push('כיסים');
  if (/שסע|slit/i.test(text)) details.push('שסע');
  if (/קשירה|tie|bow/i.test(text)) details.push('קשירה');
  if (/קומות|layer/i.test(text)) details.push('שכבות');
  return details;
}

// ======================================================================
// איסוף קישורים מעמוד הכל
// ======================================================================
async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-rare.co.il...\n');
  const allUrls = new Set();

  await page.goto('https://rare.co.il/all', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // גלילה — האתר טוען מוצרים בגלילה
  let lastCount = 0;
  let noChangeCycles = 0;
  for (let i = 0; i < 50; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch(e) {}
    await page.waitForTimeout(2000);

    const count = await page.evaluate(() =>
      document.querySelectorAll('a[href*="rare.co.il/Cat_"]').length
    );
    console.log(`  גלילה ${i+1}: ${count} מוצרים`);
    if (count === lastCount) {
      noChangeCycles++;
      if (noChangeCycles >= 4) break;
    } else {
      noChangeCycles = 0;
    }
    lastCount = count;
  }

  // איסוף כל הקישורים
  const urls = await page.evaluate(() => {
    const seen = new Set();
    // קישורי מוצר ישירים
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      if (href.includes('rare.co.il/Cat_') || href.match(/rare\.co\.il\/\d+/)) {
        seen.add(href.split('?')[0]);
      }
    });
    return [...seen];
  });

  urls.forEach(u => allUrls.add(u));
  console.log(`\n  ✓ סה"כ: ${allUrls.size} קישורים\n`);
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

      // === מידות ===
      const rawSizes = [];
      document.querySelectorAll('ul.clsUlChooseProduct li.clsLIChooseProduct').forEach(li => {
        const text = li.querySelector('span.cls_elm_extra_product_Li_Text')?.innerText?.trim() || '';
        const isDisabled = li.classList.contains('clsDisabled') || li.style.opacity === '0.3' ||
                           li.getAttribute('data-inventory') === '0' ||
                           li.classList.contains('outofstock');
        if (text) rawSizes.push({ name: text, disabled: isDisabled });
      });

      // fallback: select options
      if (rawSizes.length === 0) {
        document.querySelectorAll('select.clsSelectChooseProduct option').forEach(opt => {
          const val = opt.textContent?.trim();
          if (!val || val.includes('בחירת') || val === '---') return;
          rawSizes.push({ name: val, disabled: opt.disabled });
        });
      }

      return { title, price, originalPrice, images, description, rawSizes };
    });

    if (!data.title) { console.log('  ✗ no title'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ דלג: ${data.title.substring(0, 30)}`); return null; }

    // זיהוי מטא-דאטה
    const category = detectCategory(data.title);
    const style = detectStyle(data.title, data.description);
    const fit = detectFit(data.title, data.description);
    const pattern = detectPattern(data.title, data.description);
    const fabric = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);

    console.log(`    Raw sizes: ${data.rawSizes.map(s => s.name + (s.disabled ? ' ✗' : ' ✓')).join(', ') || 'none'}`);

    // עיבוד מידות
    const availableSizes = new Set();
    for (const size of data.rawSizes) {
      if (size.disabled) continue;
      normalizeSize(size.name).forEach(s => availableSizes.add(s));
    }

    const uniqueSizes = [...availableSizes];

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
      if (colorMap[lower]) { mainColor = colorMap[lower]; break; }
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
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, pattern, fabric, design_details, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title=EXCLUDED.title, price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url, images=EXCLUDED.images, sizes=EXCLUDED.sizes,
         color=EXCLUDED.color, colors=EXCLUDED.colors, style=EXCLUDED.style, fit=EXCLUDED.fit,
         category=EXCLUDED.category, description=EXCLUDED.description,
         color_sizes=EXCLUDED.color_sizes, pattern=EXCLUDED.pattern, fabric=EXCLUDED.fabric,
         design_details=EXCLUDED.design_details, last_seen=NOW()`,
      ['RARE', product.title, product.price || 0, product.originalPrice || null,
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
const MAX_PRODUCTS = 99999;

const browser = await chromium.launch({ headless: false, slowMo: 30 });
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
