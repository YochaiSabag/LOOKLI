// scrapers/moda_parse.js
// פענוח דף מוצר של modafashion.co.il (אלמנטור + WooCommerce) — פונקציה טהורה, בלי רשת ובלי DB,
// כדי שאפשר יהיה לבדוק אותה על קובצי HTML שמורים.
// מקור האמת למידות/מחיר/מלאי: JSON הוריאציות שבטופס form.variations_form[data-product_variations]
import * as cheerio from 'cheerio';

const safeDecode = (s) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

const cleanNum = (t) => parseFloat(String(t || '').replace(/[^\d.]/g, '')) || 0;

export function parseModaProduct(html, baseUrl = 'https://modafashion.co.il') {
  const $ = cheerio.load(html);

  // ── שם המוצר: og:title / <title> בלי הסיומת " - Moda Fashion" ──
  let title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').trim();
  title = title.replace(/\s*[-–|]\s*Moda\s*Fashion\s*$/i, '').trim();

  // ── תיאור ──
  const paragraphs = $('.woocommerce-product-details__short-description p')
    .map((_, p) => $(p).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  let description = paragraphs.join(' ');
  if (!description) description = ($('meta[name="description"]').attr('content') || '').trim();
  const firstParagraph = paragraphs[0] || description;

  // ── וריאציות ──
  const form = $('form.variations_form').first();
  let variations = [];
  const raw = form.attr('data-product_variations');
  if (raw && raw !== 'false') {
    try { variations = JSON.parse(raw); } catch { variations = []; }
  }

  // אפשרויות ה-select (לשימוש כשוריאציה היא "כל מידה" או כשאין JSON)
  const selectOptions = {};
  form.find('select').each((_, sel) => {
    const name = safeDecode(($(sel).attr('name') || '').replace(/^attribute_/, ''));
    selectOptions[name] = $(sel).find('option').map((__, o) => $(o).attr('value')).get()
      .filter(Boolean).map(safeDecode);
  });

  const isSizeKey = (k) => /מידה|מידות|size/i.test(k);
  const isColorKey = (k) => /צבע|color|colour/i.test(k);

  const sizesInStock = new Set();
  const allSizes = new Set();
  const colorsRaw = new Set();
  const colorSizesRaw = {}; // צבע -> [מידות במלאי]

  for (const v of variations) {
    let vSizes = [];
    let vColors = [];
    for (const [key, valRaw] of Object.entries(v.attributes || {})) {
      const k = safeDecode(key.replace(/^attribute_/, '').replace(/^pa_/, ''));
      const keyFull = safeDecode(key.replace(/^attribute_/, ''));
      const val = safeDecode(valRaw || '');
      if (isSizeKey(k) || isSizeKey(keyFull)) {
        vSizes = val ? [val] : (selectOptions[keyFull] || selectOptions[k] || []);
      } else if (isColorKey(k) || isColorKey(keyFull)) {
        vColors = val ? [val] : (selectOptions[keyFull] || selectOptions[k] || []);
      }
    }
    for (const s of vSizes) {
      allSizes.add(s);
      if (v.is_in_stock) sizesInStock.add(s);
    }
    for (const c of vColors) {
      colorsRaw.add(c);
      if (v.is_in_stock) {
        colorSizesRaw[c] = colorSizesRaw[c] || [];
        for (const s of vSizes) if (!colorSizesRaw[c].includes(s)) colorSizesRaw[c].push(s);
      }
    }
  }

  // אין JSON אבל יש select של מידות — כל האפשרויות נחשבות "קיימות" (מלאי לא ידוע)
  if (variations.length === 0) {
    for (const [name, opts] of Object.entries(selectOptions)) {
      if (isSizeKey(name)) opts.forEach(s => { allSizes.add(s); sizesInStock.add(s); });
      if (isColorKey(name)) opts.forEach(c => colorsRaw.add(c));
    }
  }

  // ── מחיר ──
  let price = 0, originalPrice = 0;
  if (variations.length > 0) {
    const pool = variations.filter(v => v.is_in_stock);
    const use = pool.length ? pool : variations;
    const best = use.reduce((a, b) => ((a.display_price || Infinity) <= (b.display_price || Infinity) ? a : b));
    price = Number(best.display_price) || 0;
    const reg = Number(best.display_regular_price) || 0;
    originalPrice = reg > price ? reg : 0;
  } else {
    // מוצר פשוט: אלמנט מחיר שאינו חלק מעגלת הקניות
    const priceEl = $('.price, [class*="product-price"]').not('.elementor-menu-cart__product-price').first();
    const ins = priceEl.find('ins .woocommerce-Price-amount bdi, ins .amount bdi').first();
    const del = priceEl.find('del .woocommerce-Price-amount bdi, del .amount bdi').first();
    const single = priceEl.find('.woocommerce-Price-amount bdi, .amount bdi').first();
    if (ins.length) { price = cleanNum(ins.text()); originalPrice = del.length ? cleanNum(del.text()) : 0; }
    else price = cleanNum(single.text());
  }

  // ── תמונות ──
  const imgs = [];
  const addImg = (u) => {
    if (!u) return;
    try {
      const abs = new URL(u, baseUrl).href;
      if (abs.includes('/wp-content/uploads/') && !imgs.includes(abs)) imgs.push(abs);
    } catch { /* מתעלמים מכתובת לא תקינה */ }
  };
  $('.jet-woo-product-gallery [data-large_image]').each((_, e) => addImg($(e).attr('data-large_image')));
  if (imgs.length === 0) $('[data-large_image]').each((_, e) => addImg($(e).attr('data-large_image')));
  addImg($('meta[property="og:image"]').attr('content'));
  for (const v of variations) addImg(v.image?.full_src || v.image?.src);

  const inStockAny = variations.length ? variations.some(v => v.is_in_stock) : true;

  return {
    title, description, firstParagraph, price, originalPrice,
    sizesInStock: [...sizesInStock], allSizes: [...allSizes],
    colorsRaw: [...colorsRaw], colorSizesRaw,
    images: imgs, variationsCount: variations.length, inStockAny,
  };
}
