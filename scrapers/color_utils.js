/**
 * color_utils.js — מודול זיהוי צבעים משותף לכל הסקרפרים
 *
 * שימוש:
 *   import { normalizeColor, rgbToHebrew } from './color_utils.js';
 *
 * כולל:
 *  - מיפוי שמות צבע (אנגלית/עברית) → עברית מנורמלת
 *  - זיהוי RGB/HEX → צבע עברי קרוב ביותר
 *  - לוג אוטומטי של צבעים לא מזוהים
 */

// ─── מפת שמות צבע ────────────────────────────────────────
export const colorMap = {
  // שחור
  'black':'שחור','שחור':'שחור','jet':'שחור','ebony':'שחור','onyx':'שחור',
  'charcoal':'שחור','graphite':'שחור','coal':'שחור','midnight':'שחור',
  // לבן
  'white':'לבן','לבן':'לבן','snow':'לבן','ivory':'שמנת','pearl':'שמנת',
  'optical white':'לבן','optical-white':'לבן','opticalwhite':'לבן',
  // שמנת
  'cream':'שמנת','שמנת':'שמנת','ecru':'שמנת','off-white':'שמנת',
  'offwhite':'שמנת','vanilla':'שמנת','champagne':'שמנת',
  // כחול
  'blue':'כחול','כחול':'כחול','navy':'נייבי','נייבי':'נייבי',
  'royal':'כחול','cobalt':'כחול','denim':'כחול','indigo':'כחול',
  'sapphire':'כחול','azure':'תכלת','sky':'תכלת','baby blue':'תכלת',
  'cornflower':'תכלת','periwinkle':'לילך','slate':'אפור',
  // תכלת
  'תכלת':'תכלת','turquoise':'תכלת','aqua':'תכלת','cyan':'תכלת',
  'light blue':'תכלת','powder blue':'תכלת',
  // אדום
  'red':'אדום','אדום':'אדום','scarlet':'אדום','crimson':'בורדו',
  'ruby':'בורדו','cardinal':'אדום','tomato':'אדום','fire':'אדום',
  // בורדו
  'burgundy':'בורדו','בורדו':'בורדו','wine':'בורדו','maroon':'בורדו',
  'merlot':'בורדו','oxblood':'בורדו','bordeaux':'בורדו','claret':'בורדו',
  // ירוק
  'green':'ירוק','ירוק':'ירוק','olive':'זית','זית':'זית',
  'khaki':'חאקי','חאקי':'חאקי','snake':'ירוק','emerald':'ירוק',
  'forest':'ירוק','sage':'ירוק','teal':'ירוק','army':'חאקי',
  'hunter':'ירוק','mint':'מנטה','מנטה':'מנטה','pistachio':'מנטה',
  'lime':'ירוק','basil':'ירוק','eucalyptus':'ירוק','fern':'ירוק',
  'jungle':'ירוק','moss':'זית','darkgreen':'ירוק','dark-green':'ירוק',
  'olive-green':'זית','military':'חאקי',
  // חום
  'brown':'חום','חום':'חום','tan':'קאמל','chocolate':'חום',
  'coffee':'חום','קפה':'חום','mocha':'חום','espresso':'חום',
  'chestnut':'חום','caramel':'קאמל','cinnamon':'חום','walnut':'חום',
  'toffee':'קאמל','russet':'חום','sienna':'חום','umber':'חום',
  // קאמל
  'camel':'קאמל','קאמל':'קאמל','sand':'בז׳','wheat':'בז׳',
  'honey':'קאמל','amber':'קאמל','hazel':'קאמל','cognac':'קאמל',
  // בז
  'beige':'בז׳','בז':'בז׳','בז׳':'בז׳','linen':'בז׳','taupe':'בז׳',
  'oat':'בז׳','oatmeal':'בז׳','parchment':'בז׳','natural':'בז׳',
  'mushroom':'בז׳','latte':'בז׳','almond':'בז׳','biscuit':'בז׳',
  // ניוד
  'nude':'ניוד','ניוד':'ניוד','nude-rose':'ניוד','blush nude':'ניוד',
  'skin':'ניוד','flesh':'ניוד','porcelain':'ניוד','nude pink':'ניוד',
  // אפור
  'gray':'אפור','grey':'אפור','אפור':'אפור','silver':'כסף',
  'ash':'אפור','smoke':'אפור','stone':'אבן','אבן':'אבן',
  'slate grey':'אפור','light gray':'אפור','dark gray':'אפור',
  'steel':'אפור','pewter':'אפור','dove':'אפור','marengo':'אפור',
  'heather':'אפור','pebble':'אבן','granite':'אפור','flint':'אפור',
  // ורוד
  'pink':'ורוד','ורוד':'ורוד','rose':'ורוד','blush':'ורוד',
  'dusty rose':'ורוד','bubblegum':'ורוד','hot pink':'ורוד','fuchsia':'ורוד',
  'magenta':'ורוד','salmon':'אפרסק','coral':'כתום','petal':'ורוד',
  'mauve':'לילך','ballet':'ורוד','powder pink':'ורוד','rosy':'ורוד',
  // סגול
  'purple':'סגול','סגול':'סגול','violet':'סגול','plum':'סגול',
  'grape':'סגול','aubergine':'סגול','eggplant':'סגול','lavender':'לילך',
  'orchid':'לילך','amethyst':'סגול','mulberry':'בורדו',
  // לילך
  'lilac':'לילך','לילך':'לילך','light purple':'לילך','wisteria':'לילך',
  'thistle':'לילך','periwinkle':'לילך','iris':'לילך',
  // צהוב
  'yellow':'צהוב','צהוב':'צהוב','lemon':'צהוב','sunshine':'צהוב',
  'canary':'צהוב','gold':'זהב','golden':'זהב','זהב':'זהב',
  // חרדל
  'mustard':'חרדל','חרדל':'חרדל','turmeric':'חרדל','curry':'חרדל',
  'ochre':'חרדל','saffron':'חרדל','golden yellow':'חרדל',
  // כתום
  'orange':'כתום','כתום':'כתום','tangerine':'כתום','pumpkin':'כתום',
  'rust':'כתום','terracotta':'כתום','burnt orange':'כתום','paprika':'כתום',
  'apricot':'אפרסק','peach':'אפרסק','אפרסק':'אפרסק',
  // כסף
  'silver':'כסף','כסף':'כסף','metallic':'כסף','chrome':'כסף',
  // פרחוני/עיצוב
  'floral':'פרחוני','פרחוני':'פרחוני','flower':'פרחוני','flowers':'פרחוני',
  'botanical':'פרחוני','bloom':'פרחוני','bouquet':'פרחוני','daisy':'פרחוני',
  // נקודות → שחור (רקע שחור עם נקודות)
  'dots':'שחור','polka':'שחור','dotted':'שחור','spotted':'שחור',
  // פסים → כחול/שחור (בד"כ)
  'stripes':'כחול','striped':'כחול','stripe':'כחול',
  // פסקייה/animal
  'leopard':'חום','zebra':'שחור','animal':'חום',
  // ניטרלים
  'multicolor':'צבעוני','multi':'צבעוני','צבעוני':'צבעוני','colorful':'צבעוני',
  'print':'צבעוני','printed':'צבעוני',
};

// ─── RGB של הצבעים העבריים (לזיהוי לפי ערכי צבע) ─────────
const hebrewColorRGB = [
  { name:'שחור',   rgb:[0,0,0] },
  { name:'לבן',    rgb:[255,255,255] },
  { name:'שמנת',   rgb:[255,253,208] },
  { name:'כחול',   rgb:[37,99,235] },
  { name:'תכלת',   rgb:[56,189,248] },
  { name:'נייבי',  rgb:[30,58,95] },
  { name:'אדום',   rgb:[220,38,38] },
  { name:'בורדו',  rgb:[128,0,32] },
  { name:'ירוק',   rgb:[22,163,74] },
  { name:'זית',    rgb:[85,107,47] },
  { name:'חאקי',   rgb:[139,139,0] },
  { name:'חום',    rgb:[146,64,14] },
  { name:'קאמל',   rgb:[193,154,107] },
  { name:'בז׳',    rgb:[212,184,150] },
  { name:'ניוד',   rgb:[232,190,172] },
  { name:'אפור',   rgb:[107,114,128] },
  { name:'אבן',    rgb:[197,185,168] },
  { name:'ורוד',   rgb:[236,72,153] },
  { name:'סגול',   rgb:[124,58,237] },
  { name:'לילך',   rgb:[200,162,200] },
  { name:'צהוב',   rgb:[250,204,21] },
  { name:'חרדל',   rgb:[255,219,88] },
  { name:'כתום',   rgb:[234,88,12] },
  { name:'אפרסק',  rgb:[255,203,164] },
  { name:'זהב',    rgb:[212,175,55] },
  { name:'כסף',    rgb:[192,192,192] },
  { name:'מנטה',   rgb:[152,255,211] },
];

/**
 * המרת HEX לRGB
 * קלט: "#e0a1c0" או "e0a1c0" או "rgb(224,161,192)"
 * פלט: [r, g, b] או null
 */
export function hexToRgb(hex) {
  if (!hex) return null;
  hex = hex.trim();
  // rgb(r,g,b)
  const rgbMatch = hex.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
  if (rgbMatch) return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  // hex
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(x=>x+x).join('');
  if (hex.length !== 6) return null;
  return [
    parseInt(hex.slice(0,2), 16),
    parseInt(hex.slice(2,4), 16),
    parseInt(hex.slice(4,6), 16)
  ];
}

/**
 * מציאת הצבע העברי הקרוב ביותר לפי RGB
 * משתמש במרחק אוקלידי במרחב RGB עם משקלים לעין האנושית
 */
export function rgbToHebrew(r, g, b) {
  let minDist = Infinity;
  let closest = 'אחר';
  for (const c of hebrewColorRGB) {
    const [cr, cg, cb] = c.rgb;
    // משקלים שמדמים את רגישות העין האנושית
    const dist = Math.sqrt(
      2.0 * Math.pow(r-cr, 2) +
      4.0 * Math.pow(g-cg, 2) +
      3.0 * Math.pow(b-cb, 2)
    );
    if (dist < minDist) { minDist = dist; closest = c.name; }
  }
  return closest;
}

// ─── Set לאיסוף צבעים לא מזוהים (לדיווח בסוף) ────────────
export const unknownColors = new Set();

/**
 * נרמול צבע — הפונקציה המרכזית
 * מחזירה שם עברי מנורמל, או null אם לא מזוהה ואין RGB
 *
 * @param {string} colorInput  — שם הצבע מהחנות (כל שפה)
 * @param {string} [hexInput]  — ערך HEX/RGB אם קיים (אופציונלי)
 * @returns {string|null}
 */
export function normalizeColor(colorInput, hexInput = null) {
  if (!colorInput && !hexInput) return null;

  // ─── שלב 1: ניסיון לפי שם ───────────────────────────
  if (colorInput) {
    const original = colorInput;
    const lower = colorInput.toLowerCase().trim();
    const noSpaces = lower.replace(/[-_\s/]/g, '');

    if (colorMap[noSpaces]) return colorMap[noSpaces];
    if (colorMap[lower]) return colorMap[lower];

    // מילה-מילה
    for (const word of lower.split(/[\s\-_/]+/)) {
      if (colorMap[word]) return colorMap[word];
    }

    // חיפוש חלקי (key בתוך הקלט)
    for (const [key, val] of Object.entries(colorMap)) {
      if (lower.includes(key)) return val;
    }

    // ─── שלב 2: ניסיון לפי HEX ────────────────────────
    // בדוק אם הקלט עצמו נראה כמו HEX
    const hexSelf = hexToRgb(lower);
    if (hexSelf) {
      const guessed = rgbToHebrew(...hexSelf);
      console.log(`  🎨 צבע HEX לא מזוהה "${original}" → RGB(${hexSelf}) → "${guessed}"`);
      unknownColors.add(`${original} → ${guessed}`);
      return guessed;
    }
  }

  // ─── שלב 3: HEX נפרד ─────────────────────────────────
  if (hexInput) {
    const rgb = hexToRgb(hexInput);
    if (rgb) {
      const guessed = rgbToHebrew(...rgb);
      const label = colorInput || hexInput;
      console.log(`  🎨 צבע HEX "${label}" (${hexInput}) → RGB(${rgb}) → "${guessed}"`);
      unknownColors.add(`${label} [${hexInput}] → ${guessed}`);
      return guessed;
    }
  }

  // ─── שלב 4: לא מזוהה כלל ─────────────────────────────
  unknownColors.add(colorInput || hexInput || '?');
  return null;
}

/**
 * הדפסת דוח צבעים לא מזוהים — קרא בסוף הסקרפר
 */
export function reportUnknownColors() {
  if (unknownColors.size === 0) return;
  console.log(`\n⚠️  צבעים לא מזוהים (${unknownColors.size}):`);
  for (const c of unknownColors) {
    console.log(`   • ${c}`);
  }
  console.log('   → הוסף אותם ל-colorMap ב-color_utils.js\n');
}
