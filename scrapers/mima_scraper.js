import { chromium } from 'playwright';
import { normalizeColor, reportUnknownColors, unknownColors } from './color_utils.js';
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
// מיפוי מידות - זהה למקימי
// ======================================================================
const sizeMapping = {
  'Y': ['XS'], '0': ['S'], '1': ['M'], '2': ['L'], '3': ['XL'], '4': ['XXL'], '5': ['XXXL'],
  '34': ['XS'], '36': ['XS', 'S'], '38': ['S', 'M'], '40': ['M', 'L'],
  '42': ['L', 'XL'], '44': ['XL', 'XXL'], '46': ['XXL', 'XXXL'], '48': ['XXXL'], '50': ['XXXL']
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
// UNIFIED DETECT FUNCTIONS - v2
// ======================================================================

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  // סדר חשוב - ספציפי קודם
  if (/קרדיגן|cardigan/i.test(t)) return 'קרדיגן';
  if (/סוודר|sweater/i.test(t)) return 'סוודר';
  if (/טוניקה|tunic/i.test(t)) return 'טוניקה';
  if (/סרפן|pinafore/i.test(t)) return 'סרפן';
  if (/שמלה|שמלת|dress/i.test(t)) return 'שמלה';
  if (/חצאית|skirt/i.test(t)) return 'חצאית';
  if (/חולצה|חולצת|טופ|top|shirt|blouse/i.test(t)) return 'חולצה';
  if (/בלייזר|blazer/i.test(t)) return 'בלייזר';
  if (/ז׳קט|ג׳קט|ג'קט|jacket/i.test(t)) return 'מעיל';
  if (/וסט|vest/i.test(t)) return 'וסט';
  if (/עליונית/i.test(t)) return 'עליונית';
  if (/מעיל|coat/i.test(t)) return 'מעיל';
  if (/שכמיה|cape|poncho|פונצ׳ו/i.test(t)) return 'עליונית';
  if (/חלוק|robe|אירוח/i.test(t)) return 'חלוק';
  if (/אוברול|jumpsuit|overall/i.test(t)) return 'אוברול';
  if (/סט|set/i.test(t)) return 'סט';
  if (/בייסיק|basic/i.test(t)) return 'בייסיק';
  if (/גולף|turtleneck/i.test(t)) return 'חולצה';
  // סריג = בד, לא קטגוריה. מוצר "סריג" יהיה חולצה/סוודר/קרדיגן
  // מכנסיים - לא מציגים
  return null;
}

function detectStyle(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/שבת|ערב|אירוע|מיוחד|מסיבה|party|evening|formal|גאלה|נשף|חגיג|celebration|festive|אלגנט|elegant|מהודר|יוקרת/i.test(text)) return 'ערב';
  if (/יום.?חול|casual|קז׳ואל|קזואל|יומיומי|daily|everyday|יום.?יום/i.test(text)) return 'יום חול';
  if (/קלאסי|classic|נצחי|timeless/i.test(text)) return 'קלאסי';
  if (/מינימליסט|minimal|נקי|clean/i.test(text)) return 'מינימליסטי';
  if (/אוברסייז|oversize|oversized/i.test(text)) return 'אוברסייז';
  if (/רטרו|retro|וינטג׳|וינטג'|vintage/i.test(text)) return 'רטרו';
  if (/מודרני|modern|עכשווי|contemporary/i.test(text)) return 'מודרני';
  if (/בייסיק|basic|בסיסי/i.test(text)) return 'יום חול';
  return '';
}

function detectFit(title, description = '') {
  const text = (title || '').toLowerCase();
  const fullText = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/ישרה|straight/i.test(text)) return 'ישרה';
  if (/a.?line|איי.?ליין/i.test(text)) return 'A';
  if (/מתרחב|flare|התרחבות/i.test(text)) return 'מתרחבת';
  if (/רפוי|רחב|loose|relaxed|wide/i.test(text)) return 'רפויה';
  if (/אוברסייז|oversize|oversized/i.test(text)) return 'אוברסייז';
  if (/מחויט|tailored|מותאמ/i.test(text)) return 'מחויטת';
  if (/מעטפ|wrap/i.test(text)) return 'מעטפת';
  if (/עפרון|pencil/i.test(text)) return 'עפרון';
  if (/צמוד|tight|fitted|bodycon|צר|narrow/i.test(text)) return 'צמודה';
  if (/מקסי|maxi|ארוכ/i.test(text)) return 'ארוכה';
  if (/מידי|midi|אמצע/i.test(text)) return 'מידי';
  if (/קצר|מיני|mini|short/i.test(text)) return 'קצרה';
  if (/במותן|מותן גבוה|מותן נמוך|high.?waist|waisted/i.test(fullText)) return 'מותן';
  if (/הריון|pregnancy|maternity/i.test(fullText)) return 'הריון';
  if (/הנקה|nursing|breastfeed/i.test(fullText)) return 'הנקה';
  return '';
}

function detectPattern(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/פסים|פס |striped?/i.test(text)) return 'פסים';
  if (/פרחוני|פרחים|floral|flower/i.test(text)) return 'פרחוני';
  if (/משבצות|plaid|check/i.test(text)) return 'משבצות';
  if (/נקודות|dots|polka/i.test(text)) return 'נקודות';
  if (/גיאומטרי|geometric/i.test(text)) return 'גיאומטרי';
  if (/אבסטרקט|abstract/i.test(text)) return 'אבסטרקטי';
  if (/הדפס|print/i.test(text)) return 'הדפס';
  if (/חלקה?\b|plain|solid/i.test(text)) return 'חלק';
  return '';
}

function detectFabric(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/סריג|knit|knitted/i.test(text)) return 'סריג';
  if (/אריג|woven/i.test(text)) return 'אריג';
  if (/ג׳רסי|ג'רסי|גרסי|jersey/i.test(text)) return 'ג׳רסי';
  if (/פיקה|pique/i.test(text)) return 'פיקה';
  if (/שיפון|chiffon/i.test(text)) return 'שיפון';
  if (/קרפ|crepe/i.test(text)) return 'קרפ';
  if (/סאטן|satin/i.test(text)) return 'סאטן';
  if (/קטיפה|velvet/i.test(text)) return 'קטיפה';
  if (/פליז|fleece/i.test(text)) return 'פליז';
  if (/תחרה|lace/i.test(text)) return 'תחרה';
  if (/טול|tulle/i.test(text)) return 'טול';
  if (/לייקרה|lycra|spandex/i.test(text)) return 'לייקרה';
  if (/טריקו|tricot/i.test(text)) return 'טריקו';
  if (/רשת|mesh|net/i.test(text)) return 'רשת';
  if (/ג׳ינס|ג'ינס|jeans|דנים|denim/i.test(text)) return 'ג׳ינס';
  if (/קורדרוי|corduroy/i.test(text)) return 'קורדרוי';
  if (/כותנה|cotton/i.test(text)) return 'כותנה';
  if (/פשתן|linen/i.test(text)) return 'פשתן';
  if (/משי|silk/i.test(text)) return 'משי';
  if (/צמר|wool/i.test(text)) return 'צמר';
  if (/ריקמה|רקומה|רקום|רקמה|embroidery|embroidered/i.test(text)) return 'ריקמה';
  if (/פרווה|fur|faux.?fur/i.test(text)) return 'פרווה';
  return '';
}

function detectDesignDetails(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  const details = [];
  // צווארון
  if (/צווארון\s*וי|v.?neck/i.test(text)) details.push('צווארון V');
  if (/צווארון\s*עגול|round.?neck|crew.?neck/i.test(text)) details.push('צווארון עגול');
  if (/גולף|turtle.?neck|mock.?neck/i.test(text)) details.push('גולף');
  if (/סטרפלס|strapless|חשוף.?כתפ/i.test(text)) details.push('סטרפלס');
  if (/כתפיי?ה|off.?shoulder|חשוף/i.test(text) && !/חשוף.?כתפ/.test(text)) details.push('חשוף כתפיים');
  if (/קולר|choker|halter/i.test(text)) details.push('קולר');
  if (/סירה|boat.?neck|bateau/i.test(text)) details.push('צווארון סירה');
  // שרוולים
  if (/שרוול\s*ארוך|long.?sleeve/i.test(text)) details.push('שרוול ארוך');
  if (/שרוול\s*קצר|short.?sleeve/i.test(text)) details.push('שרוול קצר');
  if (/3\/4|שרוול\s*3|three.?quarter/i.test(text)) details.push('שרוול 3/4');
  if (/ללא\s*שרוול|sleeveless|גופיי?ה/i.test(text)) details.push('ללא שרוולים');
  if (/שרוול\s*פעמון|bell.?sleeve/i.test(text)) details.push('שרוול פעמון');
  if (/שרוול\s*נפוח|puff.?sleeve|שרוול\s*בלון/i.test(text)) details.push('שרוול נפוח');
  // כפתורים ורוכסנים
  if (/כפתור|מכופתר|button/i.test(text)) details.push('כפתורים');
  if (/רוכסן|zipper|zip/i.test(text)) details.push('רוכסן');
  // חגורה וקשירה
  if (/חגורה|belt/i.test(text)) details.push('חגורה');
  if (/קשירה|tie|bow/i.test(text)) details.push('קשירה');
  // כיסים
  if (/כיס|pocket/i.test(text)) details.push('כיסים');
  // שסע
  if (/שסע|slit/i.test(text)) details.push('שסע');
  // פפלום
  if (/פפלום|peplum/i.test(text)) details.push('פפלום');
  // שכבות
  if (/שכבות|layer/i.test(text)) details.push('שכבות');
  return details;
}

// ======================================================================
// סגירת popups/lightboxes של Wix - חשוב! האתר מציג popup שחוסם אינטראקציה
// ======================================================================
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
      
      if (gallery) {
        // שיטה 1: מ-wow-image בתוך הגלריה בלבד
        gallery.querySelectorAll('wow-image').forEach(el => {
          try {
            const info = JSON.parse(el.getAttribute('data-image-info') || '{}');
            const uri = info?.imageData?.uri;
            if (uri && !imageUris.has(uri)) {
              imageUris.add(uri);
              images.push(`https://static.wixstatic.com/media/${uri}/v1/fill/w_800,h_1200,al_c,q_85/${uri}`);
            }
          } catch(e) {}
        });
        
        // שיטה 2: מ-img tags בתוך הגלריה
        if (images.length === 0) {
          gallery.querySelectorAll('img[src*="wixstatic"]').forEach(img => {
            const src = img.src || '';
            const uriMatch = src.match(/media\/([^/]+~mv2\.\w+)/);
            if (uriMatch && !imageUris.has(uriMatch[1])) {
              imageUris.add(uriMatch[1]);
              images.push(`https://static.wixstatic.com/media/${uriMatch[1]}/v1/fill/w_800,h_1200,al_c,q_85/${uriMatch[1]}`);
            }
          });
        }
        
        // שיטה 3: מ-href של media wrappers בתוך הגלריה
        if (images.length === 0) {
          gallery.querySelectorAll('.media-wrapper-hook[href*="wixstatic"]').forEach(el => {
            const href = el.getAttribute('href');
            const uriMatch = href?.match(/media\/([^/]+~mv2\.\w+)/);
            if (uriMatch && !imageUris.has(uriMatch[1])) {
              imageUris.add(uriMatch[1]);
              images.push(`https://static.wixstatic.com/media/${uriMatch[1]}/v1/fill/w_800,h_1200,al_c,q_85/${uriMatch[1]}`);
            }
          });
        }
      }
      
      // fallback: אם הגלריה לא נמצאה, נסה main-media בלבד
      if (images.length === 0) {
        document.querySelectorAll('[data-hook="main-media-image-wrapper"] wow-image').forEach(el => {
          try {
            const info = JSON.parse(el.getAttribute('data-image-info') || '{}');
            const uri = info?.imageData?.uri;
            if (uri && !imageUris.has(uri)) {
              imageUris.add(uri);
              images.push(`https://static.wixstatic.com/media/${uri}/v1/fill/w_800,h_1200,al_c,q_85/${uri}`);
            }
          } catch(e) {}
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
const MAX_PRODUCTS = 30; // מוגבל ל-10 מוצרים

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
    [...unknownColors].forEach(c => console.log(`   ❓ "${c}" - הוסף ל-color_utils.js`));
    console.log('='.repeat(50));
  }
  
} finally {
  await browser.close();
  await db.end();
}
