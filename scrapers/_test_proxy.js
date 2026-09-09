// סקריפט בדיקה חד-פעמי - לא חלק מהסקרייפרים - בודק אם בקשת HTTP פשוטה (בלי דפדפן)
// מצליחה להביא את דף leaa.co.il/shop/ דרך הפרוקסי, ישירות מ-Railway
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'https';

const proxyUrl = `${process.env.PROXY_SERVER.split('://')[0]}://${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD || ''}@${process.env.PROXY_SERVER.split('://')[1]}`;
console.log('בודק פרוקסי (host מוסתר username):', proxyUrl.replace(process.env.PROXY_USERNAME, '***'));

const agent = new HttpsProxyAgent(proxyUrl);

function testRequest() {
  return new Promise((resolve) => {
    const req = https.get('https://leaa.co.il/shop/', { agent, timeout: 60000, rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('סטטוס:', res.statusCode);
        console.log('אורך תוכן:', data.length);
        console.log('מכיל "product"?', data.includes('/product/'));
        console.log('קטע ראשון:', data.substring(0, 300));
        resolve();
      });
    });
    req.on('timeout', () => { console.log('❌ timeout אחרי 60 שניות'); req.destroy(); resolve(); });
    req.on('error', (e) => { console.log('❌ שגיאה:', e.message); resolve(); });
  });
}

await testRequest();
