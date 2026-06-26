/**
 * scraper_utils.js — כלי עזר משותף לכל הסקרייפרים
 * טוען colorMap + detect functions מה-DB (scraper_config)
 * עם fallback ל-hardcoded אם הטבלה ריקה
 */

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
  "ג'ינס":["ג'ינס","ג׳ינס","ג\u05F3ינס",'גינס','denim','jeans'],
};

const DEFAULT_PATTERNS = {
  'פסים':['פסים','stripes'],'פרחוני':['פרחוני','פרחים','floral'],
  'משבצות':['משבצות','plaid','check'],'נקודות':['נקודות','dots','polka'],
  'חלק':['חלק','plain','solid'],'הדפס':['הדפס','print','מודפס'],
};

const SKIP_KEYWORDS = [
  'עגיל','עגילי','שרשרת','צמיד','טבעת','תכשיט',
  'כובע','צעיף','תיק','ארנק','משקפיים','גומייה','מטפחת','קשת','שעון','שיער','גרבי',
  'בגד ים','בגדי ים','xxxxxx','xxxxxx','swimwear','swimsuit',
  'כרטיס','gift card','voucher',
];

// derived_tags maps — מאוכלסים בטעינה מה-DB
let fabricDerived = {}, patternDerived = {}, categoryDerived = {}, colorDerived = {};

export async function loadScraperConfig(db) {
  let colorMap = {...DEFAULT_COLORS};
  let categoryMap = {...DEFAULT_CATEGORIES};
  let styleMap = {...DEFAULT_STYLES};
  let fitMap = {...DEFAULT_FITS};
  let fabricMap = {...DEFAULT_FABRICS};
  let patternMap = {...DEFAULT_PATTERNS};

  try {
    const r = await db.query(`SELECT type, name, aliases, derived_tags FROM scraper_config ORDER BY type, name`);
    if (r.rows.length > 0) {
      const maps = { color:{}, category:{}, style:{}, fit:{}, fabric:{}, pattern:{} };
      // derived_tags: { type: { name: { field: [values] } } }
      const derivedMaps = { color:{}, category:{}, style:{}, fit:{}, fabric:{}, pattern:{} };
      r.rows.forEach(row => {
        if (maps[row.type] !== undefined) {
          maps[row.type][row.name] = row.aliases || [];
          if (row.derived_tags && Object.keys(row.derived_tags).length) {
            derivedMaps[row.type][row.name] = row.derived_tags;
          }
        }
      });
      colorMap    = { ...DEFAULT_COLORS,    ...maps.color    };
      categoryMap = { ...DEFAULT_CATEGORIES,...maps.category };
      styleMap    = { ...DEFAULT_STYLES,    ...maps.style    };
      fitMap      = { ...DEFAULT_FITS,      ...maps.fit      };
      fabricMap   = { ...DEFAULT_FABRICS,   ...maps.fabric   };
      patternMap  = { ...DEFAULT_PATTERNS,  ...maps.pattern  };
      fabricDerived   = derivedMaps.fabric   || {};
      patternDerived  = derivedMaps.pattern  || {};
      categoryDerived = derivedMaps.category || {};
      colorDerived    = derivedMaps.color    || {};
      console.log(`✅ scraper_config נטען מ-DB: ${r.rows.length} הגדרות (ממוזג עם ברירות מחדל)`);
    } else {
      console.log('⚠️ scraper_config ריק — משתמש בברירות מחדל');
    }
  } catch(e) {
    console.log(`⚠️ לא הצלחתי לטעון scraper_config: ${e.message} — משתמש בברירות מחדל`);
  }

  const colorLookup    = buildLookup(colorMap);
  const categoryLookup = buildLookup(categoryMap);
  const styleLookup    = buildLookup(styleMap);
  const fitLookup      = buildLookup(fitMap);
  const fabricLookup   = buildLookup(fabricMap);
  const patternLookup  = buildLookup(patternMap);

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
    // הסר אות יחס (ל/ב/מ/ש/כ) מהתחלה ונסה שוב
    if (/^[לבמשכ][\u05d0-\u05ea]/.test(lower) && lower.length > 2) {
      const stripped = lower.slice(1);
      const strippedNoSpaces = stripped.replace(/[-_\s]/g, '');
      if (lookup[strippedNoSpaces]) return lookup[strippedNoSpaces];
      if (lookup[stripped]) return lookup[stripped];
    }
    const words = lower.split(/[\s\-]+/);
    for (const w of words) { if (lookup[w]) return lookup[w]; }
    for (const key of Object.keys(lookup)) {
      // "סט" — התאמה מדויקת בלבד (מניעת "פסטל" → "סט")
      if (key === 'סט' || key === 'set') {
        const keyRegex = new RegExp(`(^|[\\s\\-,\\/])${key}($|[\\s\\-,\\/])`, 'i');
        if (keyRegex.test(lower)) return lookup[key];
        continue;
      }
      if (lower.includes(key) || key.includes(lower)) return lookup[key];
    }
    if (unknowns) unknowns.add(val);
    return null;
  }
  return {
    normalizeColor(c, title) {
      const JEANS_WORDS = ["ג'ינס","ג׳ינס","ג\u05F3ינס",'גינס','denim','jeans'];
      const result = normalizeWithLookup(c, colorLookup, unknownColors);
      if (result) return result;
      const t = (title || c || '').toLowerCase();
      const hasJeans = JEANS_WORDS.some(w => t.includes(w.toLowerCase()));
      if (!hasJeans) { unknownColors.add(c); return 'אחר'; }
      const withoutJeans = JEANS_WORDS.reduce((s,w) => s.replace(new RegExp(w.replace(/'/g,"['']"),'gi'),''), t).trim();
      const otherColor = normalizeWithLookup(withoutJeans, colorLookup, null);
      if (otherColor && otherColor !== 'אחר') return otherColor;
      const jeansColorName = colorLookup["גינס"] || colorLookup["ג'ינס"] || colorLookup['jeans'] || colorLookup['denim'] || 'כחול';
      return jeansColorName;
    },

    normalizeColorFromTitle(title) {
      if (!title) return null;
      const JEANS_WORDS = ["ג'ינס","ג׳ינס","ג\u05F3ינס",'גינס','denim','jeans'];
      const lower = title.toLowerCase();

      // בדוק ג׳ינס קודם — הוא בד שמצביע על צבע כחול
      if (JEANS_WORDS.some(w => lower.includes(w.toLowerCase()))) return 'כחול';

      const words = lower.split(/[\s\-,\/]+/);
      for (const word of words) {
        if (!word || word.length < 2) continue;
        const result = normalizeWithLookup(word, colorLookup, null);
        if (result) return result;
      }
      for (let i = 0; i < words.length - 1; i++) {
        const pair = words[i] + ' ' + words[i+1];
        const result = normalizeWithLookup(pair, colorLookup, null);
        if (result) return result;
      }
      return null;
    },

    unknownColors,

    // אם יש derived_tags על הצבע (למשל "אדום" → style: "בולט"), מחזיר אותם
    getColorDerivedStyle(colorName) {
      const derived = colorDerived[colorName] || {};
      return { derivedStyle: derived.style?.[0] || null, derivedStyles: derived.style || [] };
    },

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

    // אם יש derived_tags על סוג הבד (למשל "סאטן" → style: "אלגנטי"), מחזיר אותם
    getFabricDerivedStyle(fabricName) {
      const derived = fabricDerived[fabricName] || {};
      return { derivedStyle: derived.style?.[0] || null, derivedStyles: derived.style || [] };
    },

    detectPattern(title, description='') {
      const text = ((title||'')+' '+(description||'')).toLowerCase();
      for (const [name, aliases] of Object.entries(patternMap)) {
        if (aliases.some(a => text.includes(a.toLowerCase()))) return name;
      }
      return '';
    },

    // אם יש derived_tags על הדוגמה (למשל "פרחוני" → style: "רומנטי"), מחזיר אותם
    getPatternDerivedStyle(patternName) {
      const derived = patternDerived[patternName] || {};
      return { derivedStyle: derived.style?.[0] || null, derivedStyles: derived.style || [] };
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

    // ── מנגנון הסתרת מוצרים שלא נמצאים יותר באתר ──────────────────────
    // קוראים בסוף כל סקרייפר: await reportScraperFinished(db, 'STORE_NAME', foundUrls)
    // - מוצרים שנמצאו: not_seen_count=0, hidden_stale=false (חזרו לחיים)
    // - מוצרים שלא נמצאו: not_seen_count++, ואם הגיע ל-3 → hidden_stale=true (מוסתר, לא נמחק)
    async reportScraperFinished(dbClient, store, foundUrls) {
      try {
        await dbClient.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS not_seen_count INTEGER DEFAULT 0`).catch(()=>{});
        await dbClient.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS hidden_stale BOOLEAN DEFAULT false`).catch(()=>{});

        if (foundUrls.length > 0) {
          await dbClient.query(
            `UPDATE products SET not_seen_count = 0, hidden_stale = false
             WHERE store = $1 AND source_url = ANY($2::text[])`,
            [store, foundUrls]
          );
        }

        const result = await dbClient.query(
          `UPDATE products
           SET not_seen_count = not_seen_count + 1,
               hidden_stale = (not_seen_count + 1) >= 3
           WHERE store = $1
             AND NOT (source_url = ANY($2::text[]))
             AND (banned IS NULL OR banned = false)
           RETURNING id, not_seen_count, hidden_stale`,
          [store, foundUrls]
        );

        const newlyHidden = result.rows.filter(r => r.hidden_stale && r.not_seen_count === 3).length;
        if (newlyHidden > 0) {
          console.log(`  🙈 ${newlyHidden} מוצרים הוסתרו (3 הרצות רצופות לא נמצאו)`);
        }
        if (result.rows.length > 0) {
          console.log(`  📊 ${result.rows.length} מוצרים לא נמצאו בריצה זו (מונה הוגדל)`);
        }
        return { notFoundCount: result.rows.length, newlyHidden };
      } catch(e) {
        console.log(`  ⚠️ reportScraperFinished נכשל: ${e.message.substring(0,60)}`);
        return { notFoundCount: 0, newlyHidden: 0 };
      }
    },
  };
}