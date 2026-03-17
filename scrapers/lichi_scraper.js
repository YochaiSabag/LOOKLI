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

console.log('🚀 LICHI Scraper - WooCommerce Store');

// ======================================================================
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
  'שזיף': 'סגול',
  'ססגוני': 'צבעוני', 'ססגונית': 'צבעוני',
  'פודרה': 'ורוד', 'powder': 'ורוד',
  'אבן': 'אבן',
  'בהיר': 'בהיר',
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
  if (/^(XS|S|M|L|XL|2?XXL|XXXL)$/i.test(val)) return [val.replace('2XL','XXL')];
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  if (sizeMapping[val]) return sizeMapping[val];
  return [];
}

// ======================================================================
// סינון מוצרים לא רלוונטיים — רק בגדי נשים בוגרות
// ======================================================================
const SKIP_KEYWORDS = [
  // תכשיטים ואקססוריז
  'עגיל','עגילי','עגיות','שרשרת','צמיד','טבעת','תכשיט',
  'כובע','צעיף','תיק','ארנק','משקפיים','משקפי שמש',
  'גומייה','מטפחת','קשת','שעון','שיער',
  // נעליים
  'נעל','נעלי','סנדל','סנדלי','מגף','מגפיים','מגפון',
  'כפכף','בלרינה','מוקסין','אספדריל','קבקב','עקב',
  // בגד ים
  'בגד ים','ביקיני','בגדי ים',
  // ילדות
  'ילדה','ילדות','ג׳וניור','junior','kids',
  // אחר
  'פיג׳מה','פיגמה','גרביון','גרביים','גרבי',
];

function shouldSkip(title) {
  if (!title) return false;
  const t = title.toLowerCase().trim();
  return SKIP_KEYWORDS.some(k => {
    const kl = k.toLowerCase();
    if (kl.includes(' ')) {
      // ביטוי של שתי מילים — חיפוש רגיל
      return t.includes(kl);
    }
    // מילה בודדת — בדוק גבולות
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
// איסוף קישורי מוצרים - מכל קטגוריה (חוץ מנעליים)
// ======================================================================
async function getAllProductUrls(page, maxProducts = 99999) {
  console.log('\n📂 איסוף קישורים מ-lichi-shop.com...\n');
  const allUrls = new Set();
  
  // קטגוריות מעודכנות
  const categories = [
    'https://lichi-shop.com/product-category/sale-2/',
    'https://lichi-shop.com/product-category/shirts/',
    'https://lichi-shop.com/product-category/dresses/',
    'https://lichi-shop.com/product-category/skirts/',
    'https://lichi-shop.com/product-category/sets/',
    'https://lichi-shop.com/shop/',
  ];
  
  for (const catUrl of categories) {
    // עבור על דפים בכל קטגוריה
    for (let pageNum = 1; pageNum <= 50; pageNum++) {
      
      const url = pageNum === 1 ? catUrl : `${catUrl}page/${pageNum}/`;
      try {
        console.log(`  → ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        
        // גלילה חכמה — ממתין לטעינת מוצרים נוספים
        let lastCount = 0;
        let noChangeCycles = 0;
        for (let i = 0; i < 20; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2500);
          const count = await page.evaluate(() =>
            document.querySelectorAll('a[href*="/product/"]').length
          );
          console.log(`      גלילה ${i+1}: ${count} קישורים`);
          if (count === lastCount) {
            noChangeCycles++;
            if (noChangeCycles >= 3) break; // 3 גלילות ברצף ללא שינוי — עוצר
          } else {
            noChangeCycles = 0;
          }
          lastCount = count;
        }
        
        const urls = await page.evaluate(() => 
          [...document.querySelectorAll('a[href*="/product/"]')]
            .map(a => a.href.split('?')[0])
            .filter(h => h.includes('lichi-shop.com/product/'))
            .filter((v, i, a) => a.indexOf(v) === i)
        );
        
        const prevSize = allUrls.size;
        urls.forEach(u => allUrls.add(u));
        console.log(`    ✓ ${urls.length} (סה"כ: ${allUrls.size})`);
        
        if (allUrls.size === prevSize) break;
      } catch (e) {
        console.log(`    ✗ ${e.message.substring(0, 30)}`);
        break;
      }
    }
  }
  
  const result = [...allUrls].slice(0, maxProducts);
  console.log(`\n  ✓ סה"כ: ${result.length} קישורים\n`);
  return result;
}

// ======================================================================
// סקרייפ מוצר בודד - LICHI (WooCommerce)
// ======================================================================
async function scrapeProduct(page, url) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 35) || url.substring(0, 50);
  console.log(`\n🔍 ${shortUrl}...`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    
    const data = await page.evaluate(() => {
      // === כותרת ===
      let title = document.querySelector('h1.product_title, h1.elementor-heading-title, h1')?.innerText?.trim() || '';
      // ניקוי קודי מוצר
      title = title.replace(/\s*W?\d{6,}\s*/gi, '').trim();
      
      // === מחיר (WooCommerce standard) ===
      let price = 0;
      let originalPrice = null;
      
      const priceContainer = document.querySelector('p.price');
      if (priceContainer) {
        const hasDel = priceContainer.querySelector('del');
        const hasIns = priceContainer.querySelector('ins');
        
        if (hasDel && hasIns) {
          const delBdi = hasDel.querySelector('bdi');
          const insBdi = hasIns.querySelector('bdi');
          if (delBdi) {
            const delText = delBdi.textContent.replace(/[^\d.]/g, '');
            if (delText) originalPrice = parseFloat(delText);
          }
          if (insBdi) {
            const insText = insBdi.textContent.replace(/[^\d.]/g, '');
            if (insText) price = parseFloat(insText);
          }
        } else {
          const regularBdi = priceContainer.querySelector('.woocommerce-Price-amount bdi');
          if (regularBdi) {
            const priceText = regularBdi.textContent.replace(/[^\d.]/g, '');
            if (priceText) price = parseFloat(priceText);
          }
        }
      }
      
      // === תמונות ===
      const images = [];
      
      // שיטה 1: WooCommerce gallery
      document.querySelectorAll('.woocommerce-product-gallery__image a').forEach(a => {
        if (a.href && a.href.includes('uploads') && !images.includes(a.href)) images.push(a.href);
      });
      document.querySelectorAll('.woocommerce-product-gallery__image img').forEach(img => {
        const src = img.getAttribute('data-large_image');
        if (src && !images.includes(src)) images.push(src);
      });
      
      // שיטה 2: Elementor gallery / gallery-icon
      if (images.length === 0) {
        document.querySelectorAll('.gallery-icon img, .gallery-item img').forEach(img => {
          let src = img.src;
          if (src && src.includes('uploads')) {
            // הסר resize suffixes כדי לקבל תמונה מלאה
            src = src.replace(/-\d+x\d+(?=\.\w+$)/, '');
            if (!images.includes(src)) images.push(src);
          }
        });
      }
      
      // שיטה 3: כל התמונות של המוצר
      if (images.length === 0) {
        document.querySelectorAll('.product img, .product-images img').forEach(img => {
          if (img.src && img.src.includes('uploads') && !img.src.includes('-150x') && 
              !img.src.includes('-50x') && !images.includes(img.src)) {
            images.push(img.src);
          }
        });
      }
      
      // === תיאור - רק מטאב "מידע נוסף" ===
      let description = '';
      
      // חפש לפי כותרת טאב "מידע נוסף" / "תיאור" - רק משם!
      const tabTitles = document.querySelectorAll('.elementor-tab-title, .elementor-tab-mobile-title');
      for (const titleEl of tabTitles) {
        const tabTitle = titleEl.textContent?.trim() || '';
        if (tabTitle === 'מידע נוסף' || tabTitle.includes('תיאור')) {
          const tabId = titleEl.getAttribute('data-tab');
          if (tabId) {
            const contentEl = document.querySelector(`.elementor-tab-content[data-tab="${tabId}"]`);
            if (contentEl) {
              // קח רק טקסט מ-p tags (לא מטבלאות)
              const paragraphs = contentEl.querySelectorAll('p');
              if (paragraphs.length > 0) {
                const texts = [];
                paragraphs.forEach(p => {
                  const t = p.innerText?.trim();
                  if (t) texts.push(t);
                });
                description = texts.join('\n');
              } else {
                // אם אין p tags, קח את כל הטקסט
                const text = contentEl.innerText?.trim();
                // אבל רק אם זה לא טבלת מידות
                if (text && !text.includes('היקף חזה') && !text.includes('היקף מותן') && 
                    !text.match(/\b(76|81|86|91|96)\b.*\b(76|81|86|91|96)\b/)) {
                  description = text;
                }
              }
            }
          }
          break; // מצאנו את הטאב, לא ממשיכים
        }
      }
      
      // fallback: WooCommerce short description (לא מטאבים אחרים!)
      if (!description) {
        const descEl = document.querySelector('.woocommerce-product-details__short-description');
        if (descEl) description = descEl.innerText?.trim() || '';
      }
      
      // === צבעים ומידות (WooCommerce WVS swatches) ===
      const rawColors = [];
      const rawSizes = [];
      
      // שיטה 1: מ-swatches/buttons (variable-items-wrapper)
      document.querySelectorAll('.variable-items-wrapper li').forEach(el => {
        const attrName = el.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || 
                        el.getAttribute('data-attribute_name') || '';
        // LICHI uses data-title for display name, data-value for URL-encoded value
        const displayTitle = el.getAttribute('data-title') || el.getAttribute('title') || '';
        const val = el.getAttribute('data-value') || displayTitle;
        
        if (!val) return;
        
        if (attrName.includes('tzba') || attrName.includes('color') || attrName.includes('צבע')) {
          // Use display title (Hebrew) not URL-encoded value
          if (displayTitle && !rawColors.includes(displayTitle)) rawColors.push(displayTitle);
          else if (!rawColors.includes(val)) rawColors.push(val);
        } else if (attrName.includes('mydh') || attrName.includes('size') || attrName.includes('מידה')) {
          if (displayTitle && !rawSizes.includes(displayTitle)) rawSizes.push(displayTitle);
          else if (!rawSizes.includes(val)) rawSizes.push(val);
        }
      });
      
      // שיטה 2: מ-select elements
      document.querySelectorAll('select').forEach(select => {
        const name = (select.name || select.id || '').toLowerCase();
        Array.from(select.options).forEach(opt => {
          const val = opt.value?.trim();
          const text = opt.textContent?.trim();
          if (!val || val === '' || val.includes('בחירת') || val.includes('choose')) return;
          if (name.includes('color') || name.includes('צבע') || name.includes('tzba')) {
            const displayVal = text || val;
            if (!rawColors.includes(displayVal)) rawColors.push(displayVal);
          } else if (name.includes('size') || name.includes('מידה') || name.includes('mydh')) {
            const displayVal = text || val;
            if (!rawSizes.includes(displayVal)) rawSizes.push(displayVal);
          }
        });
      });
      
      return { title, price, originalPrice, images, description, rawColors, rawSizes };
    });
    
    if (!data.title) { console.log('  ✗ no title'); return null; }
    if (shouldSkip(data.title)) { console.log(`  ⏭️ מדלג (לא רלוונטי): ${data.title.substring(0,30)}`); return null; }
    
    const style = detectStyle(data.title, data.description);
    const fit = detectFit(data.title, data.description);
    const category = detectCategory(data.title);
    const pattern = detectPattern(data.title, data.description);
    const fabric = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);
    
    // === עיבוד צבעים ומידות ===
    // שיטה 1: נסה לקרוא מ-variations JSON שמוטמע בדף
    const variationsData = await page.evaluate(() => {
      // WooCommerce שומר את כל הוריאציות ב-form data-product_variations
      const form = document.querySelector('form.variations_form');
      if (form) {
        try {
          const variationsJson = form.getAttribute('data-product_variations');
          if (variationsJson) {
            const variations = JSON.parse(variationsJson);
            return variations.map(v => ({
              attributes: v.attributes,
              is_in_stock: v.is_in_stock,
              is_purchasable: v.is_purchasable,
              stock_status: v.stock_status || (v.is_in_stock ? 'instock' : 'outofstock')
            }));
          }
        } catch(e) {}
      }
      return null;
    });
    
    const colorSizesMap = {};
    const availableSizes = new Set();
    const availableColors = new Set();
    
    console.log(`    Raw colors: ${data.rawColors.join(', ') || 'none'}`);
    console.log(`    Raw sizes: ${data.rawSizes.join(', ') || 'none'}`);
    
    if (variationsData && variationsData.length > 0) {
      // === שיטה מהירה: קריאת JSON (לא תלוי ב-JS של האתר) ===
      console.log(`    📋 נמצאו ${variationsData.length} וריאציות ב-JSON`);
      
      for (const v of variationsData) {
        if (!v.is_in_stock) continue; // רק מוצרים במלאי
        
        const attrs = v.attributes || {};
        let colorVal = null;
        let sizeVal = null;
        
        for (const [key, val] of Object.entries(attrs)) {
          const k = key.toLowerCase();
          if (k.includes('tzba') || k.includes('color') || k.includes('צבע')) colorVal = val;
          else if (k.includes('mydh') || k.includes('size') || k.includes('מידה')) sizeVal = val;
        }
        
        // נרמול צבע - ייתכן שהערך encoded או באנגלית
        let normColor = null;
        if (colorVal) {
          // נסה למצוא את שם התצוגה מ-rawColors
          let displayColor = colorVal;
          try { displayColor = decodeURIComponent(colorVal); } catch(e) {}
          // חפש ב-rawColors שם שמתאים
          for (const rc of data.rawColors) {
            const rcLower = rc.toLowerCase();
            const valLower = displayColor.toLowerCase();
            if (rcLower === valLower || rcLower.includes(valLower) || valLower.includes(rcLower)) {
              displayColor = rc;
              break;
            }
          }
          normColor = normalizeColor(displayColor);
        }
        
        // נרמול מידה
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
    } else if (data.rawColors.length > 0 && data.rawSizes.length > 0) {
      // === שיטה 2: fallback - בדיקה דרך לחיצות (WooCommerce JS) ===
      console.log(`    ⚠️ אין variations JSON - מנסה בדיקה ידנית...`);
      
      // בדוק אם ה-variation handler עובד
      let variationWorks = false;
      
      // נסה לחיצה אחת לבדיקה
      try {
        await page.evaluate((c) => {
          const items = document.querySelectorAll('.variable-items-wrapper li');
          for (const item of items) {
            const attrName = item.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || '';
            if (attrName.includes('tzba') || attrName.includes('color')) {
              const title = item.getAttribute('data-title') || item.getAttribute('title');
              if (title === c) { item.click(); return; }
            }
          }
          const sel = document.querySelector('select[name*="tzba"], select[name*="color"]');
          if (sel) { sel.value = sel.options[1]?.value; sel.dispatchEvent(new Event('change', {bubbles:true})); }
        }, data.rawColors[0]);
        await page.waitForTimeout(800);
        
        await page.evaluate((s) => {
          const items = document.querySelectorAll('.variable-items-wrapper li');
          for (const item of items) {
            const attrName = item.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || '';
            if (attrName.includes('mydh') || attrName.includes('size')) {
              const title = item.getAttribute('data-title') || item.getAttribute('title');
              if (title === s) { item.click(); return; }
            }
          }
        }, data.rawSizes[0]);
        await page.waitForTimeout(1000);
        
        variationWorks = await page.evaluate(() => {
          // בדוק אם יש תגובת variation
          const variation = document.querySelector('.woocommerce-variation');
          if (variation && variation.style.display !== 'none') return true;
          const priceDisplay = document.querySelector('.woocommerce-variation-price');
          if (priceDisplay && priceDisplay.innerHTML.trim()) return true;
          return false;
        });
      } catch(e) {}
      
      if (!variationWorks) {
        // האתר שבור - נניח שכל מה שמופיע במלאי
        console.log(`    ⚠️ WooCommerce variation handler שבור - מניח שכל המידות במלאי`);
        for (const color of data.rawColors) {
          const normColor = normalizeColor(color);
          if (!normColor) continue;
          if (!colorSizesMap[normColor]) colorSizesMap[normColor] = [];
          for (const size of data.rawSizes) {
            const normSizes = normalizeSize(size);
            for (const ns of normSizes) {
              availableSizes.add(ns);
              availableColors.add(normColor);
              if (!colorSizesMap[normColor].includes(ns)) colorSizesMap[normColor].push(ns);
            }
          }
        }
      } else {
        // variation handler עובד - בדוק כל שילוב
        for (const color of data.rawColors) {
          await page.evaluate((c) => {
            const items = document.querySelectorAll('.variable-items-wrapper li');
            for (const item of items) {
              const attrName = item.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || '';
              if (attrName.includes('tzba') || attrName.includes('color') || attrName.includes('צבע')) {
                const title = item.getAttribute('data-title') || item.getAttribute('title');
                if (title === c) { item.click(); return; }
              }
            }
            const sel = document.querySelector('select[name*="tzba"], select[name*="color"]');
            if (sel) { for (const opt of sel.options) { if (opt.textContent?.trim() === c || opt.value === c) { sel.value = opt.value; sel.dispatchEvent(new Event('change', {bubbles:true})); return; } } }
          }, color);
          await page.waitForTimeout(800);
          
          const normColor = normalizeColor(color);
          if (!normColor) { console.log(`      ⚠️ צבע לא מזוהה: ${color}`); continue; }
          if (!colorSizesMap[normColor]) colorSizesMap[normColor] = [];
          
          for (const size of data.rawSizes) {
            await page.evaluate((s) => {
              const items = document.querySelectorAll('.variable-items-wrapper li');
              for (const item of items) {
                const attrName = item.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || '';
                if (attrName.includes('mydh') || attrName.includes('size') || attrName.includes('מידה')) {
                  const title = item.getAttribute('data-title') || item.getAttribute('title');
                  if (title === s) { item.click(); return; }
                }
              }
              const sel = document.querySelector('select[name*="mydh"], select[name*="size"]');
              if (sel) { for (const opt of sel.options) { if (opt.textContent?.trim() === s || opt.value === s.toLowerCase()) { sel.value = opt.value; sel.dispatchEvent(new Event('change', {bubbles:true})); return; } } }
            }, size);
            await page.waitForTimeout(600);
            
            const inStock = await page.evaluate(() => {
              const stockEl = document.querySelector('.woocommerce-variation-availability .stock');
              if (stockEl) {
                if (stockEl.classList.contains('out-of-stock') || stockEl.textContent.toLowerCase().includes('אזל')) return false;
                if (stockEl.classList.contains('in-stock') || stockEl.textContent.toLowerCase().includes('במלאי')) return true;
              }
              const btn = document.querySelector('.single_add_to_cart_button');
              if (btn && btn.disabled) return false;
              const variation = document.querySelector('.woocommerce-variation-add-to-cart');
              if (variation?.classList.contains('woocommerce-variation-add-to-cart-disabled')) return false;
              return true;
            });
            
            const normSizes = normalizeSize(size);
            if (inStock && normSizes.length > 0) {
              for (const normSize of normSizes) {
                availableSizes.add(normSize);
                availableColors.add(normColor);
                if (!colorSizesMap[normColor].includes(normSize)) colorSizesMap[normColor].push(normSize);
              }
              console.log(`      ✓ ${normColor} + ${normSizes.join('/')}`);
            } else if (normSizes.length > 0) {
              console.log(`      ✗ ${normColor} + ${normSizes.join('/')} (אזל)`);
            }
          }
        }
      }
    } else if (data.rawSizes.length > 0) {
      // אין צבעים, רק מידות
      for (const size of data.rawSizes) {
        await page.evaluate((s) => {
          const items = document.querySelectorAll('.variable-items-wrapper li');
          for (const item of items) {
            const attrName = item.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || '';
            if (attrName.includes('mydh') || attrName.includes('size')) {
              const title = item.getAttribute('data-title') || item.getAttribute('title');
              if (title === s) { item.click(); return; }
            }
          }
        }, size);
        await page.waitForTimeout(600);
        
        const inStock = await page.evaluate(() => {
          const stockEl = document.querySelector('.woocommerce-variation-availability .stock');
          if (stockEl?.classList.contains('out-of-stock')) return false;
          const btn = document.querySelector('.single_add_to_cart_button');
          return !btn?.disabled;
        });
        
        const normSizes = normalizeSize(size);
        if (inStock && normSizes.length > 0) {
          normSizes.forEach(s => availableSizes.add(s));
        }
      }
    }
    
    const uniqueColors = [...availableColors];
    const uniqueSizes = [...availableSizes];
    const mainColor = uniqueColors[0] || null;
    
    console.log(`  ✓ ${data.title.substring(0, 35)}`);
    console.log(`    💰 ₪${data.price}${data.originalPrice ? ` (מקור: ₪${data.originalPrice}) SALE!` : ''} | 🎨 ${mainColor || '-'} (${uniqueColors.join(',')}) | 📏 ${uniqueSizes.join(',') || '-'} | 🖼️ ${data.images.length}`);
    if (category) console.log(`    📁 ${category} | 🎨 ${style || '-'} | 📐 ${fit || '-'} | 🧵 ${fabric || '-'} | 🎭 ${pattern || '-'}`);
    
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
// שמירה ל-DB - חנות = LICHI
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
      ['LICHI', product.title, product.price || 0, product.originalPrice || null,
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
const MAX_PRODUCTS = 99999;

const browser = await chromium.launch({ headless: false, slowMo: 30 });
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
    await page.waitForTimeout(500);
  }
  
  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  
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
