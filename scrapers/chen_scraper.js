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
// מיפוי צבעים
// ======================================================================
const colorMap = {
  'black': 'שחור', 'שחור': 'שחור',
  'white': 'לבן', 'לבן': 'לבן',
  'blue': 'כחול', 'כחול': 'כחול', 'navy': 'כחול', 'נייבי': 'כחול', 'royal': 'כחול', 'cobalt': 'כחול', 'denim': 'כחול', 'indigo': 'כחול',
  'red': 'אדום', 'אדום': 'אדום', 'scarlet': 'אדום', 'crimson': 'אדום',
  'green': 'ירוק', 'ירוק': 'ירוק', 'olive': 'ירוק', 'זית': 'ירוק', 'khaki': 'ירוק', 'חאקי': 'ירוק', 'snake': 'ירוק', 'emerald': 'ירוק', 'forest': 'ירוק', 'sage': 'ירוק', 'teal': 'ירוק', 'army': 'ירוק', 'hunter': 'ירוק', 'דשא': 'ירוק',
  'brown': 'חום', 'חום': 'חום', 'tan': 'חום', 'chocolate': 'חום', 'coffee': 'חום', 'קפה': 'חום', 'mocha': 'חום', 'espresso': 'חום', 'chestnut': 'חום',
  'camel': 'קאמל', 'קאמל': 'קאמל', 'cognac': 'קאמל',
  'beige': 'בז׳', 'בז': 'בז׳', 'nude': 'בז׳', 'ניוד': 'בז׳', 'sand': 'בז׳', 'taupe': 'בז׳',
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
  'שזיף': 'סגול',
  'ססגוני': 'צבעוני', 'ססגונית': 'צבעוני',
  'פודרה': 'ורוד', 'powder': 'ורוד',
  'אבן': 'אבן',
  'בהיר': 'בהיר',
  "גי'נס": 'כחול', 'ג׳ינס': 'כחול', 'jeans': 'כחול',
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
  // letter sizes
  if (/^(XS|S|M|L|XL|2?XXL|XXXL)$/i.test(val)) return [val.replace('2XL', 'XXL')];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (sizeMapping[val]) return sizeMapping[val];
  return [];
}

// ======================================================================
// פונקציות זיהוי מטא-דאטה
// ======================================================================

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
  if (/צווארון\s*וי|v.?neck/i.test(text)) details.push('צווארון V');
  if (/צווארון\s*עגול|round.?neck|crew.?neck/i.test(text)) details.push('צווארון עגול');
  if (/גולף|turtle.?neck|mock.?neck/i.test(text)) details.push('גולף');
  if (/סטרפלס|strapless|חשוף.?כתפ/i.test(text)) details.push('סטרפלס');
  if (/כתפיי?ה|off.?shoulder|חשוף/i.test(text) && !/חשוף.?כתפ/.test(text)) details.push('חשוף כתפיים');
  if (/קולר|choker|halter/i.test(text)) details.push('קולר');
  if (/סירה|boat.?neck|bateau/i.test(text)) details.push('צווארון סירה');
  if (/שרוול\s*ארוך|long.?sleeve/i.test(text)) details.push('שרוול ארוך');
  if (/שרוול\s*קצר|short.?sleeve/i.test(text)) details.push('שרוול קצר');
  if (/3\/4|שרוול\s*3|three.?quarter/i.test(text)) details.push('שרוול 3/4');
  if (/ללא\s*שרוול|sleeveless|גופיי?ה/i.test(text)) details.push('ללא שרוולים');
  if (/שרוול\s*פעמון|bell.?sleeve/i.test(text)) details.push('שרוול פעמון');
  if (/שרוול\s*נפוח|puff.?sleeve|שרוול\s*בלון/i.test(text)) details.push('שרוול נפוח');
  if (/כפתור|מכופתר|button/i.test(text)) details.push('כפתורים');
  if (/רוכסן|zipper|zip/i.test(text)) details.push('רוכסן');
  if (/חגורה|belt/i.test(text)) details.push('חגורה');
  if (/קשירה|tie|bow/i.test(text)) details.push('קשירה');
  if (/כיס|pocket/i.test(text)) details.push('כיסים');
  if (/שסע|slit/i.test(text)) details.push('שסע');
  if (/פפלום|peplum/i.test(text)) details.push('פפלום');
  if (/שכבות|layer/i.test(text)) details.push('שכבות');
  return details;
}

// ======================================================================
// איסוף קישורים מכל הקטגוריות
// ======================================================================
async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים מ-chen-fashion.com...\n');
  const allUrls = new Set();

  const categories = [
    { base: 'https://www.chen-fashion.com/product-category/%d7%a9%d7%9e%d7%9c%d7%95%d7%aa/',        label: 'שמלות',           maxPages: 50 },
    { base: 'https://www.chen-fashion.com/product-category/new-collection-2/',                       label: 'new-collection-2', maxPages: 50 },
    { base: 'https://www.chen-fashion.com/product-category/new-collection/',                         label: 'new-collection',   maxPages: 50 },
    { base: 'https://www.chen-fashion.com/product-category/sale-%d7%a7%d7%99%d7%a5/',               label: 'sale-קיץ',         maxPages: 50 },
    { base: 'https://www.chen-fashion.com/product-category/%d7%97%d7%a6%d7%90%d7%99%d7%95%d7%aa/', label: 'חצאיות',           maxPages: 50 },
    { base: 'https://www.chen-fashion.com/product-category/%d7%97%d7%95%d7%9c%d7%a6%d7%95%d7%aa/', label: 'חולצות',           maxPages: 50 },
  ];

  for (const cat of categories) {
    console.log(`  📁 [${cat.label}]`);

    for (let p = 1; p <= cat.maxPages; p++) {
      const url = p === 1 ? cat.base : `${cat.base}page/${p}/`;
      try {
        console.log(`  → page ${p}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        // גלילה למטה לטעינת כל המוצרים
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1000);
        }

        const urls = await page.evaluate(() =>
          [...document.querySelectorAll('a[href*="/product/"]')]
            .map(a => a.href.split('?')[0])
            .filter(h => h.includes('chen-fashion.com/product/'))
            .filter((v, i, a) => a.indexOf(v) === i)
        );

        if (urls.length === 0) {
          console.log(`    ⏹ עמוד ריק - עוצר`);
          break;
        }

        const before = allUrls.size;
        urls.forEach(u => allUrls.add(u));
        console.log(`    ✓ ${urls.length} (סה"כ: ${allUrls.size})`);

        // אם לא נוספו קישורים חדשים - סוף הקטגוריה
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

    // זיהוי מטא-דאטה
    const style    = detectStyle(data.title, data.description);
    const fit      = detectFit(data.title, data.description);
    const category = detectCategory(data.title);
    const pattern  = detectPattern(data.title, data.description);
    const fabric   = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);

    // === צבע מהכותרת (כמו AVIYAH — כל עמוד = צבע אחד) ===
    let titleColor = null;
    const titleWords = data.title.split(/[\s\-–,/]+/);
    for (const word of titleWords) {
      if (word.length < 2) continue;
      const lower = word.toLowerCase().trim();
      if (colorMap[lower]) { titleColor = colorMap[lower]; break; }
      // חיפוש חלקי
      for (const [key, val] of Object.entries(colorMap)) {
        if (lower.includes(key) || key.includes(lower)) { titleColor = val; break; }
      }
      if (titleColor) break;
    }
    if (!titleColor) {
      console.log(`    ⚠️ לא נמצא צבע בכותרת: "${data.title}"`);
      unknownColors.add(data.title);
    }

    // === עיבוד מלאי ===
    // לוגיקת אורך: מידה נחשבת "במלאי" אם היא זמינה באורך כלשהו.
    // אם אין ציר אורך כלל — הלוגיקה הרגילה.
    const availableSizes = new Set();
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

    const uniqueSizes = [...availableSizes];

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
      `INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, description, source_url, color_sizes, pattern, fabric, design_details, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (source_url) DO UPDATE SET
         title=EXCLUDED.title, price=EXCLUDED.price, original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url, images=EXCLUDED.images, sizes=EXCLUDED.sizes,
         color=EXCLUDED.color, colors=EXCLUDED.colors, style=EXCLUDED.style, fit=EXCLUDED.fit,
         category=EXCLUDED.category, description=EXCLUDED.description,
         color_sizes=EXCLUDED.color_sizes, pattern=EXCLUDED.pattern, fabric=EXCLUDED.fabric,
         design_details=EXCLUDED.design_details, last_seen=NOW()`,
      ['CHEN', product.title, product.price || 0, product.originalPrice || null,
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
const MAX_PRODUCTS = 999; // ללא הגבלה מעשית - סורק הכל

const browser = await chromium.launch({ headless: false, slowMo: 30 });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 }
});
const page = await context.newPage();

try {
  const urls = await getAllProductUrls(page);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);

  let ok = 0, fail = 0, skipped = 0;
  for (let i = 0; i < urls.length; i++) {
    console.log(`\n[${i + 1}/${urls.length}]`);
    const p = await scrapeProduct(page, urls[i]);
    if (p) { await saveProduct(p); ok++; }
    else if (p === null) {
      // null = כשל או דלג
      fail++;
    }
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
      problems.push(`   ❓ "${c}" - הוסף ל-colorMap בסקרייפר`);
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
