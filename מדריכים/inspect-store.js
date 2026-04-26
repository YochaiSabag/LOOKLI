// ============================================================
// LOOKLI Store Inspector - הדבק בקונסול של הדפדפן על דף מוצר
// ============================================================
(function() {
  const r = { url: location.href, platform: '?', title: null, price: null, originalPrice: null, images: [], colors: [], sizes: [], description: null, shipping: null, raw: {} };

  // ── פלטפורמה ──
  if (window.Shopify) r.platform = 'Shopify';
  else if (document.querySelector('form.variations_form, .woocommerce, body.woocommerce')) r.platform = 'WooCommerce';
  else if (document.querySelector('[data-section-type], .shopify-section')) r.platform = 'Shopify';
  else if (document.querySelector('.magento, .catalog-product-view')) r.platform = 'Magento';

  // ── כותרת ──
  const titleSels = ['h1.product_title','h1.entry-title','h1','h2.product-title','.product-name h1','.product_title'];
  for (const s of titleSels) { const el = document.querySelector(s); if (el?.innerText?.trim()) { r.title = el.innerText.trim(); r.raw.titleSel = s; break; } }

  // ── מחיר ──
  const priceEl = document.querySelector('p.price, .price, [class*="price"], .product-price, .Price');
  if (priceEl) {
    r.raw.priceHTML = priceEl.outerHTML.substring(0, 400);
    const del = priceEl.querySelector('del bdi, del .money, del');
    const ins = priceEl.querySelector('ins bdi, ins .money, ins');
    if (del && ins) {
      r.originalPrice = del.innerText.replace(/[^\d.]/g,'');
      r.price = ins.innerText.replace(/[^\d.]/g,'');
    } else {
      const bdi = priceEl.querySelector('bdi, .money, .woocommerce-Price-amount');
      r.price = bdi?.innerText?.replace(/[^\d.]/g,'') || priceEl.innerText?.replace(/[^\d.]/g,'').trim();
    }
  }

  // ── תמונות ──
  const imgSels = [
    '.woocommerce-product-gallery__image a[href*="uploads"]',
    '.woocommerce-product-gallery__image img',
    '.jet-woo-product-gallery__image img',
    '[class*="product-gallery"] img',
    '[class*="ProductMedia"] img',
    '.product__media img',
    'figure.product__media img',
  ];
  for (const s of imgSels) {
    document.querySelectorAll(s).forEach(el => {
      const src = el.href || el.getAttribute('data-large_image') || el.getAttribute('data-src') || el.src || '';
      if (src && src.includes('http') && !r.images.includes(src)) r.images.push(src.substring(0,150));
    });
  }
  // Shopify JSON
  if (window.ShopifyAnalytics?.meta?.product?.images) {
    window.ShopifyAnalytics.meta.product.images.forEach(img => r.images.push('https:' + img));
  }

  // ── מידות וצבעים — כל השיטות ──
  r.raw.selects = [];
  r.raw.swatches = [];
  r.raw.radios = [];
  r.raw.shopifyOptions = null;

  // WooCommerce selects
  document.querySelectorAll('select').forEach(sel => {
    const name = (sel.name || sel.id || '').toLowerCase();
    const opts = [...sel.options].map(o => o.text.trim()).filter(o => o && !/בחר|choose|select/i.test(o));
    if (opts.length === 0) return;
    r.raw.selects.push({ name: sel.name, id: sel.id, class: sel.className.substring(0,60), options: opts });
    if (name.includes('color') || name.includes('tzba') || name.includes('colour')) r.colors = [...new Set([...r.colors, ...opts])];
    else if (name.includes('size') || name.includes('mida')) r.sizes = [...new Set([...r.sizes, ...opts])];
    else r.sizes = [...new Set([...r.sizes, ...opts])]; // לא ברור — שמור בכל מקרה
  });

  // WooCommerce swatches
  document.querySelectorAll('[data-attribute_name]').forEach(wrapper => {
    const attr = wrapper.getAttribute('data-attribute_name').toLowerCase();
    wrapper.querySelectorAll('li').forEach(li => {
      const val = li.getAttribute('data-title') || li.getAttribute('title') || li.innerText?.trim();
      const disabled = li.classList.contains('disabled');
      if (!val) return;
      r.raw.swatches.push({ attr, val, disabled });
      if (attr.includes('color') || attr.includes('tzba')) r.colors.push(val);
      else r.sizes.push(val);
    });
  });

  // Radio buttons
  document.querySelectorAll('input[type=radio][name^="attribute_"], input[type=radio][name^="option"]').forEach(radio => {
    const label = document.querySelector(`label[for="${radio.id}"]`)?.innerText?.trim() || radio.value;
    r.raw.radios.push({ name: radio.name, value: radio.value, label, disabled: radio.disabled });
  });

  // Shopify options
  if (window.ShopifyAnalytics?.meta?.product) {
    const prod = window.ShopifyAnalytics.meta.product;
    r.raw.shopifyOptions = prod.options || null;
    r.raw.shopifyVariants = (prod.variants || []).slice(0,5).map(v => ({ title: v.title, available: v.available }));
    if (prod.options) {
      prod.options.forEach((opt, i) => {
        const vals = [...new Set((prod.variants || []).map(v => v[`option${i+1}`]).filter(Boolean))];
        const name = opt.toLowerCase();
        if (name.includes('color') || name.includes('colour') || name.includes('צבע')) r.colors = vals;
        else r.sizes = vals;
      });
    }
  }

  // Shopify: option elements (classic themes)
  document.querySelectorAll('[name^="options["]').forEach(el => {
    const name = el.name.toLowerCase();
    const vals = el.tagName === 'SELECT'
      ? [...el.options].map(o=>o.text.trim()).filter(o=>o && !/choose/i.test(o))
      : [el.value];
    if (name.includes('color') || name.includes('colour')) r.colors = [...new Set([...r.colors, ...vals])];
    else r.sizes = [...new Set([...r.sizes, ...vals])];
  });

  // ── תיאור ──
  const descSels = ['.woocommerce-product-details__short-description','[class*="short-description"]','.product-description','.product__description','[class*="ProductDescription"]','.description'];
  for (const s of descSels) { const el = document.querySelector(s); if (el?.innerText?.trim()) { r.description = el.innerText.trim().substring(0,300); r.raw.descSel = s; break; } }

  // ── משלוח ──
  const allText = document.body.innerText;
  const shippingMatch = allText.match(/(?:משלוח|shipping)[^\n]*?(\d+)\s*(?:₪|ש["״]ח)/i);
  if (shippingMatch) r.shipping = shippingMatch[0].substring(0,100);

  // ── WooCommerce variations form ──
  const form = document.querySelector('form.variations_form');
  if (form) {
    const json = form.getAttribute('data-product_variations');
    r.raw.variationsFormFound = true;
    r.raw.variationsJSON = json ? `${json.length} chars` : 'empty/null';
    if (json && json.length > 2 && json !== '[]') {
      try {
        const vars = JSON.parse(json);
        r.raw.variationsSample = vars.slice(0,2).map(v => ({ attrs: v.attributes, inStock: v.is_in_stock, price: v.display_price }));
      } catch(e) {}
    }
  }

  // ── פלט ──
  const output = JSON.stringify(r, null, 2);
  console.log('%c🔍 LOOKLI Store Inspector', 'font-size:16px;font-weight:bold;color:#6366f1');
  console.log('%cURL:', 'font-weight:bold', r.url);
  console.log('%cPlatform:', 'font-weight:bold', r.platform);
  console.log('%cTitle:', 'font-weight:bold', r.title);
  console.log('%cPrice:', 'font-weight:bold', r.price, r.originalPrice ? `(מקורי: ${r.originalPrice})` : '');
  console.log('%cImages:', 'font-weight:bold', r.images.length, r.images[0] || '');
  console.log('%cColors:', 'font-weight:bold', r.colors);
  console.log('%cSizes:', 'font-weight:bold', r.sizes);
  console.log('%cDescription:', 'font-weight:bold', r.description?.substring(0,80));
  console.log('%cShipping:', 'font-weight:bold', r.shipping);
  console.log('\n%c📋 העתק JSON מלא:', 'font-weight:bold;color:#10b981');
  console.log(output);

  // Copy to clipboard
  try {
    navigator.clipboard.writeText(output).then(() => console.log('%c✅ הועתק ל-clipboard!', 'color:green;font-weight:bold'));
  } catch(e) {
    console.log('%c⚠️ העתק ידנית מלמעלה', 'color:orange');
  }

  return r;
})();
