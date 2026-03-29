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

const colorMap = {
  'black': 'שחור', 'שחור': 'שחור',
  'white': 'לבן', 'לבן': 'לבן',
  'blue': 'כחול', 'כחול': 'כחול', 'navy': 'כחול', 'נייבי': 'כחול', 'royal': 'כחול', 'cobalt': 'כחול', 'denim': 'כחול', 'indigo': 'כחול',
  'red': 'אדום', 'אדום': 'אדום', 'scarlet': 'אדום', 'crimson': 'אדום',
  'green': 'ירוק', 'ירוק': 'ירוק', 'olive': 'ירוק', 'זית': 'ירוק', 'khaki': 'ירוק', 'חאקי': 'ירוק', 'snake': 'ירוק', 'emerald': 'ירוק', 'forest': 'ירוק', 'sage': 'ירוק', 'teal': 'ירוק', 'army': 'ירוק', 'hunter': 'ירוק', 'דשא': 'ירוק',
  'brown': 'חום', 'חום': 'חום', 'tan': 'חום', 'chocolate': 'חום', 'coffee': 'חום', 'קפה': 'חום', 'mocha': 'חום', 'espresso': 'חום', 'chestnut': 'חום',
  'camel': 'קאמל', 'קאמל': 'קאמל', 'cognac': 'קאמל',
  'beige': "בז'", 'בז': "בז'", 'nude': "בז'", 'ניוד': "בז'", 'sand': "בז'", 'taupe': "בז'",
  'gray': 'אפור', 'grey': 'אפור', 'אפור': 'אפור', 'charcoal': 'אפור', 'slate': 'אפור', 'ash': 'אפור',
  'pink': 'ורוד', 'ורוד': 'ורוד', 'coral': 'ורוד', 'קורל': 'ורוד', 'blush': 'ורוד', 'rose': 'ורוד', 'fuchsia': 'ורוד', 'magenta': 'ורוד', 'salmon': 'ורוד', 'בייבי': 'ורוד',
  'purple': 'סגול', 'סגול': 'סגול', 'lilac': 'סגול', 'לילך': 'סגול', 'lavender': 'סגול', 'violet': 'סגול', 'plum': 'סגול', 'mauve': 'סגול',
  'yellow': 'צהוב', 'צהוב': 'צהוב', 'mustard': 'צהוב', 'חרדל': 'צהוב', 'gold': 'צהוב', 'lemon': 'צהוב', 'בננה': 'צהוב', 'banana': 'צהוב',
  'orange': 'כתום', 'כתום': 'כתום', 'tangerine': 'כתום', 'rust': 'כתום',
  'זהב': 'זהב', 'golden': 'זהב',
  'silver': 'כסף', 'כסף': 'כסף', 'כסוף': 'כסף',
  'bordo': 'בורדו', 'בורדו': 'בורדו', 'burgundy': 'בורדו', 'wine': 'בורדו', 'maroon': 'בורדו', 'cherry': 'בורדו',
  'cream': 'שמנת', 'שמנת': 'שמנת', 'ivory': 'שמנת', 'offwhite': 'שמנת', 'off-white': 'שמנת', 'stone': 'שמנת', 'bone': 'שמנת', 'ecru': 'שמנת', 'vanilla': 'שמנת',
  'turquoise': 'תכלת', 'תכלת': 'תכלת', 'טורקיז': 'תכלת', 'aqua': 'תכלת', 'cyan': 'תכלת', 'sky': 'תכלת',
  'פרחוני': 'פרחוני', 'צבעוני': 'צבעוני', 'מולטי': 'צבעוני', 'multi': 'צבעוני', 'multicolor': 'צבעוני',
  'mint': 'מנטה', 'מנטה': 'מנטה', 'menta': 'מנטה',
  'אפרסק': 'אפרסק', 'peach': 'אפרסק', 'apricot': 'אפרסק',
  'מוקה': 'חום', 'moka': 'חום',
  'שזיף': 'סגול', 'ססגוני': 'צבעוני', 'ססגונית': 'צבעוני',
  'פודרה': 'ורוד', 'powder': 'ורוד',
  'אבן': 'אבן', 'בהיר': 'בהיר',
  "גי'נס": 'כחול', "ג'ינס": 'כחול', 'jeans': 'כחול',
};

const unknownColors = new Set();

function normalizeColor(c) {
  if (!c) return null;
  const lower = c.toLowerCase().trim();
  const noSpaces = lower.replace(/[-_\s]/g, '');
  if (colorMap[noSpaces]) return colorMap[noSpaces];
  if (colorMap[lower]) return colorMap[lower];
  const words = lower.split(/[\s\-]+/);
  for (const word of words) { if (colorMap[word]) return colorMap[word]; }
  for (const [key, val] of Object.entries(colorMap)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  unknownColors.add(c);
  return 'אחר';
}

const sizeMapping = {
  'Y': ['XS'], '0': ['S'], '1': ['M'], '2': ['L'], '3': ['XL'], '4': ['XXL'], '5': ['XXXL'],
  '34': ['XS'], '36': ['XS', 'S'], '38': ['S', 'M'], '40': ['M', 'L'],
  '42': ['L', 'XL'], '44': ['XL', 'XXL'], '46': ['XXL', 'XXXL'], '48': ['XXXL'], '50': ['XXXL']
};

function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  if (/^(XS|S|M|L|XL|2?XXL|XXXL)$/i.test(val)) return [val.replace('2XL','XXL')];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (sizeMapping[val]) return sizeMapping[val];
  return [];
}

const SKIP_KEYWORDS = ['עגיל','עגילי','שרשרת','צמיד','טבעת','תכשיט','כובע','צעיף','תיק','ארנק','משקפיים','גומייה','מטפחת','קשת','שעון','שיער','גרבי'];

function shouldSkip(title) {
  if (!title) return false;
  const t = title.toLowerCase().trim();
  return SKIP_KEYWORDS.some(k => {
    const kl = k.toLowerCase();
    if (kl.includes(' ')) return t.includes(kl);
    const idx = t.indexOf(kl);
    if (idx === -1) return false;
    const before = idx === 0 || /[\s,\-–\/״"()]/.test(t[idx - 1]);
    const after = idx + kl.length === t.length || /[\s,\-–\/״"().!?]/.test(t[idx + kl.length]);
    return before && after;
  });
}

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (/קרדיגן|cardigan/i.test(t)) return 'קרדיגן';
  if (/סוודר|sweater/i.test(t)) return 'סוודר';
  if (/שמלה|שמלת|dress/i.test(t)) return 'שמלה';
  if (/חצאית|skirt/i.test(t)) return 'חצאית';
  if (/חולצה|חולצת|טופ|top|shirt|blouse/i.test(t)) return 'חולצה';
  if (/בלייזר|blazer/i.test(t)) return 'בלייזר';
  if (/מעיל|coat|ז׳קט|ג׳קט|jacket/i.test(t)) return 'מעיל';
  if (/וסט|vest/i.test(t)) return 'וסט';
  if (/אוברול|jumpsuit/i.test(t)) return 'אוברול';
  if (/סט|set/i.test(t)) return 'סט';
  return null;
}

function detectStyle(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/שבת|ערב|אירוע|חגיג|אלגנט|elegant/i.test(text)) return 'ערב';
  if (/יום.?חול|casual|יומיומי/i.test(text)) return 'יום חול';
  return '';
}

function detectFit(title, description = '') {
  const text = (title || '').toLowerCase();
  if (/מקסי|maxi/i.test(text)) return 'ארוכה';
  if (/מידי|midi/i.test(text)) return 'מידי';
  if (/קצר|מיני|mini/i.test(text)) return 'קצרה';
  if (/אוברסייז|oversize/i.test(text)) return 'אוברסייז';
  if (/צמוד|fitted|bodycon/i.test(text)) return 'צמודה';
  if (/ישרה|straight/i.test(text)) return 'ישרה';
  if (/מתרחב|flare/i.test(text)) return 'מתרחבת';
  return '';
}

function detectPattern(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/פסים|striped/i.test(text)) return 'פסים';
  if (/פרחוני|floral/i.test(text)) return 'פרחוני';
  if (/משבצות|plaid/i.test(text)) return 'משבצות';
  if (/נקודות|dots/i.test(text)) return 'נקודות';
  if (/חלקה?\b|plain|solid/i.test(text)) return 'חלק';
  return '';
}

function detectFabric(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/סריג|knit/i.test(text)) return 'סריג';
  if (/פליז|fleece/i.test(text)) return 'פליז';
  if (/שיפון|chiffon/i.test(text)) return 'שיפון';
  if (/קרפ|crepe/i.test(text)) return 'קרפ';
  if (/סאטן|satin/i.test(text)) return 'סאטן';
  if (/כותנה|cotton/i.test(text)) return 'כותנה';
  if (/פשתן|linen/i.test(text)) return 'פשתן';
  return '';
}

function detectDesignDetails(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  const details = [];
  if (/צווארון\s*וי|v.?neck/i.test(text)) details.push('צווארון V');
  if (/גולף|turtle.?neck/i.test(text)) details.push('גולף');
  if (/כיס|pocket/i.test(text)) details.push('כיסים');
  if (/שרוול\s*ארוך|long.?sleeve/i.test(text)) details.push('שרוול ארוך');
  if (/שרוול\s*קצר|short.?sleeve/i.test(text)) details.push('שרוול קצר');
  if (/ללא\s*שרוול|sleeveless/i.test(text)) details.push('ללא שרוולים');
  if (/כפתור|button/i.test(text)) details.push('כפתורים');
  return details;
}

async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-avivit-weizman.co.il...\n');
  const allUrls = new Set();
  const categories = [
    { base: 'https://avivit-weizman.co.il/product-category/%d7%a7%d7%95%d7%9c%d7%a7%d7%a6%d7%99%d7%99%d7%aa-%d7%90%d7%91%d7%99%d7%91-26/', label: 'קולקציית אביב 26', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/sale/', label: 'sale', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/basic/', label: 'basic', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/%d7%a9%d7%9e%d7%9c%d7%95%d7%aa-%d7%9c%d7%97%d7%92/', label: 'שמלות לחג', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/%d7%a1%d7%98%d7%99%d7%9d/', label: 'סטים', maxPages: 50 },
    { base: 'https://avivit-weizman.co.il/product-category/%d7%a7%d7%95%d7%9c%d7%a7%d7%a6%d7%99%d7%99%d7%aa-%d7%90%d7%99%d7%a8%d7%95%d7%a2%d7%99%d7%9d/', label: 'קולקציית אירועים', maxPages: 50 },
  ];

  for (const cat of categories) {
    console.log(`  📁 [${cat.label}]`);
    for (let p = 1; p <= cat.maxPages; p++) {
      const url = p === 1 ? cat.base : `${cat.base}page/${p}/`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);
        let lastCount = 0;
        for (let scroll = 0; scroll < 8; scroll++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1500);
          const count = await page.evaluate(() => document.querySelectorAll('a[href*="/product/"]').length);
          if (count === lastCount) break;
          lastCount = count;
        }
        const urls = await page.evaluate(() =>
          [...document.querySelectorAll('a[href*="/product/"]')]
            .map(a => a.href.split('?')[0])
            .filter(h => h.includes('avivit-weizman.co.il/product/'))
            .filter((v, i, a) => a.indexOf(v) === i)
        );
        if (urls.length === 0) { console.log(`    ⏹ עמוד ריק`); break; }
        const before = allUrls.size;
        urls.forEach(u => allUrls.add(u));
        console.log(`    ✓ page ${p}: ${urls.length} (סה"כ: ${allUrls.size})`);
        if (allUrls.size === before && p > 1) break;
      } catch (e) {
        console.log(`    ⏹ שגיאה (${e.message.substring(0, 30)})`);
        break;
      }
    }
  }
  return [...allUrls];
}

async function scrapeProduct(page, url) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 40) || url.substring(0, 50);
  console.log(`\n🔍 ${shortUrl}...`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);

    const data = await page.evaluate(() => {
      let title = document.querySelector('.elementor-widget-heading h1, .elementor-widget-heading h2, h1.product_title, h1')?.innerText?.trim() || '';
      title = title.replace(/\s*W?\d{6,}\s*/gi, '').trim();

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

      const images = [];
      document.querySelectorAll('.jet-woo-product-gallery__image img').forEach(img => {
        const src = img.getAttribute('data-large_image') || img.getAttribute('data-src') || img.src || '';
        if (src && src.includes('uploads') && !images.includes(src)) images.push(src);
      });
      document.querySelectorAll('.jet-woo-swiper-control-thumbs__item img').forEach(img => {
        const src = img.getAttribute('data-large_image') || img.getAttribute('data-src') || '';
        if (src && src.includes('uploads') && !images.includes(src)) images.push(src);
      });
      if (images.length === 0) {
        document.querySelectorAll('.woocommerce-product-gallery__image a').forEach(a => {
          if (a.href && a.href.includes('uploads') && !images.includes(a.href)) images.push(a.href);
        });
      }

      let description = document.querySelector('.woocommerce-product-details__short-description')?.innerText?.trim() || '';

      const rawColors = [], rawSizes = [];
      document.querySelectorAll('.variable-items-wrapper li').forEach(el => {
        const attrName = (el.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || '').toLowerCase();
        const title = el.getAttribute('data-title') || el.getAttribute('title') || '';
        const isDisabled = el.classList.contains('disabled');
        if (!title) return;
        if (attrName.includes('color') || attrName.includes('צבע') || attrName.includes('pa_color')) rawColors.push({ name: title, disabled: isDisabled });
        else if (attrName.includes('size') || attrName.includes('מידה') || attrName.includes('pa_size')) rawSizes.push({ name: title, disabled: isDisabled });
      });

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
    if (shouldSkip(data.title)) { console.log(`  ⏭️ מדלג: ${data.title.substring(0,30)}`); return null; }

    const colorSizesMap = {};
    const colorImagesMap = {}; // *** חדש: color → image URL ***
    const availableSizes = new Set();
    const availableColors = new Set();

    if (data.variationsData && data.variationsData.length > 0) {
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
            const rcL = rc.name.toLowerCase(), dcL = displayColor.toLowerCase();
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
        }

        // *** שמור תמונה ראשונה לכל צבע ***
        if (normColor && v.image?.src && v.image.src.includes('uploads') && !colorImagesMap[normColor]) {
          colorImagesMap[normColor] = v.image.src;
        }
      }
    } else {
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

    if (uniqueSizes.length === 0) { console.log(`  ⏭️ אין מידות`); return null; }

    const hasColorImages = Object.keys(colorImagesMap).length > 0;
    console.log(`  ✓ ${data.title.substring(0, 40)}`);
    console.log(`    💰 ₪${data.price} | 🎨 ${uniqueColors.join(',')} | 📏 ${uniqueSizes.join(',')} | 🖼️ ${data.images.length} | 🎨→🖼️ ${hasColorImages ? Object.keys(colorImagesMap).length : 0}`);

    return {
      title: data.title, price: data.price, originalPrice: data.originalPrice,
      images: data.images, colors: uniqueColors, sizes: uniqueSizes,
      mainColor: uniqueColors[0] || null,
      category: detectCategory(data.title), style: detectStyle(data.title, data.description),
      fit: detectFit(data.title, data.description), pattern: detectPattern(data.title, data.description),
      fabric: detectFabric(data.title, data.description), designDetails: detectDesignDetails(data.title, data.description),
      description: data.description, colorSizes: colorSizesMap,
      colorImages: colorImagesMap, // *** חדש ***
      url
    };

  } catch (err) {
    console.log(`  ✗ ${err.message.substring(0, 40)}`);
    return null;
  }
}

async function saveProduct(product) {
  if (!product) return;
  try {
    await db.query(
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, color_images, pattern, fabric, design_details, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title=EXCLUDED.title, price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url, images=EXCLUDED.images, sizes=EXCLUDED.sizes,
         color=EXCLUDED.color, colors=EXCLUDED.colors, style=EXCLUDED.style, fit=EXCLUDED.fit,
         category=EXCLUDED.category, description=EXCLUDED.description,
         color_sizes=EXCLUDED.color_sizes, color_images=EXCLUDED.color_images,
         pattern=EXCLUDED.pattern, fabric=EXCLUDED.fabric,
         design_details=EXCLUDED.design_details, last_seen=NOW()`,
      ['AVIVIT', product.title, product.price || 0, product.originalPrice || null,
       product.images[0] || '', product.images, product.sizes, product.mainColor,
       product.colors, product.style || null, product.fit || null, product.category,
       product.description || null, product.url,
       JSON.stringify(product.colorSizes),
       JSON.stringify(product.colorImages || {}), // *** חדש ***
       product.pattern || null, product.fabric || null,
       product.designDetails?.length ? product.designDetails : null]
    );
    console.log('  💾 saved');
  } catch (err) {
    console.log(`  ✗ DB: ${err.message.substring(0, 50)}`);
  }
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 }, locale: 'he-IL',
});
const page = await context.newPage();

try {
  await page.goto('https://avivit-weizman.co.il/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const urls = await getAllProductUrls(page);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);

  let ok = 0, fail = 0;
  for (let i = 0; i < urls.length; i++) {
    console.log(`\n[${i + 1}/${urls.length}]`);
    const p = await scrapeProduct(page, urls[i]);
    if (p) { await saveProduct(p); ok++; } else fail++;
    await page.waitForTimeout(400);
  }
  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
} finally {
  await browser.close();
  await db.end();
}
