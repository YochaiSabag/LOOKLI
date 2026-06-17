#!/usr/bin/env node
// run_scrapers.js — הרצת סקרייפרים לפי בחירה, עם retry אוטומטי
// שימוש: node run_scrapers.js lichi mima chen
// או:     node run_scrapers.js all

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRAPERS = {
  mekimi:       './scrapers/mekimi_scraper_fixed.js',
  lichi:        './scrapers/lichi_scraper.js',
  mima:         './scrapers/mima_scraper.js',
  aviyah:       './scrapers/aviyah_scraper.js',
  chemise:      './scrapers/chemise_scraper.js',
  chen:         './scrapers/chen_scraper.js',
  avivit:       './scrapers/avivit_scraper.js',
  rare:         './scrapers/rare_scraper.js',
  ordman:       './scrapers/ordman_scraper.js',
  'st-fashion': './scrapers/st_fashion_scraper.js',
  'salina':     './scrapers/salina_scraper.js',
  'myme':       './scrapers/myme_scraper.js',
  'shebello':   './scrapers/shebello_scraper.js',
  'europisrael':'./scrapers/europisrael_scraper.js',
  'moda':       './scrapers/moda_scraper.js',
  'leaa':       './scrapers/leaa_scraper.js',
};

const MAX_RETRIES = 2;        // כמה פעמים לנסות מחדש אחרי כישלון
const RETRY_DELAY_MS = 15000; // 15 שניות המתנה בין ניסיונות

const args = process.argv.slice(2).map(a => a.toLowerCase());

if (args.length === 0) {
  console.log(`
📋 שימוש: node run_scrapers.js [שמות...]

חנויות זמינות:
${Object.keys(SCRAPERS).map(k => `  • ${k}`).join('\n')}
  • all  — כולם

דוגמאות:
  node run_scrapers.js lichi mima
  node run_scrapers.js chen avivit chemise
  node run_scrapers.js all
`);
  process.exit(0);
}

const toRun = args[0] === 'all'
  ? Object.keys(SCRAPERS)
  : args.filter(a => {
      if (!SCRAPERS[a]) { console.log(`⚠️  "${a}" לא מוכר — מדלג`); return false; }
      return true;
    });

if (toRun.length === 0) {
  console.log('❌ לא נבחרו סקרייפרים תקינים');
  process.exit(1);
}

function runScraper(name, file) {
  execSync(`node ${file}`, { stdio: 'inherit', cwd: __dirname });
}

console.log(`\n🚀 מריץ ${toRun.length} סקרייפרים: ${toRun.join(', ')}`);
console.log(`🔁 retry: עד ${MAX_RETRIES} ניסיונות נוספים, ${RETRY_DELAY_MS/1000}s המתנה ביניהם`);
console.log('='.repeat(50));

let ok = 0, fail = 0, retried = 0;
const startAll = Date.now();
const failedList = [];

for (const name of toRun) {
  const file = SCRAPERS[name];
  console.log(`\n${'='.repeat(50)}\n▶️  מתחיל: ${name.toUpperCase()}\n${'='.repeat(50)}`);

  let success = false;
  let attempt = 0;

  while (attempt <= MAX_RETRIES && !success) {
    if (attempt > 0) {
      console.log(`\n⏳ ממתין ${RETRY_DELAY_MS/1000}s לפני ניסיון ${attempt + 1}/${MAX_RETRIES + 1}...`);
      execSync(`sleep ${RETRY_DELAY_MS/1000}`, { stdio: 'ignore' });
      console.log(`🔁 ניסיון חוזר: ${name.toUpperCase()} (${attempt}/${MAX_RETRIES})`);
      retried++;
    }

    const start = Date.now();
    try {
      runScraper(name, file);
      const sec = ((Date.now() - start) / 1000).toFixed(0);
      console.log(`\n✅ ${name.toUpperCase()} הסתיים (${sec}s${attempt > 0 ? `, ניסיון ${attempt + 1}` : ''})`);
      success = true;
      ok++;
    } catch (e) {
      const sec = ((Date.now() - start) / 1000).toFixed(0);
      if (attempt < MAX_RETRIES) {
        console.log(`\n⚠️  ${name.toUpperCase()} נכשל (${sec}s) — ינסה שוב`);
      } else {
        console.log(`\n❌ ${name.toUpperCase()} נכשל לאחר ${attempt + 1} ניסיונות (${sec}s)`);
        fail++;
        failedList.push(name);
      }
    }
    attempt++;
  }
}

// בדיקת התראות בסוף
console.log(`\n${'='.repeat(50)}\n🔔 מריץ בדיקת התראות...\n${'='.repeat(50)}`);
try {
  execSync('node ./check_alerts.js', { stdio: 'inherit', cwd: __dirname });
} catch(e) {}

const totalMin = ((Date.now() - startAll) / 1000 / 60).toFixed(1);
console.log(`\n${'='.repeat(50)}`);
console.log(`🏁 סיום — ✅ ${ok} הצליחו | ❌ ${fail} נכשלו | 🔁 ${retried} retries | ⏱ ${totalMin} דקות`);
if (failedList.length) {
  console.log(`❌ נכשלו: ${failedList.join(', ')}`);
}
console.log('='.repeat(50));

// יציאה עם קוד שגיאה אם יש כישלונות — Railway יראה זאת בלוגים
if (fail > 0) process.exit(1);