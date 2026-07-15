// scrapers/test_image_check.js
//
// בדיקה מהירה על כמה URLs בודדים — אותה שיטה בדיוק כמו שכבר עובדת בפועל
// ב-uploadToCloudinary בסקרייפרים (fetch + Referer), עם ניסיון חוזר למקרה
// של תמונה "בעיבוד" (שירותי אופטימיזציה מחזירים לפעמים 202/HTML בפעם הראשונה).
// הרצה:  node scrapers/test_image_check.js "URL1" "URL2" ...

const MIN_VALID_BYTES = 15000;

async function checkImageUrl(url, attempt = 1) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': new URL(url).origin + '/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });
    const contentType = resp.headers.get('content-type') || '';
    if ((resp.status === 202 || !resp.ok || !contentType.startsWith('image/')) && attempt < 4) {
      await new Promise(r => setTimeout(r, 2500)); // אולי תמונה בעיבוד - ממתין וינסה שוב
      return checkImageUrl(url, attempt + 1);
    }
    if (!resp.ok) return { valid: false, reason: `HTTP ${resp.status} (אחרי ${attempt} ניסיונות)` };
    if (!contentType.startsWith('image/')) return { valid: false, reason: `content-type לא תמונה: ${contentType} (אחרי ${attempt} ניסיונות)` };
    const buf = await resp.arrayBuffer();
    const kb = (buf.byteLength / 1024).toFixed(1);
    if (buf.byteLength < MIN_VALID_BYTES) return { valid: false, reason: `קטן מדי: ${kb}KB` };
    return { valid: true, reason: `${kb}KB, ${contentType}` };
  } catch (e) {
    return { valid: false, reason: `שגיאת רשת: ${e.message}` };
  }
}

const urls = process.argv.slice(2);
if (!urls.length) { console.log('שימוש: node scrapers/test_image_check.js "URL1" "URL2"'); process.exit(0); }

(async () => {
  for (const url of urls) {
    const r = await checkImageUrl(url);
    console.log(`${r.valid ? '✅ תקין' : '❌ חסום/בעייתי'}  |  ${r.reason}  |  ${url.substring(0,80)}`);
  }
})();