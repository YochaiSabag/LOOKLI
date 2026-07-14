// scrapers/test_image_check.js
//
// בדיקה מהירה על כמה URLs בודדים — לפני שמריצים את הבדיקה המלאה על כל המוצרים.
// הרצה:  node scrapers/test_image_check.js "URL1" "URL2" ...

const MIN_VALID_BYTES = 8000;

async function checkImageUrl(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    const contentType = resp.headers.get('content-type') || '';
    if (!resp.ok) return { valid: false, reason: `HTTP ${resp.status}` };
    if (!contentType.startsWith('image/')) return { valid: false, reason: `content-type לא תמונה: ${contentType}` };
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
