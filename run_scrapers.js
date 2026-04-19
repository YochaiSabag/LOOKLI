#!/usr/bin/env node
// run_scrapers.js — הרצת סקרייפרים לפי בחירה
// שימוש: node run_scrapers.js lichi mima chen
// או:     node run_scrapers.js all

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRAPERS = {
  mekimi:  './scrapers/mekimi_scraper_fixed.js',
  lichi:   './scrapers/lichi_scraper.js',
  mima:    './scrapers/mima_scraper.js',
  aviyah:  './scrapers/aviyah_scraper.js',
  chemise: './scrapers/chemise_scraper.js',
  chen:    './scrapers/chen_scraper.js',
  avivit:  './scrapers/avivit_scraper.js',
  rare:    './scrapers/rare_scraper.js',
  ordman:  './scrapers/ordman_scraper.js',
};

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

console.log(`\n🚀 מריץ ${toRun.length} סקרייפרים: ${toRun.join(', ')}\n${'='.repeat(50)}`);

let ok = 0, fail = 0;
const startAll = Date.now();

for (const name of toRun) {
  const file = SCRAPERS[name];
  console.log(`\n${'='.repeat(50)}\n▶️  מתחיל: ${name.toUpperCase()}\n${'='.repeat(50)}`);
  const start = Date.now();
  try {
    execSync(`node ${file}`, { stdio: 'inherit', cwd: __dirname });
    const sec = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`\n✅ ${name.toUpperCase()} הסתיים (${sec}s)`);
    ok++;
  } catch (e) {
    const sec = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`\n❌ ${name.toUpperCase()} נכשל (${sec}s)`);
    fail++;
  }
}

// בדיקת התראות בסוף
console.log(`\n${'='.repeat(50)}\n🔔 מריץ בדיקת התראות...\n${'='.repeat(50)}`);
try {
  execSync('node ./check_alerts.js', { stdio: 'inherit', cwd: __dirname });
} catch(e) {}

// health check לאדמין
console.log(`\n${'='.repeat(50)}\n🏥 מריץ health check...\n${'='.repeat(50)}`);
try {
  execSync('node ./health_check.js', { stdio: 'inherit', cwd: __dirname });
} catch(e) {}

const totalSec = ((Date.now() - startAll) / 1000 / 60).toFixed(1);
console.log(`\n${'='.repeat(50)}`);
console.log(`🏁 סיום — ✅ ${ok} הצליחו | ❌ ${fail} נכשלו | ⏱ ${totalSec} דקות`);
console.log('='.repeat(50));
