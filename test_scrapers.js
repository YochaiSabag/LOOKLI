#!/usr/bin/env node
/**
 * test_scrapers.js — בדיקת תקינות סקרייפרים
 * מגביל כל סקרייפר ל-1 עמוד ו-5 מוצרים
 *
 * שימוש:
 *   npm test                        — כל הסקרייפרים
 *   npm test lichi                  — סקרייפר אחד
 *   npm test lichi mima chemise     — כמה ספציפיים
 *   npm test st-fashion             — ST Fashion
 *
 * או ישירות:
 *   node test_scrapers.js
 *   node test_scrapers.js lichi
 *   node test_scrapers.js lichi mima
 */

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
  'st-fashion': './scrapers/st_fashion_scraper.js',
};

const args = process.argv.slice(2).map(a => a.toLowerCase());

const toRun = args.length === 0
  ? Object.keys(SCRAPERS)
  : args.filter(a => {
      if (!SCRAPERS[a]) { console.log(`⚠️  "${a}" לא מוכר — מדלג`); return false; }
      return true;
    });

if (toRun.length === 0) {
  console.log('❌ לא נבחרו סקרייפרים תקינים');
  process.exit(1);
}

console.log(`\n🧪 TEST MODE — 2 עמודים / 5 מוצרים לכל סקרייפר`);
console.log(`🚀 מריץ: ${toRun.join(', ')}\n${'='.repeat(50)}`);

const results = [];
const startAll = Date.now();

for (const name of toRun) {
  const file = SCRAPERS[name];
  console.log(`\n${'='.repeat(50)}\n▶️  בודק: ${name.toUpperCase()}\n${'='.repeat(50)}`);
  const start = Date.now();
  try {
    execSync(`node ${file}`, {
      stdio: 'inherit',
      cwd: __dirname,
      env: {
        ...process.env,
        SCRAPER_TEST_MODE: 'true',
        SCRAPER_MAX_PAGES: '1',
        SCRAPER_MAX_PRODUCTS: '5',
      }
    });
    const sec = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`\n✅ ${name.toUpperCase()} עבר (${sec}s)`);
    results.push({ name, ok: true, sec });
  } catch (e) {
    const sec = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`\n❌ ${name.toUpperCase()} נכשל (${sec}s)`);
    results.push({ name, ok: false, sec });
  }
}

const totalSec = ((Date.now() - startAll) / 1000 / 60).toFixed(1);
const ok   = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;

console.log(`\n${'='.repeat(50)}`);
console.log(`🧪 תוצאות TEST:\n`);
results.forEach(r => {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(12)} ${r.sec}s`);
});
console.log(`\n${'='.repeat(50)}`);
console.log(`🏁 סיום — ✅ ${ok} עברו | ❌ ${fail} נכשלו | ⏱ ${totalSec} דקות`);
console.log('='.repeat(50));

// שלח מייל סיכום טסט
console.log(`\n${'='.repeat(50)}\n🏥 מריץ health check...\n${'='.repeat(50)}`);
try {
  execSync('node ./health_check.js', { stdio: 'inherit', cwd: __dirname });
} catch(e) {}
