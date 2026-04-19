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

console.log('🚀 MIMA Scraper - Wix Store');

// ======================================================================
// מיפוי צבעים - זהה למקימי
// ======================================================================
// טוען config מ-DB דרך scraper_utils
import { loadScraperConfig } from './scraper_utils.js';
const { normalizeColor, unknownColors, shouldSkip, detectCategory, detectStyle, detectFit, detectFabric, detectPattern, detectDesignDetails } = await loadScraperConfig(db);

async function dismissPopups(page) {
  try {
    // שיטה 1: הסרת overlay מסוג colorUnderlay (הפופאפ הספציפי של מימה)
    await page.evaluate(() => {
      // הסר את ה-overlay
      document.querySelectorAll('[data-testid="colorUnderlay"]').forEach(el => el.remove());
      // הסר lightbox containers
      document.querySelectorAll('[data-testid="lightbox-wrapper"], [data-testid="lightbox"]').forEach(el => el.remove());
      // הסר כל popup/overlay שחוסם
      document.querySelectorAll('.tcElKx, .i1tH8h').forEach(el => el.remove());
      // הסר popups גנריים של Wix
      document.querySelectorAll('[id*="lightbox"], [class*="lightbox"]').forEach(el => {
        if (el.style.position === 'fixed' || getComputedStyle(el).position === 'fixed') {
          el.remove();
        }
      });
    });
    
    // שיטה 2: נסה ללחוץ על כפתור סגירה אם קיים
    const closeButtons = [
      '[data-testid="lightbox-close-button"]',
      '[aria-label="close"]',
      '[aria-label="סגירה"]', 
      'button[data-hook="close-button"]',
      '.lightbox-close-button',
      '[data-testid="closeButton"]'
    ];
    for (const sel of closeButtons) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          await page.waitForTimeout(500);
          console.log(`    🚫 סגרתי popup (${sel})`);
          return;
        }
      } catch(e) {}
    }
    
    // שיטה 3: Escape key
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    
  } catch(e) {
    // לא קריטי
  }
}

// ======================================================================
// איסוף קישורי מוצרים מדף הבית של מימה (infinite scroll)
// ======================================================================
async function getAllProductUrls(page, maxProducts = 10) {
  console.log('\n📂 איסוף קישורים מ-mima-shop.co.il...\n');
  
  const allUrls = new Set();
  
  // נסה מספר דפים
  const startPages = [
    'https://www.mima-shop.co.il/',
    'https://www.mima-shop.co.il/shop'
  ];
  
  for (const startUrl of startPages) {
    try {
      console.log(`  → ${startUrl}`);
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      
      // סגירת popup ראשוני
      await dismissPopups(page);
      await page.waitForTimeout(1000);
      
      let lastCount = 0;
      let noChangeRounds = 0;
      
      // גלילה למטה לטעינת מוצרים (infinite scroll)
      for (let scroll = 0; scroll < 30; scroll++) {
        await dismissPopups(page);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        
        const urls = await page.evaluate(() => {
          const links = new Set();
          // כל הקישורים לדפי מוצר
          document.querySelectorAll('a[href*="/product-page/"]').forEach(a => {
            if (a.href) links.add(a.href.split('?')[0]);
          });
          // גם מ-Wix gallery/grid
          document.querySelectorAll('[data-hook="product-item-container"] a, [data-hook="product-item-root"] a, [data-hook="product-item-name"] a').forEach(a => {
            if (a.href && a.href.includes('/product-page/')) {
              links.add(a.href.split('?')[0]);
            }
          });
          // גם קישורים ישירים לתמונות מוצרים
          document.querySelectorAll('a[href*="mima-shop"]').forEach(a => {
            if (a.href.includes('/product-page/')) links.add(a.href.split('?')[0]);
          });
          return [...links];
        });
        
        urls.forEach(u => allUrls.add(u));
        console.log(`  גלילה ${scroll + 1}: ${allUrls.size} קישורים`);
        
        if (allUrls.size === lastCount) {
          noChangeRounds++;
          if (noChangeRounds >= 3) break;
        } else {
          noChangeRounds = 0;
        }
        lastCount = allUrls.size;
        
        if (allUrls.size >= maxProducts) break;
      }
    } catch(e) {
      console.log(`  ✗ error: ${e.message.substring(0, 40)}`);
    }
    
    if (allUrls.size >= maxProducts) break;
  }
  
  const result = [...allUrls].slice(0, maxProducts);
  console.log(`\n  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}

// ======================================================================
// סקרייפ מוצר בודד - WIX Store
// ======================================================================
async function scrapeProduct(page, url) {
  const shortUrl = url.split('/product-page/')[1]?.substring(0, 40) || url.substring(0, 50);
  console.log(`\n🔍 ${shortUrl}...`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    
    // סגירת popup שצץ בכניסה לדף מוצר
    await dismissPopups(page);
    await page.waitForTimeout(1000);
    
    // הזרקת CSS שמסתיר popups לצמיתות
    await page.addStyleTag({ content: `
      [data-testid="colorUnderlay"], 
      [data-testid="lightbox-wrapper"], 
      [data-testid="lightbox"],
      .tcElKx, .i1tH8h,
      [id*="lightbox"][style*="position: fixed"],
      [class*="lightbox"][style*="position: fixed"] { 
        display: none !important; 
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `});
    
    // חכה שהמוצר ייטען - עם retry
    let titleLoaded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.waitForSelector('[data-hook="product-title"], h1', { timeout: 8000 });
        titleLoaded = true;
        break;
      } catch(e) {
        console.log(`    ⏳ ניסיון ${attempt + 1} - ממתין לטעינה...`);
        await dismissPopups(page);
        await page.waitForTimeout(2000);
      }
    }
    if (!titleLoaded) {
      // נסה reload
      console.log('    🔄 טוען מחדש...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
      await dismissPopups(page);
    }
    
    const data = await page.evaluate(() => {
      // === כותרת ===
      const titleEl = document.querySelector('[data-hook="product-title"]') || document.querySelector('h1');
      let title = titleEl?.innerText?.trim() || '';
      
      // === מחירים ===
      let price = 0;
      let originalPrice = null;
      
      const primaryPriceEl = document.querySelector('[data-hook="formatted-primary-price"]');
      const secondaryPriceEl = document.querySelector('[data-hook="formatted-secondary-price"]');
      
      if (primaryPriceEl) {
        const priceText = primaryPriceEl.textContent.replace(/[^\d.]/g, '');
        if (priceText) price = parseFloat(priceText);
      }
      if (secondaryPriceEl) {
        const origText = secondaryPriceEl.textContent.replace(/[^\d.]/g, '');
        if (origText) originalPrice = parseFloat(origText);
      }
      
      // אם אין מחיר ראשי, נסה מחיר רגיל
      if (!price) {
        const anyPrice = document.querySelector('[data-hook="product-price"] span[data-wix-price]');
        if (anyPrice) {
          const t = anyPrice.getAttribute('data-wix-price')?.replace(/[^\d.]/g, '');
          if (t) price = parseFloat(t);
        }
      }
      
      // === תמונות - רק מגלריית המוצר! ===
      const imageUris = new Set();
      const images = [];
      
      // מציאת container הגלריה
      const gallery = document.querySelector('[data-hook="product-gallery-root"]');
      
      // חלץ תמונות מ-img src ישירות (הכי אמין — מכיל ~mv2.jpg)
      const allImgs = gallery
        ? [...gallery.querySelectorAll('img[src*="wixstatic"]')]
        : [...document.querySelectorAll('img[src*="wixstatic"]')];

      allImgs.forEach(img => {
        const src = img.getAttribute('src') || img.src || '';
        // חלץ media/FILENAME~mv2.EXT
        const m = src.match(/media\/([^/?#]+~mv2\.[a-z0-9]+)/i);
        if (m && !imageUris.has(m[1])) {
          imageUris.add(m[1]);
          images.push(`https://static.wixstatic.com/media/${m[1]}`);
        }
      });

      // fallback מ-data-src אם אין src
      if (images.length === 0) {
        document.querySelectorAll('[data-src*="wixstatic"]').forEach(el => {
          const src = el.getAttribute('data-src') || '';
          const m = src.match(/media\/([^/?#]+~mv2\.[a-z0-9]+)/i);
          if (m && !imageUris.has(m[1])) {
            imageUris.add(m[1]);
            images.push(`https://static.wixstatic.com/media/${m[1]}`);
          }
        });
      }
      
      // === תיאור - מהסקשן "תיאור השמלה" / "תיאור" בלבד ===
      let description = '';
      
      // שיטה 1: חפש סקשן לפי כותרת "תיאור" (ב-collapse items)
      // חשוב: הסקשנים סגורים (display:none) אז innerText ריק - משתמשים ב-textContent
      document.querySelectorAll('[data-hook="collapse-info-item"], li').forEach(section => {
        const titleEl = section.querySelector('[data-hook="info-section-title"]');
        const titleText = titleEl?.textContent?.trim() || '';
        if (titleText.includes('תיאור')) {
          const descEl = section.querySelector('[data-hook="info-section-description"]');
          if (descEl) {
            // textContent עובד גם על אלמנטים מוסתרים
            let text = descEl.textContent?.trim() || '';
            // ניקוי רווחים מיותרים
            text = text.replace(/\s+/g, ' ').trim();
            if (text && text.length > description.length) description = text;
          }
        }
      });
      
      // שיטה 2: אם לא נמצא, חפש description שאינו משלוח/מידות
      if (!description) {
        document.querySelectorAll('[data-hook="info-section-description"]').forEach(el => {
          const parent = el.closest('[data-hook="collapse-info-item"]') || el.closest('li');
          const parentTitle = parent?.querySelector('[data-hook="info-section-title"]')?.textContent || '';
          if (parentTitle.includes('משלוח') || parentTitle.includes('מידות') || 
              parentTitle.includes('החזר') || parentTitle.includes('טבלת')) return;
          let text = el.textContent?.trim() || '';
          text = text.replace(/\s+/g, ' ').trim();
          if (text.includes('משלוח חינם') || text.includes('ימי עסקים') || text.includes('עלות משלוח')) return;
          if (text && (!description || text.length > description.length)) description = text;
        });
      }
      
      // שיטה 3: fallback
      if (!description) {
        const descEl = document.querySelector('[data-hook="description"] p, .product-description p');
        if (descEl) description = descEl.textContent?.trim() || '';
      }
      
      // === צבעים (color picker) ===
      const rawColors = [];
      document.querySelectorAll('[data-hook="color-picker-item"]').forEach(el => {
        const label = el.getAttribute('aria-label') || el.querySelector('input')?.getAttribute('aria-label');
        if (label && label.trim()) rawColors.push(label.trim());
      });
      
      // === מידות - לא קוראים כאן, נקרא אחרי לחיצה על dropdown ===
      return { title, price, originalPrice, images, description, rawColors };
    });
    
    if (!data.title) { console.log('  ✗ no title'); return null; }
    
    const style = detectStyle(data.title, data.description);
    const fit = detectFit(data.title, data.description);
    const category = detectCategory(data.title);
    const pattern = detectPattern(data.title, data.description);
    const fabric = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);
    
    console.log(`    Raw colors: ${data.rawColors.join(', ') || 'none'}`);
    
    // === פונקציה לפתיחת dropdown ולקריאת מידות ===
    async function openDropdownAndReadSizes() {
      try {
        await dismissPopups(page);
        
        // בדוק אם יש שגיאת Widget
        const hasWidgetError = await page.evaluate(() => {
          return !!document.querySelector('.jZ7zzU, .YHlH9M');
        });
        
        if (hasWidgetError) {
          console.log(`      ⚠️ Widget Didn't Load - מנסה fallback...`);
          // נסה reload של הדף
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(4000);
          await dismissPopups(page);
          
          // בדוק שוב
          const stillError = await page.evaluate(() => !!document.querySelector('.jZ7zzU, .YHlH9M'));
          if (stillError) {
            console.log(`      ⚠️ Widget עדיין לא עובד - מנסה לקרוא מ-JSON...`);
            return await readSizesFromPageData();
          }
        }
        
        // לחיצה על dropdown לפתיחה
        const dropdownExists = await page.$('[data-hook="dropdown-base"]');
        if (!dropdownExists) {
          console.log(`      ⚠️ dropdown לא נמצא - מנסה fallback...`);
          return await readSizesFromPageData();
        }
        
        await page.click('[data-hook="dropdown-base"]');
        await page.waitForTimeout(1500);
        
        const sizes = await page.evaluate(() => {
          const result = {};
          document.querySelectorAll('[data-hook="dropdown-content-option"]').forEach(opt => {
            const title = opt.getAttribute('title');
            const disabled = opt.getAttribute('aria-disabled') === 'true';
            if (title && title.trim()) result[title.trim()] = !disabled;
          });
          return result;
        });
        
        // אם לא מצאנו מידות, נסה fallback
        if (Object.keys(sizes).length === 0) {
          console.log(`      ⚠️ dropdown ריק - מנסה fallback...`);
          await page.keyboard.press('Escape');
          return await readSizesFromPageData();
        }
        
        // סגירת dropdown
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        
        return sizes;
      } catch(e) {
        console.log(`      ⚠️ שגיאה בקריאת מידות: ${e.message.substring(0, 40)}`);
        // fallback
        return await readSizesFromPageData();
      }
    }
    
    // Fallback - קריאת מידות מתוך הדף (JSON, select, או טקסט)
    async function readSizesFromPageData() {
      try {
        const sizes = await page.evaluate(() => {
          const result = {};
          
          // שיטה 1: חפש ב-JSON של Wix product data
          const scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
          for (const script of scripts) {
            const text = script.textContent || '';
            // חיפוש מידות בפורמט Wix
            const sizeMatch = text.match(/"choices":\s*\[(.*?)\]/);
            if (sizeMatch) {
              try {
                const choices = JSON.parse(`[${sizeMatch[1]}]`);
                choices.forEach(c => {
                  if (c.description || c.value) {
                    const name = c.description || c.value;
                    const inStock = c.inStock !== false;
                    result[name] = inStock;
                  }
                });
                if (Object.keys(result).length > 0) return result;
              } catch(e) {}
            }
          }
          
          // שיטה 2: חפש select רגיל
          document.querySelectorAll('select').forEach(sel => {
            const name = (sel.name || sel.id || '').toLowerCase();
            if (name.includes('size') || name.includes('מידה') || name.includes('option')) {
              Array.from(sel.options).forEach(opt => {
                const val = opt.value?.trim() || opt.textContent?.trim();
                if (val && !val.includes('בחירת') && !val.includes('choose') && val !== '') {
                  result[val] = !opt.disabled;
                }
              });
            }
          });
          
          // שיטה 3: חפש טקסט של מידות בדף
          if (Object.keys(result).length === 0) {
            const sizeLabels = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'ONE SIZE'];
            const bodyText = document.body.innerText;
            sizeLabels.forEach(s => {
              if (bodyText.includes(s)) result[s] = true;
            });
          }
          
          return result;
        });
        
        if (Object.keys(sizes).length > 0) {
          console.log(`      📋 Fallback מצא מידות: ${Object.keys(sizes).join(', ')}`);
        }
        return sizes;
      } catch(e) {
        return {};
      }
    }
    
    // === עיבוד צבעים ומידות ===
    const colorSizesMap = {};
    const availableSizes = new Set();
    const availableColors = new Set();
    
    if (data.rawColors.length > 0) {
      // יש צבעים/וריאנטים - לכל אחד בודקים מידות
      for (const colorName of data.rawColors) {
        const normColor = normalizeColor(colorName);
        // אם normColor = null, זה יכול להיות שם דוגמא (כמו "פרחוני") - עדיין נבדוק מידות
        const variantLabel = normColor || colorName; // השתמש בשם המקורי כ-label
        
        if (!normColor) {
          console.log(`      ℹ️ וריאנט "${colorName}" - לא צבע מוכר, משתמש כשם וריאנט`);
        }
        
        // לחיצה על צבע ב-Wix
        try {
          await dismissPopups(page);
          // נסה ללחוץ על ה-input radio של הצבע
          const clicked = await page.evaluate((cn) => {
            const items = document.querySelectorAll('[data-hook="color-picker-item"]');
            for (const item of items) {
              const label = item.getAttribute('aria-label') || '';
              const input = item.querySelector('input');
              const inputLabel = input?.getAttribute('aria-label') || '';
              if (label === cn || inputLabel === cn) {
                input?.click();
                return true;
              }
            }
            return false;
          }, colorName);
          
          if (!clicked) {
            console.log(`      ⚠️ לא מצאתי צבע: ${colorName}`);
          }
          await page.waitForTimeout(1500);
        } catch(e) {
          console.log(`      ⚠️ לא הצלחתי ללחוץ על צבע: ${colorName}`);
        }
        
        // פתיחת dropdown וקריאת מידות
        const sizesForColor = await openDropdownAndReadSizes();
        console.log(`      מידות ל-${normColor}: ${JSON.stringify(sizesForColor)}`);
        
        if (!colorSizesMap[variantLabel]) colorSizesMap[variantLabel] = [];
        
        for (const [size, available] of Object.entries(sizesForColor)) {
          const normSizes = normalizeSize(size);
          if (available && normSizes.length > 0) {
            for (const ns of normSizes) {
              availableSizes.add(ns);
              if (normColor) availableColors.add(normColor);
              if (!colorSizesMap[variantLabel].includes(ns)) {
                colorSizesMap[variantLabel].push(ns);
              }
            }
            console.log(`      ✓ ${variantLabel} + ${normSizes.join('/')}`);
          } else if (normSizes.length > 0) {
            console.log(`      ✗ ${variantLabel} + ${normSizes.join('/')} (אזל)`);
          }
        }
      }
    } else {
      // אין צבעים - קרא מידות ישירות
      const sizes = await openDropdownAndReadSizes();
      console.log(`    Raw sizes from dropdown: ${JSON.stringify(sizes)}`);
      for (const [size, available] of Object.entries(sizes)) {
        if (available) {
          const normSizes = normalizeSize(size);
          normSizes.forEach(s => availableSizes.add(s));
        }
      }
    }
    
    const uniqueColors = [...availableColors];
    const uniqueSizes = [...availableSizes];
    const mainColor = uniqueColors[0] || null;
    
    console.log(`  ✓ ${data.title.substring(0, 35)}`);
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${mainColor || '-'} (${uniqueColors.join(',')}) | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    console.log(`    📊 colorSizes: ${JSON.stringify(colorSizesMap)}`);
    if (category) console.log(`    📁 ${category} | 🎨 ${style || '-'} | 📐 ${fit || '-'} | 🧵 ${fabric || '-'} | 🎭 ${pattern}`);
    
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
      url
    };
    
  } catch (err) {
    console.log(`  ✗ ${err.message.substring(0, 50)}`);
    return null;
  }
}

// ======================================================================
// שמירה ל-DB - זהה למקימי, חנות = MIMA
// ======================================================================

async function getImageSizeBytes(url, depth=0) {
  if (!url || depth > 5) return 0;
  try {
    const mod = url.startsWith('https') ? https : http;
    return new Promise(resolve => {
      const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, res => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          req.destroy();
          const loc = res.headers.location;
          const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
          return getImageSizeBytes(next, depth+1).then(resolve);
        }
        const len = res.headers['content-length'];
        if (len && parseInt(len) > 0) { req.destroy(); return resolve(parseInt(len)); }
        let size = 0;
        res.on('data', chunk => { size += chunk.length; if (size > 500000) { req.destroy(); resolve(size); } });
        res.on('end', () => resolve(size));
        res.on('error', () => resolve(0));
      });
      req.on('error', () => resolve(0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
    });
  } catch(e) { return 0; }
}
async function saveProduct(product) {
  if (!product) return;
  try {
    await db.query(
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, pattern, fabric, design_details, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title=EXCLUDED.title, price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url, images=EXCLUDED.images, sizes=EXCLUDED.sizes=EXCLUDED.image_size_bytes, 
         color=EXCLUDED.color, colors=EXCLUDED.colors, style=EXCLUDED.style, fit=EXCLUDED.fit,
         category=EXCLUDED.category, description=EXCLUDED.description, 
         color_sizes=EXCLUDED.color_sizes, pattern=EXCLUDED.pattern, fabric=EXCLUDED.fabric,
         design_details=EXCLUDED.design_details, last_seen=NOW()`,
      ['MIMA', product.title, product.price || 0, product.originalPrice || null,
       product.images[0] || '', product.images, product.sizes, product.mainColor,
       product.colors, product.style || null, product.fit || null, product.category,
       product.description || null, product.url, JSON.stringify(product.colorSizes),
       product.pattern || null, product.fabric || null, product.designDetails || []]
    );
    console.log('  💾 saved');
  } catch (err) {
    console.log(`  ✗ DB: ${err.message.substring(0, 40)}`);
  }
}

// ======================================================================
// הרצה
// ======================================================================
const MAX_PRODUCTS = 5; // בדיקה

const browser = await chromium.launch({ headless: false, slowMo: 50 });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 }
});
const page = await context.newPage();

try {
  const urls = await getAllProductUrls(page, MAX_PRODUCTS);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);
  
  let ok = 0, fail = 0;
  for (let i = 0; i < urls.length; i++) {
    console.log(`\n[${i + 1}/${urls.length}]`);
    const p = await scrapeProduct(page, urls[i]);
    if (p) { await saveProduct(p); ok++; } else fail++;
    await page.waitForTimeout(1000);
  }
  
  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  
  // בדיקת בריאות
  if (unknownColors.size > 0) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎨 צבעים לא מזוהים (${unknownColors.size}):`);
    console.log('='.repeat(50));
    [...unknownColors].forEach(c => console.log(`   ❓ "${c}" - הוסף ל-colorMap בסקרייפר`));
    console.log('='.repeat(50));
  }
  
} finally {
  await browser.close();
  await db.end();
}
