/**
 * scraper_utils.js — כלי עזר משותף לכל הסקרייפרים
 * טוען colorMap + detect functions מה-DB (scraper_config)
 * עם fallback ל-hardcoded אם הטבלה ריקה
 */

// ============================================================
// ברירות מחדל (fallback אם אין נתונים ב-DB)
// ============================================================
const DEFAULT_COLORS = {
  'שחור':['שחור','שחורה','black'],'לבן':['לבן','לבנה','white'],
  'כחול':['כחול','כחולה','נייבי','navy','blue','indigo','denim'],
  'אדום':['אדום','אדומה','red','scarlet','crimson'],
  'ירוק':['ירוק','ירוקה','זית','חאקי','green','olive','khaki','sage','teal','army','hunter','דשא'],
  'חום':['חום','חומה','brown','chocolate','coffee','קפה','mocha','espresso'],
  'קאמל':['קאמל','camel','cognac'],
  "בז'":["בז'","בז",'nude','ניוד','beige','sand','taupe'],
  'אפור':['אפור','אפורה','gray','grey','charcoal','slate','ash'],
  'ורוד':['ורוד','ורודה','pink','coral','קורל','blush','rose','fuchsia','magenta','salmon','בייבי','פודרה','powder'],
  'בורדו':['בורדו','burgundy','wine','maroon','cherry','bordo'],
  'שמנת':['שמנת','cream','ivory','offwhite','off-white','stone','bone','ecru','vanilla'],
  'סגול':['סגול','סגולה','לילך','purple','lilac','lavender','violet','plum','mauve','שזיף'],
  'צהוב':['צהוב','צהובה','חרדל','yellow','mustard','gold','lemon','בננה','banana'],
  'כתום':['כתום','כתומה','orange','rust','tangerine'],
  'זהב':['זהב','golden'],'כסף':['כסף','כסוף','silver'],
  'תכלת':['תכלת','טורקיז','turquoise','aqua','cyan','sky'],
  'מנטה':['מנטה','mint','menta'],
  'אפרסק':['אפרסק','peach','apricot'],
  'אבן':['אבן'],'צבעוני':['צבעוני','מולטי','multi','multicolor','ססגוני'],
};

const DEFAULT_CATEGORIES = {
  'שמלה':['שמלה','שמלת','dress'],'חולצה':['חולצה','חולצת','טופ','top','shirt','blouse'],
  'חצאית':['חצאית','skirt'],'קרדיגן':['קרדיגן','cardigan'],'סוודר':['סוודר','sweater'],
  'טוניקה':['טוניקה','tunic'],'סרפן':['סרפן','pinafore'],
  "ז׳קט":["ז׳קט","ג׳קט",'jacket'],'בלייזר':['בלייזר','blazer'],
  'וסט':['וסט','vest'],'עליונית':['עליונית','שכמיה','cape'],
  'מעיל':['מעיל','coat'],'אוברול':['אוברול','jumpsuit'],
  'סט':['סט','set'],'בייסיק':['בייסיק','basic'],'חלוק':['חלוק','robe'],
};

const DEFAULT_STYLES = {
  'ערב':['ערב','שבת','שבתי','אירוע','חגיגי','אלגנט','elegant'],
  'יום חול':['יומיומי','יומיומית','קז׳ואל','casual'],
  'חגיגי':['חגיגי','חגיגית'],'אלגנטי':['אלגנט','אלגנטי'],
  'קלאסי':['קלאסי','קלאסית'],'מינימליסטי':['מינימליסט','מינימליסטי'],
  'מודרני':['מודרני','מודרנית'],'רטרו':['רטרו',"וינטג׳"],
  'אוברסייז':['אוברסייז','oversize'],
};

const DEFAULT_FITS = {
  'ארוכה':['מקסי','ארוכה','ארוך','maxi'],'מידי':['מידי','midi','אמצע'],
  'קצרה':['קצרה','קצר','מיני','mini'],'מעטפת':['מעטפת','wrap'],
  'צמודה':['צמוד','צמודה','fitted','bodycon'],'ישרה':['ישרה','straight'],
  'מתרחבת':['מתרחב','מתרחבת','flare'],'אוברסייז':['אוברסייז','oversize'],
  'הריון':['הריון','maternity'],'הנקה':['הנקה','nursing'],
};

const DEFAULT_FABRICS = {
  'סריג':['סריג','knit'],"ג׳רסי":["ג׳רסי",'גרסי','jersey'],
  'שיפון':['שיפון','chiffon'],'קרפ':['קרפ','crepe'],
  'סאטן':['סאטן','satin','סטן'],'קטיפה':['קטיפה','velvet'],
  'פליז':['פליז','fleece'],'תחרה':['תחרה','lace'],'טול':['טול','tulle'],
  'לייקרה':['לייקרה','lycra'],'כותנה':['כותנה','cotton'],
  'פשתן':['פשתן','linen'],'משי':['משי','silk'],'צמר':['צמר','wool'],
  'ריקמה':['ריקמה','רקומה','embroidery'],
};

const DEFAULT_PATTERNS = {
  'פסים':['פסים','stripes'],'פרחוני':['פרחוני','פרחים','floral'],
  'משבצות':['משבצות','plaid','check'],'נקודות':['נקודות','dots','polka'],
  'חלק':['חלק','plain','solid'],'הדפס':['הדפס','print','מודפס'],
};

const SKIP_KEYWORDS = [
  'עגיל','עגילי','שרשרת','צמיד','טבעת','תכשיט',
  'כובע','צעיף','תיק','ארנק','משקפיים','גומייה','מטפחת','קשת','שעון','שיער','גרבי',
];

// ============================================================
// טעינה מ-DB
// ============================================================
export async function loadScraperConfig(db) {
  let colorMap = {...DEFAULT_COLORS};
  let categoryMap = {...DEFAULT_CATEGORIES};
  let styleMap = {...DEFAULT_STYLES};
  let fitMap = {...DEFAULT_FITS};
  let fabricMap = {...DEFAULT_FABRICS};
  let patternMap = {...DEFAULT_PATTERNS};

  try {
    const r = await db.query(`SELECT type, name, aliases FROM scraper_config ORDER BY type, name`);
    if (r.rows.length > 0) {
      // אפס מפות ובנה מחדש מה-DB
      const maps = { color:{}, category:{}, style:{}, fit:{}, fabric:{}, pattern:{} };
      r.rows.forEach(row => {
        if (maps[row.type] !== undefined) {
          maps[row.type][row.name] = row.aliases || [];
        }
      });
      if (Object.keys(maps.color).length > 0)    colorMap    = maps.color;
      if (Object.keys(maps.category).length > 0) categoryMap = maps.category;
      if (Object.keys(maps.style).length > 0)    styleMap    = maps.style;
      if (Object.keys(maps.fit).length > 0)      fitMap      = maps.fit;
      if (Object.keys(maps.fabric).length > 0)   fabricMap   = maps.fabric;
      if (Object.keys(maps.pattern).length > 0)  patternMap  = maps.pattern;
      console.log(`✅ scraper_config נטען מ-DB: ${r.rows.length} הגדרות`);
    } else {
      console.log('⚠️ scraper_config ריק — משתמש בברירות מחדל');
    }
  } catch(e) {
    console.log(`⚠️ לא הצלחתי לטעון scraper_config: ${e.message} — משתמש בברירות מחדל`);
  }

  // בנה lookups הפוכים (alias → name) לחיפוש מהיר
  const colorLookup = buildLookup(colorMap);
  const categoryLookup = buildLookup(categoryMap);
  const styleLookup = buildLookup(styleMap);
  const fitLookup = buildLookup(fitMap);
  const fabricLookup = buildLookup(fabricMap);
  const patternLookup = buildLookup(patternMap);

  const unknownColors = new Set();

  function buildLookup(map) {
    const lookup = {};
    for (const [name, aliases] of Object.entries(map)) {
      lookup[name.toLowerCase()] = name;
      for (const alias of aliases) {
        lookup[alias.toLowerCase().replace(/[-_\s]/g,'')] = name;
        lookup[alias.toLowerCase()] = name;
      }
    }
    return lookup;
  }

  function normalizeWithLookup(val, lookup, unknowns) {
    if (!val) return null;
    const lower = val.toLowerCase().trim();
    const noSpaces = lower.replace(/[-_\s]/g, '');
    if (lookup[noSpaces]) return lookup[noSpaces];
    if (lookup[lower]) return lookup[lower];
    const words = lower.split(/[\s\-]+/);
    for (const w of words) { if (lookup[w]) return lookup[w]; }
    for (const key of Object.keys(lookup)) {
      if (lower.includes(key) || key.includes(lower)) return lookup[key];
    }
    if (unknowns) unknowns.add(val);
    return null;
  }

  return {
    normalizeColor: (c) => normalizeWithLookup(c, colorLookup, unknownColors) || 'אחר',
    unknownColors,

    shouldSkip(title) {
      if (!title) return false;
      const t = title.toLowerCase().trim();
      return SKIP_KEYWORDS.some(k => {
        const kl = k.toLowerCase();
        if (kl.includes(' ')) return t.includes(kl);
        const idx = t.indexOf(kl);
        if (idx === -1) return false;
        const before = idx === 0 || /[\s,\-–\/״"()]/.test(t[idx-1]);
        const after = idx+kl.length === t.length || /[\s,\-–\/״"().!?]/.test(t[idx+kl.length]);
        return before && after;
      });
    },

    detectCategory(title) {
      if (!title) return null;
      const t = title.toLowerCase();
      for (const [name, aliases] of Object.entries(categoryMap)) {
        if (aliases.some(a => t.includes(a.toLowerCase()))) return name;
      }
      return null;
    },

    detectStyle(title, description='') {
      const text = ((title||'')+' '+(description||'')).toLowerCase();
      for (const [name, aliases] of Object.entries(styleMap)) {
        if (aliases.some(a => text.includes(a.toLowerCase()))) return name;
      }
      return '';
    },

    detectFit(title, description='') {
      const text = ((title||'')+' '+(description||'')).toLowerCase();
      for (const [name, aliases] of Object.entries(fitMap)) {
        if (aliases.some(a => text.includes(a.toLowerCase()))) return name;
      }
      return '';
    },

    detectFabric(title, description='') {
      const text = ((title||'')+' '+(description||'')).toLowerCase();
      for (const [name, aliases] of Object.entries(fabricMap)) {
        if (aliases.some(a => text.includes(a.toLowerCase()))) return name;
      }
      return '';
    },

    detectPattern(title, description='') {
      const text = ((title||'')+' '+(description||'')).toLowerCase();
      for (const [name, aliases] of Object.entries(patternMap)) {
        if (aliases.some(a => text.includes(a.toLowerCase()))) return name;
      }
      return '';
    },

    detectDesignDetails(title, description='') {
      const text = ((title||'')+' '+(description||'')).toLowerCase();
      const details = [];
      if (/צווארון\s*וי|v.?neck/i.test(text)) details.push('צווארון V');
      if (/צווארון\s*עגול|round.?neck|crew.?neck/i.test(text)) details.push('צווארון עגול');
      if (/גולף|turtle.?neck/i.test(text)) details.push('גולף');
      if (/סטרפלס|strapless/i.test(text)) details.push('סטרפלס');
      if (/כתפיי?ה|off.?shoulder/i.test(text)) details.push('חשוף כתפיים');
      if (/שרוול\s*ארוך|long.?sleeve/i.test(text)) details.push('שרוול ארוך');
      if (/שרוול\s*קצר|short.?sleeve/i.test(text)) details.push('שרוול קצר');
      if (/3\/4|שרוול\s*3/i.test(text)) details.push('שרוול 3/4');
      if (/ללא\s*שרוול|sleeveless/i.test(text)) details.push('ללא שרוולים');
      if (/שרוול\s*פעמון|bell.?sleeve/i.test(text)) details.push('שרוול פעמון');
      if (/שרוול\s*נפוח|puff.?sleeve/i.test(text)) details.push('שרוול נפוח');
      if (/כפתור|button/i.test(text)) details.push('כפתורים');
      if (/רוכסן|zipper/i.test(text)) details.push('רוכסן');
      if (/חגורה|belt/i.test(text)) details.push('חגורה');
      if (/קשירה|tie|bow/i.test(text)) details.push('קשירה');
      if (/כיס|pocket/i.test(text)) details.push('כיסים');
      if (/שסע|slit/i.test(text)) details.push('שסע');
      if (/פפלום|peplum/i.test(text)) details.push('פפלום');
      if (/שכבות|layer/i.test(text)) details.push('שכבות');
      return details;
    },
  };
}
