// scrapers/test_image_check_browser.js
//
// כמו test_image_check.js אבל עם דפדפן אמיתי (Playwright) במקום fetch —
// עוקף הגנות בוט שמזהות בקשות לא-דפדפניות ומחזירות דף HTML במקום התמונה.
// הרצה:  node scrapers/test_image_check_browser.js "URL1" "URL2" ...

import { chromium } from 'playwright';

const MIN_VALID_BYTES = 8500;

async function checkImageUrl(browser, url) {
  const origin = new URL(url).origin;
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});

    // טוענים תג <img> אמיתי בדף (בדיוק כמו שדפדפן טוען תמונה רגילה) וממתינים שהיא תיטען בפועל
    const result = await page.evaluate((imgUrl) => {
      return new Promise((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => resolve({ error: 'timeout (15s)' }), 15000);
        img.onload = () => {
          clearTimeout(timer);
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve({ error: 'onerror - התמונה לא נטענה בכלל' });
        };
        img.src = imgUrl;
      });
    }, url);

    if (result.error) return { valid: false, reason: result.error };
    if (result.width < 50 || result.height < 50) return { valid: false, reason: `ממדים חשודים: ${result.width}x${result.height}px` };
    return { valid: true, reason: `${result.width}x${result.height}px` };
  } catch (e) {
    return { valid: false, reason: `שגיאה: ${e.message.substring(0,80)}` };
  } finally {
    await page.close().catch(()=>{});
  }
}

const urls = process.argv.slice(2);
if (!urls.length) { console.log('שימוש: node scrapers/test_image_check_browser.js "URL1" "URL2"'); process.exit(0); }

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome', // כרום האמיתי המותקן אצלך, לא ה-Chromium המובנה של Playwright
    args: ['--disable-blink-features=AutomationControlled'],
  });
  for (const url of urls) {
    const r = await checkImageUrl(browser, url);
    console.log(`${r.valid ? '✅ תקין' : '❌ חסום/בעייתי'}  |  ${r.reason}  |  ${url.substring(0,80)}`);
  }
  await browser.close();
})();