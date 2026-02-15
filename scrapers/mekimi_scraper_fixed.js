import { chromium } from 'playwright';
import pkg from 'pg';
console.log("ENV DATABASE_URL =", process.env.DATABASE_URL ? "SET" : "MISSING");
console.log("ENV DB_HOST =", process.env.DB_HOST || "(empty)");
const { Client } = pkg;

const connStr = process.env.DATABASE_URL;
const useSSL = connStr && (connStr.includes('rlwy.net') || connStr.includes('amazonaws.com') || connStr.includes('supabase'));

const db = new Client({
  connectionString: connStr,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

await db.connect();

console.log('🚀 Mekimi Scraper - COMPLETE FIX');

// ======================================================================
// מיפוי צבעים - כל הצבעים שרוצים לתמוך בהם
// איך להוסיף צבע חדש:
// 1. הוסף את הצבע באנגלית (lowercase) כ-key
// 2. הצבע העברי המנורמל כ-value
// לדוגמה: 'turquoise': 'תכלת' - כל מוצר עם צבע turquoise יהפוך ל"תכלת"
// ======================================================================
const colorMap = {
  // שחור
  'black': 'שחור', 
  'שחור': 'שחור',
  
  // לבן
  'white': 'לבן', 
  'לבן': 'לבן',
  
  // כחול
  'blue': 'כחול', 
  'כחול': 'כחול', 
  'navy': 'כחול', 
  'נייבי': 'כחול',
  'royal': 'כחול',
  'cobalt': 'כחול',
  'denim': 'כחול',
  'indigo': 'כחול',
  
  // אדום
  'red': 'אדום', 
  'אדום': 'אדום',
  'scarlet': 'אדום',
  'crimson': 'אדום',
  
  // ירוק - כולל snake (#6)
  'green': 'ירוק', 
  'ירוק': 'ירוק', 
  'olive': 'ירוק', 
  'זית': 'ירוק', 
  'khaki': 'ירוק', 
  'חאקי': 'ירוק', 
  'snake': 'ירוק',        // #6 - snake = ירוק
  'emerald': 'ירוק',
  'forest': 'ירוק',
  'sage': 'ירוק',
  'teal': 'ירוק',
  'army': 'ירוק',
  'ירוק-זית': 'ירוק',
  'olive-green': 'ירוק',
  'dark-green': 'ירוק',
  'darkgreen': 'ירוק',
  'ירוקזית': 'ירוק',
  'hunter': 'ירוק',
  
  // חום - כולל קפה (#7)
  'brown': 'חום', 
  'חום': 'חום', 
  'tan': 'חום', 
  'chocolate': 'חום',
  'coffee': 'חום',         // #7 - coffee = חום
  'קפה': 'חום',            // #7 - קפה = חום
  'mocha': 'חום',
  'espresso': 'חום',
  'chestnut': 'חום',
  
  // קאמל
  'camel': 'קאמל', 
  'קאמל': 'קאמל',
  'cognac': 'קאמל',
  
  // בז׳
  'beige': 'בז׳', 
  'בז': 'בז׳', 
  'nude': 'בז׳', 
  'ניוד': 'בז׳',
  'sand': 'בז׳',
  'taupe': 'בז׳',
  
  // אפור
  'gray': 'אפור', 
  'grey': 'אפור', 
  'אפור': 'אפור',
  'charcoal': 'אפור',
  'slate': 'אפור',
  'ash': 'אפור',
  
  // ורוד
  'pink': 'ורוד', 
  'ורוד': 'ורוד', 
  'coral': 'ורוד', 
  'קורל': 'ורוד',
  'blush': 'ורוד',
  'rose': 'ורוד',
  'fuchsia': 'ורוד',
  'magenta': 'ורוד',
  'salmon': 'ורוד',
  
  // סגול
  'purple': 'סגול', 
  'סגול': 'סגול', 
  'lilac': 'סגול', 
  'לילך': 'סגול',
  'lavender': 'סגול',
  'violet': 'סגול',
  'plum': 'סגול',
  'mauve': 'סגול',
  
  // צהוב
  'yellow': 'צהוב', 
  'צהוב': 'צהוב', 
  'mustard': 'צהוב', 
  'חרדל': 'צהוב',
  'gold': 'צהוב',
  'lemon': 'צהוב',
  
  // כתום
  'orange': 'כתום', 
  'כתום': 'כתום',
  'tangerine': 'כתום',
  'rust': 'כתום',
  
  // זהב
  'זהב': 'זהב',
  'golden': 'זהב',
  
  // כסף
  'silver': 'כסף', 
  'כסף': 'כסף',
  
  // בורדו
  'bordo': 'בורדו', 
  'בורדו': 'בורדו', 
  'burgundy': 'בורדו', 
  'wine': 'בורדו',
  'maroon': 'בורדו',
  'oxblood': 'בורדו',
  'cherry': 'בורדו',
  'plum': 'בורדו',
  
  // שמנת - כולל stone (#5)
  'cream': 'שמנת', 
  'שמנת': 'שמנת', 
  'ivory': 'שמנת', 
  'offwhite': 'שמנת',
  'off-white': 'שמנת',
  'stone': 'שמנת',        // #5 - stone = שמנת
  'bone': 'שמנת',
  'ecru': 'שמנת',
  'vanilla': 'שמנת',
  
  // תכלת
  'turquoise': 'תכלת', 
  'tourquise': 'תכלת',
  'תכלת': 'תכלת', 
  'טורקיז': 'תכלת',
  'aqua': 'תכלת',
  'cyan': 'תכלת',
  'skyblue': 'תכלת',
  'sky': 'תכלת',
  
  // צבעים מיוחדים - מיפוי לפי הגיון
  'dots': 'שחור',          // dots = נקודות, בד"כ שחור על לבן
  'flower': 'ורוד',        // flower = פרחוני
  'breek': 'חום',          // breek/brick = לבנה/חום
  'brick': 'חום',
  
  // צבעים מיוחדים
  'פרחוני': 'פרחוני', 'צבעוני': 'צבעוני', 'מולטי': 'צבעוני', 'multi': 'צבעוני', 'multicolor': 'צבעוני',
  // מנטה - צבע עצמאי
  'mint': 'מנטה', 'מנטה': 'מנטה', 'menta': 'מנטה',
  // אפרסק - צבע עצמאי
  'אפרסק': 'אפרסק', 'peach': 'אפרסק',
  // בננה → צהוב
  'בננה': 'צהוב', 'banana': 'צהוב',
  // כסוף → כסף
  'כסוף': 'כסף'
};

// רשימת צבעים לא מזוהים - לדיווח
const unknownColors = new Set();

// ======================================================================
// פונקציה לנרמול צבע - ממירה כל שם צבע לצבע העברי המתאים
// ======================================================================
function normalizeColor(c) {
  if (!c) return null;
  const original = c;
  const lower = c.toLowerCase().trim();
  const noSpaces = lower.replace(/[-_\s]/g, '');
  
  // חיפוש ישיר
  if (colorMap[noSpaces]) return colorMap[noSpaces];
  if (colorMap[lower]) return colorMap[lower];
  
  // בדיקה מילה-מילה: "כחול מעושן" → כחול
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (colorMap[word]) return colorMap[word];
  }
  
  // חיפוש חלקי
  for (const [key, val] of Object.entries(colorMap)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  
  // צבע לא מזוהה - שמור לדיווח
  unknownColors.add(original);
  return null;
}

// ======================================================================
// מיפוי מידות - המרה למידות אוניברסליות
// לפי הטבלה: כל מידה אירופאית מופיעה בשתי מידות בינלאומיות
// למשל: 44 → L + XL (לפי טווח 44-46)
// ======================================================================
const sizeMapping = {
  // מידות מספריות (מידה) -> מה הן מייצגות
  'Y': ['XS'],
  '0': ['S'],
  '1': ['M'],
  '2': ['L'],
  '3': ['XL'],
  '4': ['XXL'],
  '5': ['XXXL'],
  // מידות אירופאיות - כל מידה מופיעה בשתי מידות בינלאומיות לפי הטבלה
  '34': ['XS'],           // 34-36 → XS
  '36': ['XS', 'S'],      // 36-38 → XS + S
  '38': ['S', 'M'],       // 38-40 → S + M
  '40': ['M', 'L'],       // 40-42 → M + L
  '42': ['L', 'XL'],      // 42-44 → L + XL
  '44': ['XL', 'XXL'],    // 44-46 → XL + XXL
  '46': ['XXL', 'XXXL'],  // 46-48 → XXL + XXXL
  '48': ['XXXL'],         // 48-50 → XXXL
  '50': ['XXXL']
};

// מיפוי הפוך - מידה בינלאומית מציגה את כל המספרים התואמים
const universalToNumbers = {
  'XS': ['Y', '34', '36'],
  'S': ['0', '36', '38'],
  'M': ['1', '38', '40'],
  'L': ['2', '40', '42'],
  'XL': ['3', '42', '44'],
  'XXL': ['4', '44', '46'],
  'XXXL': ['5', '46', '48', '50']
};

function normalizeSize(s) {
  if (!s) return [];
  const val = s.toString().toUpperCase().trim();
  
  // מידות אוניברסליות - מחזיר כמו שזה
  if (/^(XS|S|M|L|XL|XXL|XXXL)$/i.test(val)) return [val];
  
  // ONE SIZE
  if (/ONE.?SIZE/i.test(val)) return ['ONE SIZE'];
  
  // מידות מספריות 0-5 או אירופאיות 34-46
  if (sizeMapping[val]) return sizeMapping[val];
  
  return [];
}

// ======================================================================
// זיהוי קטגוריה מהכותרת
// ======================================================================
function detectCategory(title) {
  const t = (title || '').toLowerCase();
  
  // סדר חשוב - בדיקות ספציפיות קודם
  if (/קרדיגן|cardigan/i.test(t)) return 'קרדיגן';
  if (/סוודר|sweater|סוודר/i.test(t)) return 'סוודר';
  if (/גולף/i.test(t)) return 'גולף';  // גולף = עיצוב, אבל גם קטגוריה אם זה המוצר העיקרי
  if (/טוניקה|tunic/i.test(t)) return 'טוניקה';
  if (/סרפן|pinafore/i.test(t)) return 'סרפן';
  if (/שמלה|שמלת|dress/i.test(t)) return 'שמלה';
  if (/חצאית|skirt/i.test(t)) return 'חצאית';
  if (/חולצה|חולצת|טופ|top|shirt|blouse/i.test(t)) return 'חולצה';
  if (/בלייזר|blazer/i.test(t)) return 'בלייזר';
  if (/ז׳קט|ג׳קט|jacket/i.test(t)) return 'ז׳קט';
  if (/וסט|vest/i.test(t)) return 'וסט';
  if (/עליונית/i.test(t)) return 'עליונית';
  if (/מעיל|coat/i.test(t)) return 'מעיל';
  if (/שכמיה|cape|poncho/i.test(t)) return 'שכמיה';
  if (/קפוצ׳ון|קפוצון|hoodie/i.test(t)) return 'קפוצ׳ון';
  if (/חלוק|robe|אירוח/i.test(t)) return 'חלוק';
  if (/מכנס|pants|trousers|ג׳ינס|jeans/i.test(t)) return 'מכנסיים';
  if (/אוברול|jumpsuit|overall/i.test(t)) return 'אוברול';
  if (/סט|set/i.test(t)) return 'סט';
  
  return null;
}

// זיהוי סגנון מכותרת ותיאור
function detectStyle(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  
  // ערב (כולל "שבת") - חגיגי/פורמלי
  if (/שבת|ערב|אירוע|מיוחד|מסיבה|party|evening|formal|גאלה|נשף/i.test(text)) return 'ערב';
  // חגיגי
  if (/חגיג|celebration|festive/i.test(text)) return 'חגיגי';
  // אלגנטי
  if (/אלגנט|elegant|מהודר|יוקרת/i.test(text)) return 'אלגנטי';
  // קלאסי
  if (/קלאסי|classic|נצחי|timeless/i.test(text)) return 'קלאסי';
  // מינימליסטי
  if (/מינימליסט|minimal|פשוט|נקי|clean/i.test(text)) return 'מינימליסטי';
  // מודרני
  if (/מודרני|modern|עכשווי|contemporary/i.test(text)) return 'מודרני';
  // רטרו
  if (/רטרו|retro|וינטג׳|vintage/i.test(text)) return 'רטרו';
  // אוברסייז
  if (/אוברסייז|oversize|oversized|רחב מאוד/i.test(text)) return 'אוברסייז';
  // יום חול - כל הווריאציות
  if (/יום.?חול|casual|קז׳ואל|קזואל|יומיומי|יום.?יום|ליום.?יום|daily|everyday|יום-יומי|יומי/i.test(text)) return 'יום חול';
  
  return '';
}

// זיהוי גיזרה מכותרת בלבד (לא מתיאור!)
function detectFit(title, description = '') {
  // חשוב: מזהים גיזרה רק מהכותרת, לא מהתיאור
  const text = (title || '').toLowerCase();
  
  // ישרה
  if (/ישרה|straight/i.test(text)) return 'ישרה';
  // A
  if (/a.?line|איי.?ליין/i.test(text)) return 'A';
  // מתרחבת
  if (/מתרחב|flare|התרחבות/i.test(text)) return 'מתרחבת';
  // רפויה / רחבה
  if (/רפוי|רחב|loose|relaxed|wide/i.test(text)) return 'רפויה';
  // אוברסייז
  if (/אוברסייז|oversize|oversized/i.test(text)) return 'אוברסייז';
  // מחויטת
  if (/מחויט|tailored|מותאמ/i.test(text)) return 'מחויטת';
  // מעטפת
  if (/מעטפ|wrap/i.test(text)) return 'מעטפת';
  // עפרון
  if (/עפרון|pencil/i.test(text)) return 'עפרון';
  // צמודה / צרה
  if (/צמוד|tight|fitted|bodycon|צמודה|צר|narrow/i.test(text)) return 'צמודה';
  // ארוכה (=מקסי)
  if (/מקסי|maxi|ארוכ/i.test(text)) return 'ארוכה';
  // מידי (=אמצע)
  if (/מידי|midi|אמצע/i.test(text)) return 'מידי';
  // קצרה (=מיני)
  if (/קצר|מיני|mini|short/i.test(text)) return 'קצרה';
  // הריון והנקה ומותן - בודקים גם בתיאור
  const fullText = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/במותן|מותן גבוה|מותן נמוך|high.?waist|waisted/i.test(fullText)) return 'מותן';
  if (/הריון|pregnancy|maternity/i.test(fullText)) return 'הריון';
  if (/הנקה|nursing|breastfeed/i.test(fullText)) return 'הנקה';
  
  return '';
}

// ======================================================================
// זיהוי פרטי עיצוב מכותרת ותיאור
// ======================================================================
function detectDesignDetails(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  const details = [];
  
  // צווארון
  if (/צווארון\s*וי|צווארון\s*v|v.?neck/i.test(text)) details.push('צווארון V');
  if (/צווארון\s*עגול|round.?neck|crew.?neck/i.test(text)) details.push('צווארון עגול');
  if (/גולף|turtle.?neck|mock.?neck/i.test(text)) details.push('גולף');
  if (/צווארון\s*סיני|mandarin|צווארון\s*גבוה/i.test(text)) details.push('צווארון גבוה');
  if (/בואט|boat.?neck|סירה/i.test(text)) details.push('צווארון סירה');
  if (/חשוף\s*כתפ|off.?shoulder|כתף\s*חשופה/i.test(text)) details.push('כתפיים חשופות');
  
  // כפתורים ורוכסנים
  if (/כפתור|מכופתר|button/i.test(text)) details.push('כפתורים');
  if (/רוכסן|zipper|zip/i.test(text)) details.push('רוכסן');
  
  // שרוולים
  if (/שרוול\s*ארוך|long.?sleeve/i.test(text)) details.push('שרוול ארוך');
  if (/שרוול\s*קצר|short.?sleeve/i.test(text)) details.push('שרוול קצר');
  if (/שרוול\s*3\/4|שרוול\s*שלושת\s*רבעי/i.test(text)) details.push('שרוול 3/4');
  if (/ללא\s*שרוול|sleeveless|בלי\s*שרוול/i.test(text)) details.push('ללא שרוולים');
  if (/שרוול\s*פעמון|bell.?sleeve/i.test(text)) details.push('שרוול פעמון');
  if (/שרוול\s*נפוח|puff.?sleeve/i.test(text)) details.push('שרוול נפוח');
  
  // חגורה וקשירה
  if (/חגורה|belt/i.test(text)) details.push('חגורה');
  if (/קשירה|tie|bow/i.test(text)) details.push('קשירה');
  
  // כיסים
  if (/כיס|pocket/i.test(text)) details.push('כיסים');
  
  // תחרה ופרטים
  if (/תחרה|lace/i.test(text)) details.push('תחרה');
  if (/פפלום|peplum/i.test(text)) details.push('פפלום');
  if (/מלמלה|ruffle|ראפל/i.test(text)) details.push('מלמלה');
  if (/קפלים|pleat/i.test(text)) details.push('קפלים');
  if (/שסע|slit/i.test(text)) details.push('שסע');
  if (/קומות|tier|tiered/i.test(text)) details.push('קומות');
  if (/כיווצ|shirring|גומי/i.test(text)) details.push('כיווצים');
  if (/תיקתק|snap/i.test(text)) details.push('תיקתק');
  if (/מעטפ|wrap/i.test(text)) details.push('מעטפת');
  
  return details;
}

// ======================================================================
// זיהוי דוגמא/הדפס מכותרת ותיאור
// ======================================================================
function detectPattern(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  
  if (/פסים|striped|stripe/i.test(text)) return 'פסים';
  if (/פרחוני|floral|flower|פרח/i.test(text)) return 'פרחוני';
  if (/משבצות|plaid|check|checkered/i.test(text)) return 'משבצות';
  if (/נקודות|polka|dot|dots/i.test(text)) return 'נקודות';
  if (/הדפס|print|printed/i.test(text)) return 'הדפס';
  if (/אבסטרקט|abstract/i.test(text)) return 'אבסטרקטי';
  if (/גיאומטר|geometric/i.test(text)) return 'גיאומטרי';
  if (/חיות|animal|leopard|zebra|נמר/i.test(text)) return 'חיות';
  
  // חלק - בדיקה מיוחדת: לא "חלק מ..." ולא "חלק עליון" וכו'
  if (/חלק(?!\s*(מ|מן|מה|עליון|תחתון|של|מסט|מהסט|ב|את|מאוד|ניכר))/i.test(text)) return 'חלק';
  
  return '';
}

// ======================================================================
// זיהוי סוג בד מכותרת ותיאור
// ======================================================================
function detectFabric(title, description = '') {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  
  if (/סריג|knit|knitted/i.test(text)) return 'סריג';
  if (/אריג|woven/i.test(text)) return 'אריג';
  if (/ג׳רסי|ג'רסי|jersey/i.test(text)) return 'ג׳רסי';
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
  if (/ג׳ינס|ג'ינס|denim|jeans/i.test(text)) return 'ג׳ינס';
  if (/קורדרוי|corduroy/i.test(text)) return 'קורדרוי';
  if (/כותנה|cotton/i.test(text)) return 'כותנה';
  if (/פשתן|linen/i.test(text)) return 'פשתן';
  if (/משי|silk/i.test(text)) return 'משי';
  if (/צמר|wool/i.test(text)) return 'צמר';
  
  return '';
}

async function getAllProductUrls(page) {
  console.log('\n📂 איסוף קישורים...\n');
  const allUrls = new Set();
  const categories = [
    'https://mekimi.co.il/shop/',
    'https://mekimi.co.il/shop/page/2/',
    'https://mekimi.co.il/shop/page/3/',/*
    'https://mekimi.co.il/shop/page/4/',*/
  ];
  
  for (const url of categories) {
    try {
      console.log(`  → ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }
      const urls = await page.evaluate(() => 
        [...document.querySelectorAll('a[href*="/product/"]')]
          .map(a => a.href)
          .filter(h => h.includes('mekimi.co.il/product/'))
          .filter((v, i, a) => a.indexOf(v) === i)
      );
      urls.forEach(u => allUrls.add(u));
      console.log(`    ✓ ${urls.length}`);
    } catch (e) {
      console.log(`    ✗ error`);
    }
  }
  return [...allUrls];
}

async function scrapeProduct(page, url) {
  const shortUrl = url.split('/product/')[1]?.substring(0, 30) || url;
  console.log(`\n🔍 ${shortUrl}...`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    
    const data = await page.evaluate(() => {
      let title = document.querySelector('h1.product_title, h1')?.innerText?.trim() || '';
      title = title.replace(/\s*W?\d{6,}\s*/gi, '').trim();
      // הסרת קודי מוצר בפורמטים שונים
      title = title.replace(/\s+[A-Z]?\d{3,}\s*$/g, '').trim();
      // הסרת אות S/s בודדת בסוף - גם אם צמודה למילה העברית
      title = title.replace(/S\s*$/gi, '').trim();
      // הסרת אות בודדת A-Z בסוף (אחרי רווח)
      title = title.replace(/\s+[A-Z]\s*$/g, '').trim();
      
      let price = 0;
      let originalPrice = null;
      
      // בדיקת מחיר - כל הפורמטים האפשריים של WooCommerce
      const priceContainer = document.querySelector('p.price');
      if (priceContainer) {
        const html = priceContainer.innerHTML;
        
        // בדיקה אם יש del ו-ins (מבצע)
        const hasDel = priceContainer.querySelector('del');
        const hasIns = priceContainer.querySelector('ins');
        
        if (hasDel && hasIns) {
          // יש מבצע! del = מחיר מקורי, ins = מחיר אחרי הנחה
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
          // אין מבצע - מחיר רגיל
          const regularBdi = priceContainer.querySelector('.woocommerce-Price-amount bdi');
          if (regularBdi) {
            const priceText = regularBdi.textContent.replace(/[^\d.]/g, '');
            if (priceText) price = parseFloat(priceText);
          }
        }
      }
      
      const images = [];
      document.querySelectorAll('.woocommerce-product-gallery__image a').forEach(a => {
        if (a.href && a.href.includes('uploads') && !images.includes(a.href)) images.push(a.href);
      });
      document.querySelectorAll('.woocommerce-product-gallery__image img').forEach(img => {
        const src = img.getAttribute('data-large_image');
        if (src && !images.includes(src)) images.push(src);
      });
      if (images.length === 0) {
        document.querySelectorAll('.woocommerce-product-gallery img, .product-images img').forEach(img => {
          if (img.src && img.src.includes('uploads') && !img.src.includes('-150x') && !images.includes(img.src)) 
            images.push(img.src);
        });
      }
      
      const descEl = document.querySelector('.woocommerce-product-details__short-description');
      const description = descEl ? descEl.innerText.trim() : '';
      
      const rawColors = [];
      const rawSizes = [];
      
      // שיטה 1: חיפוש צבעים ומידות מתוך SELECT
      document.querySelectorAll('select').forEach(select => {
        const name = (select.name || select.id || '').toLowerCase();
        Array.from(select.options).forEach(opt => {
          const val = opt.value?.trim();
          if (!val || val === '' || val.includes('בחירת') || val.includes('choose')) return;
          if (name.includes('color') || name.includes('צבע') || name.includes('pa_color')) {
            if (!rawColors.includes(val)) rawColors.push(val);
          }
          else if (name.includes('size') || name.includes('מידה') || name.includes('pa_size') || name.includes('pa_mydh')) {
            if (!rawSizes.includes(val)) rawSizes.push(val);
          }
        });
      });
      
      // שיטה 2: חיפוש מתוך swatches/buttons של WooCommerce
      document.querySelectorAll('.variable-items-wrapper li, .cfvsw-swatches-container .cfvsw-swatch').forEach(el => {
        const attrName = el.closest('[data-attribute_name]')?.getAttribute('data-attribute_name') || 
                        el.getAttribute('data-attribute_name') || '';
        const val = el.getAttribute('data-value') || el.getAttribute('data-title') || el.getAttribute('title');
        
        if (!val) return;
        
        if (attrName.toLowerCase().includes('color') || attrName.toLowerCase().includes('צבע')) {
          if (!rawColors.includes(val)) rawColors.push(val);
        } else if (attrName.toLowerCase().includes('size') || attrName.toLowerCase().includes('מידה')) {
          if (!rawSizes.includes(val)) rawSizes.push(val);
        }
      });
      
      // שיטה 3: חיפוש ב-variation form
      document.querySelectorAll('.variations tr').forEach(tr => {
        const label = tr.querySelector('label')?.textContent?.toLowerCase() || '';
        const options = tr.querySelectorAll('select option, .variable-item');
        
        options.forEach(opt => {
          const val = opt.value || opt.getAttribute('data-value');
          if (!val || val === '' || val.includes('בחירת')) return;
          
          if (label.includes('צבע') || label.includes('color')) {
            if (!rawColors.includes(val)) rawColors.push(val);
          } else if (label.includes('מידה') || label.includes('size')) {
            if (!rawSizes.includes(val)) rawSizes.push(val);
          }
        });
      });
      
      return { title, price, originalPrice, images, description, rawColors, rawSizes };
    });
    
    if (!data.title) { console.log('  ✗ no title'); return null; }
    
    // זיהוי סגנון, גיזרה וקטגוריה - עכשיו כולל תיאור
    const style = detectStyle(data.title, data.description);
    const fit = detectFit(data.title, data.description);
    const category = detectCategory(data.title);
    const pattern = detectPattern(data.title, data.description);
    const fabric = detectFabric(data.title, data.description);
    const designDetails = detectDesignDetails(data.title, data.description);
    
    // colorSizesMap שומר איזה מידות זמינות לכל צבע
    const colorSizesMap = {};
    const availableSizes = new Set();
    const availableColors = new Set();
    
    console.log(`    Raw colors: ${data.rawColors.join(', ') || 'none'}`);
    console.log(`    Raw sizes: ${data.rawSizes.join(', ') || 'none'}`);
    
    if (data.rawColors.length > 0 && data.rawSizes.length > 0) {
      for (const color of data.rawColors) {
        await page.evaluate((c) => {
          const sel = document.querySelector('select[name*="color"]');
          if (sel) { 
            sel.value = c; 
            sel.dispatchEvent(new Event('change', {bubbles:true})); 
          }
        }, color);
        await page.waitForTimeout(500);
        
        const normColor = normalizeColor(color);
        if (!normColor) {
          console.log(`      ⚠️ צבע לא מזוהה: ${color}`);
          continue;
        }
        
        if (!colorSizesMap[normColor]) {
          colorSizesMap[normColor] = [];
        }
        
        for (const size of data.rawSizes) {
          await page.evaluate((s) => {
            const sel = document.querySelector('select[name*="size"]');
            if (sel) { 
              sel.value = s; 
              sel.dispatchEvent(new Event('change', {bubbles:true})); 
            }
          }, size);
          await page.waitForTimeout(500);
          
          const inStock = await page.evaluate(() => {
            const stockEl = document.querySelector('.woocommerce-variation-availability .stock');
            if (stockEl) {
              const text = stockEl.textContent.toLowerCase();
              if (stockEl.classList.contains('out-of-stock') || text.includes('אזל') || text.includes('out of stock')) return false;
              if (stockEl.classList.contains('in-stock') || text.includes('במלאי') || text.includes('in stock')) return true;
            }
            const btn = document.querySelector('.single_add_to_cart_button');
            if (btn && btn.disabled) return false;
            const variation = document.querySelector('.woocommerce-variation-add-to-cart');
            if (variation?.classList.contains('woocommerce-variation-add-to-cart-disabled')) return false;
            return true;
          });
          
          // normalizeSize מחזיר מערך של מידות אוניברסליות
          const normSizes = normalizeSize(size);
          if (inStock && normSizes.length > 0) {
            for (const normSize of normSizes) {
              availableSizes.add(normSize);
              availableColors.add(normColor);
              if (!colorSizesMap[normColor].includes(normSize)) {
                colorSizesMap[normColor].push(normSize);
              }
            }
            console.log(`      ✓ ${normColor} + ${normSizes.join('/')}`);
          } else if (normSizes.length > 0) {
            console.log(`      ✗ ${normColor} + ${normSizes.join('/')} (אזל)`);
          }
        }
      }
    } else if (data.rawSizes.length > 0) {
      for (const size of data.rawSizes) {
        await page.evaluate((s) => {
          const sel = document.querySelector('select[name*="size"]');
          if (sel) { sel.value = s; sel.dispatchEvent(new Event('change', {bubbles:true})); }
        }, size);
        await page.waitForTimeout(500);
        
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
    console.log(`    📊 colorSizes: ${JSON.stringify(colorSizesMap)}`);
    
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
    console.log(`  ✗ ${err.message.substring(0, 40)}`);
    return null;
  }
}

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
      ['MEKIMI', product.title, product.price || 0, product.originalPrice || null, 
       product.images[0] || '', product.images, product.sizes, product.mainColor, 
       product.colors, product.style || null, product.fit || null, product.category, 
       product.description || null, product.url, JSON.stringify(product.colorSizes),
       product.pattern || null, product.fabric || null, 
       product.designDetails?.length ? product.designDetails : null]
    );
    console.log('  💾 saved');
  } catch (err) {
    console.log(`  ✗ DB: ${err.message.substring(0, 30)}`);
  }
}

const browser = await chromium.launch({ headless: false, slowMo: 30 });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  viewport: { width: 1920, height: 1080 }
});
const page = await context.newPage();

try {
  const urls = await getAllProductUrls(page);
  console.log(`\n${'='.repeat(50)}\n📊 Total: ${urls.length} products\n${'='.repeat(50)}`);
  
  let ok = 0, fail = 0;
  for (let i = 0; i < urls.length; i++) {
    console.log(`\n[${i + 1}/${urls.length}]`);
    const p = await scrapeProduct(page, urls[i]);
    if (p) { await saveProduct(p); ok++; } else fail++;
    await page.waitForTimeout(500);
  }
  
  console.log(`\n${'='.repeat(50)}\n🏁 Done: ✅ ${ok} | ❌ ${fail}\n${'='.repeat(50)}`);
  
  // בדיקת בריאות הנתונים
  await runHealthCheck(ok, fail);
  
} finally {
  await browser.close();
  await db.end();
}

// פונקציית בדיקת בריאות
async function runHealthCheck(scraped, failed) {
  console.log('\n🔍 בודק תקינות נתונים...');
  
  const problems = [];
  
  // 1. צבעים לא מזוהים
  if (unknownColors.size > 0) {
    problems.push(`⚠️ צבעים לא מזוהים (${unknownColors.size}): ${[...unknownColors].join(', ')}`);
  }
  
  // 2. מוצרים בלי צבע ראשי
  const missingColor = await db.query(`SELECT COUNT(*) as c FROM products WHERE color IS NULL OR color = ''`);
  if (parseInt(missingColor.rows[0].c) > 0) {
    problems.push(`⚠️ מוצרים בלי צבע ראשי: ${missingColor.rows[0].c}`);
  }
  
  // 3. מוצרים בלי תמונות
  const missingImages = await db.query(`SELECT COUNT(*) as c FROM products WHERE (images IS NULL OR array_length(images, 1) = 0) AND (image_url IS NULL OR image_url = '')`);
  if (parseInt(missingImages.rows[0].c) > 0) {
    problems.push(`⚠️ מוצרים בלי תמונות: ${missingImages.rows[0].c}`);
  }
  
  // 4. מוצרים בלי מידות
  const missingSizes = await db.query(`SELECT COUNT(*) as c FROM products WHERE sizes IS NULL OR array_length(sizes, 1) = 0`);
  if (parseInt(missingSizes.rows[0].c) > 0) {
    problems.push(`⚠️ מוצרים בלי מידות: ${missingSizes.rows[0].c}`);
  }
  
  // 5. אחוז כשלונות גבוה
  const failRate = failed / (scraped + failed) * 100;
  if (failRate > 10) {
    problems.push(`⚠️ אחוז כשלונות גבוה: ${failRate.toFixed(1)}%`);
  }
  
  // אם יש בעיות - הצג בקונסול
  if (problems.length > 0) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🚨 נמצאו ${problems.length} בעיות!`);
    console.log('='.repeat(50));
    problems.forEach(p => console.log('   ' + p));
    console.log('\n💡 המלצות:');
    console.log('   - צבעים לא מזוהים: הוסף אותם ל-colorMap בסקרייפר');
    console.log('   - מוצרים בלי נתונים: בדוק את האתר המקורי');
    console.log('='.repeat(50));
  } else {
    console.log('\n✅ הכל תקין! אין בעיות.');
  }
}