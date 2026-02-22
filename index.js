console.log("BOOT DEBUG ROUTE VERSION 1");
import express from "express";
import pkg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { createHmac, randomBytes } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pkg;
const app = express();

// ===== SEO helpers (robots.txt + sitemap.xml) =====
const SITE_URL = process.env.SITE_URL || "https://lookli.co.il";

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *
Allow: /
Sitemap: ${SITE_URL}/sitemap.xml
`);
});

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml");
  const now = new Date().toISOString();
  const urls = [
    { loc: `${SITE_URL}/`, priority: "1.0" },
    { loc: `${SITE_URL}/about.html`, priority: "0.6" },
    { loc: `${SITE_URL}/contact.html`, priority: "0.6" },
  ];

  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

  res.send(xml);
});
// ================================================

app.get("/api/debug/version", (req, res) => {
  res.json({
    version: "v1-debug-2026-02-06-01",
    hasDatabaseUrl: !!process.env.DATABASE_URL,
  });
});
const PORT = process.env.PORT || 3000;

// Database connection - supports both DATABASE_URL and individual vars
// Database connection (Railway/Prod MUST use DATABASE_URL)
const connStr = process.env.DATABASE_URL;

if (!connStr) {
  // Fail fast so we never silently connect to localhost in Railway
  throw new Error("DATABASE_URL is missing. Set it in Railway > LOOKLI > Variables.");
}

const useSSL = connStr.includes("proxy.rlwy.net") || connStr.includes("rlwy.net");

const pool = new Pool({
  connectionString: connStr,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const validColors = ['שחור', 'לבן', 'שמנת', 'כחול', 'תכלת', 'נייבי', 'אדום', 'בורדו', 'ירוק', 'זית', 'חאקי', 'חום', 'קאמל', 'בז׳', 'ניוד', 'אפור', 'ורוד', 'סגול', 'לילך', 'צהוב', 'חרדל', 'כתום', 'זהב', 'כסף', 'פרחוני', 'צבעוני', 'מנטה', 'אפרסק', 'אבן'];

const shippingInfo = {
  'MEKIMI': { cost: 25, threshold: 300 },
  'LICHI': { cost: 30, threshold: 350 },
  'MIMA': { cost: 30, threshold: 450 },
  'AVIYAH': { cost: 30, threshold: 500 },
  'CHEMISE': { cost: 30, threshold: 350 }
};

function calculateShipping(store, price) {
  const info = shippingInfo[store] || { cost: 30, threshold: 300 };
  const isFree = price >= info.threshold;
  return { cost: isFree ? 0 : info.cost, isFree, threshold: info.threshold };
}

app.get("/api/filters", async (req, res) => {
  try {
    const { store, category, color, size, style, fit, fabric, pattern, design } = req.query;
    let baseWhere = '1=1';
    const baseParams = [];
    let paramIndex = 1;
    
    if (store) { baseWhere += ` AND store = $${paramIndex++}`; baseParams.push(store); }
    if (category) { 
      const cats = category.split(',').filter(Boolean);
      if (cats.length === 1) {
        baseWhere += ` AND (category = $${paramIndex} OR title ILIKE $${paramIndex + 1})`; baseParams.push(cats[0], `%${cats[0]}%`); paramIndex += 2;
      } else {
        baseWhere += ` AND category = ANY($${paramIndex}::text[])`; baseParams.push(cats); paramIndex++;
      }
    }
    if (style) { 
      const styles = style.split(',').filter(Boolean);
      if (styles.length > 1) {
        baseWhere += ` AND style = ANY($${paramIndex}::text[])`; baseParams.push(styles); paramIndex++;
      } else if (styles[0] === 'יום חול') {
        baseWhere += ` AND (style = $${paramIndex} OR style = 'יומיומי' OR title ILIKE '%יום חול%' OR title ILIKE '%יומיומי%' OR title ILIKE '%יום יום%' OR description ILIKE '%יום חול%' OR description ILIKE '%יומיומי%')`;
        baseParams.push(styles[0]); paramIndex++;
      } else if (styles[0] === 'שבת/ערב') {
        baseWhere += ` AND (style IN ('ערב','חגיגי','אלגנטי','שבת') OR title ILIKE '%שבת%' OR title ILIKE '%ערב%' OR title ILIKE '%חגיג%' OR title ILIKE '%אלגנט%')`;
      } else {
        baseWhere += ` AND (style = $${paramIndex} OR title ILIKE $${paramIndex + 1})`; baseParams.push(styles[0], `%${styles[0]}%`); paramIndex += 2;
      }
    }
    if (fit) {
      const fits = fit.split(',').filter(Boolean);
      if (fits.length > 1) {
        baseWhere += ` AND fit = ANY($${paramIndex}::text[])`; baseParams.push(fits); paramIndex++;
      } else if (fits[0] === '\u05d0\u05e8\u05d5\u05db\u05d4') {
        baseWhere += ` AND (fit = $${paramIndex} OR fit = '\u05d0\u05e8\u05d5\u05da' OR title ILIKE '%\u05de\u05e7\u05e1\u05d9%' OR title ILIKE '%maxi%')`;
        baseParams.push(fits[0]); paramIndex++;
      } else if (fits[0] === '\u05de\u05d9\u05d3\u05d9') {
        baseWhere += ` AND (fit = $${paramIndex} OR title ILIKE '%\u05de\u05d9\u05d3\u05d9%' OR title ILIKE '%midi%' OR title ILIKE '%\u05d0\u05de\u05e6\u05e2%')`;
        baseParams.push(fits[0]); paramIndex++;
      } else {
        baseWhere += ` AND (fit = $${paramIndex} OR title ILIKE $${paramIndex + 1})`;
        baseParams.push(fits[0], `%${fits[0]}%`); paramIndex += 2;
      }
    }
    if (color) { 
      const colors = color.split(',').filter(Boolean);
      if (colors.length === 1) {
        baseWhere += ` AND (color = $${paramIndex} OR $${paramIndex} = ANY(colors))`; baseParams.push(colors[0]); paramIndex++;
      } else {
        baseWhere += ` AND (color = ANY($${paramIndex}::text[]) OR colors && $${paramIndex}::text[])`; baseParams.push(colors); paramIndex++;
      }
    }
    if (size) { 
      const sizes = size.split(',').filter(Boolean);
      if (sizes.length === 1) {
        baseWhere += ` AND $${paramIndex} = ANY(sizes)`; baseParams.push(sizes[0]); paramIndex++;
      } else {
        baseWhere += ` AND sizes && $${paramIndex}::text[]`; baseParams.push(sizes); paramIndex++;
      }
    }
    
    const [storesRes, sizesRes, colorsRes, stylesRes, fitsRes, categoriesRes, maxPriceRes, patternsRes, fabricsRes, designRes] = await Promise.all([
      pool.query(`SELECT DISTINCT store FROM products WHERE ${baseWhere} AND store IS NOT NULL ORDER BY store`, baseParams),
      pool.query(`SELECT DISTINCT unnest(sizes) AS size FROM products WHERE ${baseWhere} AND sizes IS NOT NULL`, baseParams),
      pool.query(`SELECT DISTINCT c AS color FROM (SELECT color AS c FROM products WHERE ${baseWhere} AND color IS NOT NULL AND color != '' UNION SELECT unnest(colors) AS c FROM products WHERE ${baseWhere} AND colors IS NOT NULL) sub ORDER BY c`, [...baseParams, ...baseParams]),
      pool.query(`SELECT DISTINCT style FROM products WHERE ${baseWhere} AND style IS NOT NULL AND style != '' ORDER BY style`, baseParams),
      pool.query(`SELECT DISTINCT fit FROM products WHERE ${baseWhere} AND fit IS NOT NULL AND fit != '' ORDER BY fit`, baseParams),
      pool.query(`SELECT DISTINCT category FROM products WHERE ${baseWhere} AND category IS NOT NULL AND category != '' ORDER BY category`, baseParams),
      pool.query(`SELECT MAX(price) as max_price FROM products WHERE ${baseWhere} AND price > 0`, baseParams),
      pool.query(`SELECT DISTINCT pattern FROM products WHERE ${baseWhere} AND pattern IS NOT NULL AND pattern != '' ORDER BY pattern`, baseParams),
      pool.query(`SELECT DISTINCT fabric FROM products WHERE ${baseWhere} AND fabric IS NOT NULL AND fabric != '' ORDER BY fabric`, baseParams),
      pool.query(`SELECT DISTINCT unnest(design_details) AS detail FROM products WHERE ${baseWhere} AND design_details IS NOT NULL`, baseParams)
    ]);

    const validColorSet = new Set(validColors);
    res.json({
      stores: storesRes.rows.map(r => r.store).filter(Boolean),
      sizes: sizesRes.rows.map(r => r.size).filter(Boolean),
      colors: colorsRes.rows.map(r => r.color).filter(c => c && validColorSet.has(c)),
      styles: stylesRes.rows.map(r => r.style).filter(Boolean),
      fits: fitsRes.rows.map(r => r.fit).filter(Boolean),
      categories: categoriesRes.rows.map(r => r.category).filter(Boolean),
      patterns: patternsRes.rows.map(r => r.pattern).filter(Boolean),
      fabrics: fabricsRes.rows.map(r => r.fabric).filter(Boolean),
      designs: designRes.rows.map(r => r.detail).filter(Boolean),
      maxPrice: Math.ceil(parseFloat(maxPriceRes.rows[0]?.max_price) || 500)
    });
  } catch (err) {
    console.error("filters error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

// מיפוי מידות מספריות -> אוניברסליות (כמו בסקרייפר)
const sizeMapping = {
  '34': ['XS'], '36': ['XS', 'S'], '38': ['S', 'M'], '40': ['M', 'L'],
  '42': ['L', 'XL'], '44': ['XL', 'XXL'], '46': ['XXL', 'XXXL'], '48': ['XXXL']
};

function expandSize(size) {
  if (!size) return [size];
  const mapped = sizeMapping[size];
  if (mapped) return mapped;
  return [size];
}

app.get("/api/products", async (req, res) => {
  try {
    const { q, color, size, store, style, fit, category, maxPrice, sort, minDiscount, fabric, pattern, design } = req.query;
    let sql = `SELECT id, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, store, source_url, description, pattern, fabric, design_details, color_sizes FROM products WHERE 1=1`;
    const params = [];
    let i = 1;

    // סינון אקססוריז - לא מציגים גומיות שיער וכדומה
    sql += ` AND (category IS NULL OR category NOT IN ('גומיות', 'גומייה', 'אקססוריז', 'אביזרים', 'תכשיטים', 'כובעים', 'צעיפים', 'תיקים'))`;
    sql += ` AND title NOT ILIKE '%גומי%שיער%' AND title NOT ILIKE '%גומיי%'`;

    if (q) { sql += ` AND title ILIKE $${i++}`; params.push(`%${q}%`); }
    
    if (color) { 
      const colors = color.split(',').filter(Boolean);
      if (colors.length === 1) {
        sql += ` AND (color = $${i} OR $${i} = ANY(colors))`; params.push(colors[0]); i++;
      } else {
        sql += ` AND (color = ANY($${i}::text[]) OR colors && $${i}::text[])`;
        params.push(colors); i++;
      }
    }
    if (size) {
      const sizes = size.split(',').filter(Boolean);
      if (sizes.length === 1) {
        const expandedSizes = expandSize(sizes[0]);
        if (expandedSizes.length === 1) {
          sql += ` AND $${i} = ANY(sizes)`;
          params.push(expandedSizes[0]); i++;
        } else {
          sql += ` AND sizes && $${i}::text[]`;
          params.push(expandedSizes); i++;
        }
      } else {
        // Multi-select: expand all sizes and combine  
        const allExpanded = [];
        sizes.forEach(s => expandSize(s).forEach(es => { if (!allExpanded.includes(es)) allExpanded.push(es); }));
        sql += ` AND sizes && $${i}::text[]`;
        params.push(allExpanded); i++;
        console.log('[multi-size] expanded:', allExpanded, 'from:', sizes);
      }
    }
    if (store) { sql += ` AND store = $${i++}`; params.push(store); }
    if (style) { 
      const styles = style.split(',').filter(Boolean);
      if (styles.length === 1) {
        const s = styles[0];
        if (s === '\u05d9\u05d5\u05dd \u05d7\u05d5\u05dc') {
          sql += ` AND (style = $${i} OR style = '\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9' OR title ILIKE '%\u05d9\u05d5\u05dd \u05d7\u05d5\u05dc%' OR title ILIKE '%\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9%' OR title ILIKE '%\u05d9\u05d5\u05dd \u05d9\u05d5\u05dd%' OR description ILIKE '%\u05d9\u05d5\u05dd \u05d7\u05d5\u05dc%' OR description ILIKE '%\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9%')`;
          params.push(s); i++;
        } else if (s === '\u05e9\u05d1\u05ea/\u05e2\u05e8\u05d1') {
          sql += ` AND (style IN ('\u05e2\u05e8\u05d1','\u05d7\u05d2\u05d9\u05d2\u05d9','\u05d0\u05dc\u05d2\u05e0\u05d8\u05d9','\u05e9\u05d1\u05ea') OR title ILIKE '%\u05e9\u05d1\u05ea%' OR title ILIKE '%\u05e2\u05e8\u05d1%' OR title ILIKE '%\u05d7\u05d2\u05d9\u05d2%' OR title ILIKE '%\u05d0\u05dc\u05d2\u05e0\u05d8%')`;
        } else {
          sql += ` AND (style = $${i} OR title ILIKE $${i+1})`; params.push(s, `%${s}%`); i += 2;
        }
      } else {
        const orParts = styles.map((_, idx) => `style = $${i + idx} OR title ILIKE $${i + styles.length + idx}`);
        sql += ` AND (${orParts.join(' OR ')})`;
        styles.forEach(s2 => params.push(s2));
        styles.forEach(s2 => params.push(`%${s2}%`));
        i += styles.length * 2;
      }
    }
    if (fit) { 
      const fits = fit.split(',').filter(Boolean);
      if (fits.length === 1) {
        const f = fits[0];
        if (f === 'ארוכה') {
          sql += ` AND (fit = $${i} OR fit = 'ארוך' OR title ILIKE '%מקסי%' OR title ILIKE '%maxi%')`;
          params.push(f); i++;
        } else if (f === 'מידי') {
          sql += ` AND (fit = $${i} OR title ILIKE '%מידי%' OR title ILIKE '%midi%' OR title ILIKE '%אמצע%')`;
          params.push(f); i++;
        } else {
          sql += ` AND (fit = $${i} OR title ILIKE $${i+1})`;
          params.push(f, `%${f}%`); i += 2;
        }
      } else {
        const orParts = fits.map((_, idx) => `fit = $${i + idx} OR title ILIKE $${i + fits.length + idx}`);
        sql += ` AND (${orParts.join(' OR ')})`;
        fits.forEach(f2 => params.push(f2));
        fits.forEach(f2 => params.push(`%${f2}%`));
        i += fits.length * 2;
      }
    }
    if (category) {
      const cats = category.split(',').filter(Boolean);
      if (cats.length === 1) {
        const cat = cats[0];
        if (cat === '\u05d7\u05dc\u05d5\u05e7') {
          sql += ` AND (category = $${i} OR title ILIKE $${i+1} OR title ILIKE '%\u05d0\u05d9\u05e8\u05d5\u05d7%')`;
          params.push(cat, `%${cat}%`); i += 2;
        } else {
          sql += ` AND (category = $${i} OR title ILIKE $${i+1})`;
          params.push(cat, `%${cat}%`); i += 2;
        }
      } else {
        // Multi-select: OR logic - category matches any, or title contains any
        const orParts = cats.map((_, idx) => `category = $${i + idx} OR title ILIKE $${i + cats.length + idx}`);
        sql += ` AND (${orParts.join(' OR ')})`;
        cats.forEach(c => params.push(c));
        cats.forEach(c => params.push(`%${c}%`));
        i += cats.length * 2;
      }
    }
    if (fabric) { 
      const fabrics = fabric.split(',').filter(Boolean);
      if (fabrics.length === 1) {
        sql += ` AND (fabric = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(fabrics[0], `%${fabrics[0]}%`); i += 2;
      } else {
        sql += ` AND (fabric = ANY($${i}::text[]))`;
        params.push(fabrics); i++;
      }
    }
    if (pattern) { 
      if (pattern === '\u05d7\u05dc\u05e7') {
        sql += ` AND (pattern = $${i})`; params.push(pattern); i++;
      } else {
    if (pattern) { 
      if (pattern === 'חלק') {
        sql += ` AND (pattern = $${i} OR title ~* $${i+1} OR description ~* $${i+1})`; 
        params.push(pattern, '(^|\\s)חלק(ה?)($|\\s|\\.)'); i += 2;
      } else {
        sql += ` AND (pattern = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(pattern, `%${pattern}%`); i += 2;
      }
    }
      }
    }
    if (design) { sql += ` AND $${i++} = ANY(design_details)`; params.push(design); }
    if (maxPrice) { sql += ` AND price <= $${i++}`; params.push(Number(maxPrice)); }
    if (minDiscount) { sql += ` AND original_price IS NOT NULL AND original_price > 0 AND ((original_price - price) / original_price * 100) >= $${i++}`; params.push(Number(minDiscount)); }

    sql += sort === 'price_asc' ? ` ORDER BY price ASC` : sort === 'price_desc' ? ` ORDER BY price DESC` : ` ORDER BY id DESC`;
    sql += ` LIMIT 200`;

    const result = await pool.query(sql, params);
    let rows = result.rows;
    
    // סינון color+size ב-JS: אם שניהם צוינו, נבדוק ב-color_sizes שהצבע זמין במידה
    if (color && size) {
      const sizeList = size.split(',').filter(Boolean);
      const allExpandedSizes = [];
      sizeList.forEach(s => expandSize(s).forEach(es => { if (!allExpandedSizes.includes(es)) allExpandedSizes.push(es); }));
      const colorList = color.split(',').filter(Boolean);
      rows = rows.filter(p => {
        if (!p.color_sizes) return true; // אין מידע - מציג
        try {
          const cs = typeof p.color_sizes === 'string' ? JSON.parse(p.color_sizes) : p.color_sizes;
          if (!cs || Object.keys(cs).length === 0) return true;
          // Check if ANY selected color has ANY selected size
          return colorList.some(c => {
            const colorSizes = cs[c];
            if (!colorSizes) return false;
            return allExpandedSizes.some(sz => colorSizes.includes(sz));
          });
        } catch(e) { return true; }
      });
    }
    
    res.json(rows.map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) })));
  } catch (err) {
    console.error("products error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

app.get("/api/product/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const result = await pool.query(`SELECT * FROM products WHERE id = $1`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    const product = result.rows[0];
    product.shipping = calculateShipping(product.store, product.price);
    res.json(product);
  } catch (err) {
    console.error("product error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

app.post("/api/ai-search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || query.trim().length < 2) return res.status(400).json({ error: "Query too short" });
    const analysis = analyzeQuery(query);
    
    let sql = `SELECT id, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, store, source_url, description, pattern, fabric, design_details, color_sizes FROM products WHERE 1=1`;
    const params = [];
    let i = 1;

    if (analysis.keywords.length > 0) { sql += ` AND title ILIKE $${i++}`; params.push(`%${analysis.keywords.join(' ')}%`); }
    if (analysis.store) { sql += ` AND store = $${i++}`; params.push(analysis.store); }
    
    if (analysis.color) { sql += ` AND (color = $${i} OR $${i} = ANY(colors))`; params.push(analysis.color); i++; }
    if (analysis.size) {
      const expandedSizes = expandSize(analysis.size);
      if (expandedSizes.length === 1) {
        sql += ` AND $${i} = ANY(sizes)`;
        params.push(expandedSizes[0]); i++;
      } else {
        sql += ` AND sizes && $${i}::text[]`;
        params.push(expandedSizes); i++;
      }
    }
    if (analysis.category) { sql += ` AND (category = $${i} OR title ILIKE $${i+1})`; params.push(analysis.category, `%${analysis.category}%`); i += 2; }
    if (analysis.style) { sql += ` AND (style = $${i} OR title ILIKE $${i+1})`; params.push(analysis.style, `%${analysis.style}%`); i += 2; }
    if (analysis.fit) { sql += ` AND (fit = $${i} OR title ILIKE $${i+1})`; params.push(analysis.fit, `%${analysis.fit}%`); i += 2; }
    if (analysis.fabric) { sql += ` AND (fabric = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(analysis.fabric, `%${analysis.fabric}%`); i += 2; }
    if (analysis.pattern) { sql += ` AND (pattern = $${i} OR title ILIKE $${i+1} OR description ILIKE $${i+1})`; params.push(analysis.pattern, `%${analysis.pattern}%`); i += 2; }
    if (analysis.designDetails.length > 0) { sql += ` AND $${i++} = ANY(design_details)`; params.push(analysis.designDetails[0]); }
    if (analysis.maxPrice) { sql += ` AND price <= $${i++}`; params.push(analysis.maxPrice); }
    if (analysis.minDiscount) { sql += ` AND original_price > 0 AND ((original_price - price) / original_price * 100) >= $${i++}`; params.push(analysis.minDiscount); }

    sql += ` ORDER BY id DESC LIMIT 100`;
    const result = await pool.query(sql, params);
    let rows = result.rows;
    
    // סינון color+size ב-JS
    if (analysis.color && analysis.size) {
      const expandedSizes = expandSize(analysis.size);
      rows = rows.filter(p => {
        if (!p.color_sizes) return true;
        try {
          const cs = typeof p.color_sizes === 'string' ? JSON.parse(p.color_sizes) : p.color_sizes;
          if (!cs || Object.keys(cs).length === 0) return true;
          const colorSizes = cs[analysis.color];
          if (!colorSizes) return false;
          return expandedSizes.some(sz => colorSizes.includes(sz));
        } catch(e) { return true; }
      });
    }
    
    res.json({ query, analysis, results: rows.map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) })), count: rows.length });
  } catch (err) {
    console.error("ai-search error:", err.message);
    res.status(500).json({ error: "Search error" });
  }
});

function analyzeQuery(query) {
  const analysis = { keywords: [], color: null, size: null, style: null, fit: null, category: null, maxPrice: null, minDiscount: null, pattern: null, fabric: null, designDetails: [], store: null };
  
  const priceMatch = query.match(/\u05e2\u05d3\s*\u20aa?\s*(\d+)|(\d+)\s*\u20aa|(\d+)\s*\u05e9"?\u05d7/i);
  if (priceMatch) analysis.maxPrice = parseInt(priceMatch[1] || priceMatch[2] || priceMatch[3]);
  
  const discountMatch = query.match(/(\d+)\s*%/i);
  if (discountMatch) analysis.minDiscount = parseInt(discountMatch[1]);

  // חנויות
  const storeMap = {
    'MEKIMI': ['mekimi', '\u05de\u05e7\u05d9\u05de\u05d9'],
    'LICHI': ['lichi', '\u05dc\u05d9\u05e6\u05f3\u05d9', '\u05dc\u05d9\u05e6\u05d9'],
    'MIMA': ['mima', '\u05de\u05d9\u05de\u05d4', '\u05de\u05d9\u05de\u05d0']
  };

  // מיפוי מידות עברית -> אנגלית
  const hebrewSizeMap = {
    'XS': ['\u05d0\u05e7\u05e1\u05d8\u05e8\u05d4 \u05e1\u05de\u05d5\u05dc', '\u05d0\u05e7\u05e1 \u05e1\u05de\u05d5\u05dc'],
    'S': ['\u05e1\u05de\u05d5\u05dc', '\u05e1\u05de\u05d0\u05dc', '\u05e7\u05d8\u05df', '\u05e7\u05d8\u05e0\u05d4'],
    'M': ['\u05de\u05d3\u05d9\u05d5\u05dd', '\u05de\u05d9\u05d3\u05d9\u05d5\u05dd', '\u05d1\u05d9\u05e0\u05d5\u05e0\u05d9', '\u05d1\u05d9\u05e0\u05d5\u05e0\u05d9\u05ea'],
    'L': ['\u05dc\u05d0\u05e8\u05d2\u05f3', '\u05dc\u05d0\u05e8\u05d2', '\u05d2\u05d3\u05d5\u05dc', '\u05d2\u05d3\u05d5\u05dc\u05d4'],
    'XL': ['\u05d0\u05e7\u05e1 \u05dc\u05d0\u05e8\u05d2\u05f3', '\u05d0\u05e7\u05e1\u05d8\u05e8\u05d4 \u05dc\u05d0\u05e8\u05d2'],
    'XXL': ['\u05d3\u05d0\u05d1\u05dc \u05d0\u05e7\u05e1 \u05dc\u05d0\u05e8\u05d2']
  };

  // פרסור "מידהM" ללא רווח - regex שמוצא מידה+אות דבוקות
  let processedQuery = query;
  const sizeStuckPattern = /\u05de\u05d9\u05d3\u05d4\s*(XS|S|M|L|XL|XXL|XXXL|\d{2})/i;
  const sizeStuckMatch = processedQuery.match(sizeStuckPattern);
  if (sizeStuckMatch) {
    analysis.size = sizeStuckMatch[1].toUpperCase();
    processedQuery = processedQuery.replace(sizeStuckPattern, '').trim();
  }

  const colorMap = { 
    '\u05e9\u05d7\u05d5\u05e8': ['\u05e9\u05d7\u05d5\u05e8', '\u05e9\u05d7\u05d5\u05e8\u05d4'], 
    '\u05dc\u05d1\u05df': ['\u05dc\u05d1\u05df', '\u05dc\u05d1\u05e0\u05d4'], 
    '\u05db\u05d7\u05d5\u05dc': ['\u05db\u05d7\u05d5\u05dc', '\u05db\u05d7\u05d5\u05dc\u05d4', '\u05e0\u05d9\u05d9\u05d1\u05d9'], 
    '\u05d0\u05d3\u05d5\u05dd': ['\u05d0\u05d3\u05d5\u05dd', '\u05d0\u05d3\u05d5\u05de\u05d4'], 
    '\u05d9\u05e8\u05d5\u05e7': ['\u05d9\u05e8\u05d5\u05e7', '\u05d9\u05e8\u05d5\u05e7\u05d4', '\u05d6\u05d9\u05ea', '\u05d7\u05d0\u05e7\u05d9'], 
    '\u05d7\u05d5\u05dd': ['\u05d7\u05d5\u05dd', '\u05d7\u05d5\u05de\u05d4'], 
    '\u05d1\u05d6\u05f3': ['\u05d1\u05d6\u05f3', '\u05d1\u05d6', '\u05e0\u05d9\u05d5\u05d3'], 
    '\u05d0\u05e4\u05d5\u05e8': ['\u05d0\u05e4\u05d5\u05e8', '\u05d0\u05e4\u05d5\u05e8\u05d4'], 
    '\u05d5\u05e8\u05d5\u05d3': ['\u05d5\u05e8\u05d5\u05d3', '\u05d5\u05e8\u05d5\u05d3\u05d4'], 
    '\u05d1\u05d5\u05e8\u05d3\u05d5': ['\u05d1\u05d5\u05e8\u05d3\u05d5'], 
    '\u05e9\u05de\u05e0\u05ea': ['\u05e9\u05de\u05e0\u05ea', 'cream'], 
    '\u05e1\u05d2\u05d5\u05dc': ['\u05e1\u05d2\u05d5\u05dc', '\u05e1\u05d2\u05d5\u05dc\u05d4', '\u05dc\u05d9\u05dc\u05da'],
    '\u05e6\u05d4\u05d5\u05d1': ['\u05e6\u05d4\u05d5\u05d1', '\u05e6\u05d4\u05d5\u05d1\u05d4', '\u05d7\u05e8\u05d3\u05dc'],
    '\u05db\u05ea\u05d5\u05dd': ['\u05db\u05ea\u05d5\u05dd', '\u05db\u05ea\u05d5\u05de\u05d4'],
    '\u05ea\u05db\u05dc\u05ea': ['\u05ea\u05db\u05dc\u05ea'],
    '\u05d6\u05d4\u05d1': ['\u05d6\u05d4\u05d1', '\u05d6\u05d4\u05d5\u05d1\u05d4'],
    '\u05db\u05e1\u05e3': ['\u05db\u05e1\u05e3', '\u05db\u05e1\u05d5\u05e4\u05d4'],
    '\u05e7\u05d0\u05de\u05dc': ['\u05e7\u05d0\u05de\u05dc'],
    '\u05d0\u05d1\u05df': ['\u05d0\u05d1\u05df', 'stone']
  };
  const categoryMap = { 
    '\u05e9\u05de\u05dc\u05d4': ['\u05e9\u05de\u05dc\u05d4', '\u05e9\u05de\u05dc\u05ea', '\u05e9\u05de\u05dc\u05d5\u05ea'], 
    '\u05d7\u05d5\u05dc\u05e6\u05d4': ['\u05d7\u05d5\u05dc\u05e6\u05d4', '\u05d7\u05d5\u05dc\u05e6\u05ea', '\u05d8\u05d5\u05e4'], 
    '\u05d7\u05e6\u05d0\u05d9\u05ea': ['\u05d7\u05e6\u05d0\u05d9\u05ea', '\u05d7\u05e6\u05d0\u05d9\u05d5\u05ea'], 
    '\u05de\u05db\u05e0\u05e1\u05d9\u05d9\u05dd': ['\u05de\u05db\u05e0\u05e1', '\u05de\u05db\u05e0\u05e1\u05d9\u05d9\u05dd'], 
    '\u05e7\u05e8\u05d3\u05d9\u05d2\u05df': ['\u05e7\u05e8\u05d3\u05d9\u05d2\u05df'],
    '\u05e1\u05d5\u05d5\u05d3\u05e8': ['\u05e1\u05d5\u05d5\u05d3\u05e8'],
    '\u05d8\u05d5\u05e0\u05d9\u05e7\u05d4': ['\u05d8\u05d5\u05e0\u05d9\u05e7\u05d4'],
    '\u05e1\u05e8\u05e4\u05df': ['\u05e1\u05e8\u05e4\u05df'],
    '\u05d6\u05f3\u05e7\u05d8': ['\u05d6\u05f3\u05e7\u05d8', '\u05d2\u05f3\u05e7\u05d8'],
    '\u05d1\u05dc\u05d9\u05d9\u05d6\u05e8': ['\u05d1\u05dc\u05d9\u05d9\u05d6\u05e8'],
    '\u05d5\u05e1\u05d8': ['\u05d5\u05e1\u05d8'],
    '\u05e2\u05dc\u05d9\u05d5\u05e0\u05d9\u05ea': ['\u05e2\u05dc\u05d9\u05d5\u05e0\u05d9\u05ea'],
    '\u05de\u05e2\u05d9\u05dc': ['\u05de\u05e2\u05d9\u05dc'],
    '\u05e1\u05d8': ['\u05e1\u05d8'],
    '\u05d1\u05d9\u05d9\u05e1\u05d9\u05e7': ['\u05d1\u05d9\u05d9\u05e1\u05d9\u05e7', 'basic'],
    '\u05e9\u05db\u05de\u05d9\u05d4': ['\u05e9\u05db\u05de\u05d9\u05d4'],
    '\u05d7\u05dc\u05d5\u05e7': ['\u05d7\u05dc\u05d5\u05e7', '\u05d0\u05d9\u05e8\u05d5\u05d7']
  };
  const styleMap = {
    '\u05e2\u05e8\u05d1': ['\u05e2\u05e8\u05d1', '\u05e9\u05d1\u05ea', '\u05e9\u05d1\u05ea\u05d9'],
    '\u05d7\u05d2\u05d9\u05d2\u05d9': ['\u05d7\u05d2\u05d9\u05d2\u05d9', '\u05d7\u05d2\u05d9\u05d2\u05d9\u05ea'],
    '\u05d0\u05dc\u05d2\u05e0\u05d8\u05d9': ['\u05d0\u05dc\u05d2\u05e0\u05d8', '\u05d0\u05dc\u05d2\u05e0\u05d8\u05d9', '\u05d0\u05dc\u05d2\u05e0\u05d8\u05d9\u05ea'],
    '\u05e7\u05dc\u05d0\u05e1\u05d9': ['\u05e7\u05dc\u05d0\u05e1\u05d9', '\u05e7\u05dc\u05d0\u05e1\u05d9\u05ea'],
    '\u05de\u05d9\u05e0\u05d9\u05de\u05dc\u05d9\u05e1\u05d8\u05d9': ['\u05de\u05d9\u05e0\u05d9\u05de\u05dc\u05d9\u05e1\u05d8', '\u05de\u05d9\u05e0\u05d9\u05de\u05dc\u05d9\u05e1\u05d8\u05d9'],
    '\u05de\u05d5\u05d3\u05e8\u05e0\u05d9': ['\u05de\u05d5\u05d3\u05e8\u05e0\u05d9', '\u05de\u05d5\u05d3\u05e8\u05e0\u05d9\u05ea'],
    '\u05d9\u05d5\u05dd \u05d7\u05d5\u05dc': ['\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9', '\u05d9\u05d5\u05de\u05d9\u05d5\u05de\u05d9\u05ea', '\u05e7\u05d6\u05f3\u05d5\u05d0\u05dc', '\u05e7\u05d6\u05d5\u05d0\u05dc'],
    '\u05e8\u05d8\u05e8\u05d5': ['\u05e8\u05d8\u05e8\u05d5', '\u05d5\u05d9\u05e0\u05d8\u05d2\u05f3'],
    '\u05d0\u05d5\u05d1\u05e8\u05e1\u05d9\u05d9\u05d6': ['\u05d0\u05d5\u05d1\u05e8\u05e1\u05d9\u05d9\u05d6', 'oversize']
  };
  const fitMap = {
    '\u05d0\u05e8\u05d5\u05db\u05d4': ['\u05de\u05e7\u05e1\u05d9', '\u05d0\u05e8\u05d5\u05db\u05d4', '\u05d0\u05e8\u05d5\u05da', 'maxi'],
    '\u05de\u05d9\u05d3\u05d9': ['\u05de\u05d9\u05d3\u05d9', 'midi', '\u05d0\u05de\u05e6\u05e2'],
    '\u05e7\u05e6\u05e8\u05d4': ['\u05e7\u05e6\u05e8\u05d4', '\u05e7\u05e6\u05e8', '\u05de\u05d9\u05e0\u05d9', 'mini'],
    '\u05de\u05e2\u05d8\u05e4\u05ea': ['\u05de\u05e2\u05d8\u05e4\u05ea', '\u05de\u05e2\u05d8\u05e4\u05d4', 'wrap'],
    '\u05d4\u05e8\u05d9\u05d5\u05df': ['\u05d4\u05e8\u05d9\u05d5\u05df', 'maternity', 'pregnancy'],
    '\u05d4\u05e0\u05e7\u05d4': ['\u05d4\u05e0\u05e7\u05d4', 'nursing', 'breastfeed'],
    '\u05de\u05d5\u05ea\u05df': ['\u05de\u05d5\u05ea\u05df', '\u05d1\u05de\u05d5\u05ea\u05df', 'waist']
  };
  // בד
  const fabricMap = {
    '\u05e1\u05e8\u05d9\u05d2': ['\u05e1\u05e8\u05d9\u05d2'],
    '\u05d0\u05e8\u05d9\u05d2': ['\u05d0\u05e8\u05d9\u05d2'],
    '\u05d2\u05f3\u05e8\u05e1\u05d9': ['\u05d2\u05f3\u05e8\u05e1\u05d9', '\u05d2\u05e8\u05e1\u05d9', '\u05d2\'\u05e8\u05e1\u05d9', 'jersey'],
    '\u05e9\u05d9\u05e4\u05d5\u05df': ['\u05e9\u05d9\u05e4\u05d5\u05df', 'chiffon'],
    '\u05e7\u05e8\u05e4': ['\u05e7\u05e8\u05e4', 'crepe'],
    '\u05e1\u05d0\u05d8\u05df': ['\u05e1\u05d0\u05d8\u05df', 'satin', '\u05e1\u05d8\u05df'],
    '\u05e7\u05d8\u05d9\u05e4\u05d4': ['\u05e7\u05d8\u05d9\u05e4\u05d4', 'velvet'],
    '\u05e4\u05dc\u05d9\u05d6': ['\u05e4\u05dc\u05d9\u05d6', 'fleece'],
    '\u05ea\u05d7\u05e8\u05d4': ['\u05ea\u05d7\u05e8\u05d4', 'lace'],
    '\u05d8\u05d5\u05dc': ['\u05d8\u05d5\u05dc', 'tulle'],
    '\u05dc\u05d9\u05d9\u05e7\u05e8\u05d4': ['\u05dc\u05d9\u05d9\u05e7\u05e8\u05d4', 'lycra'],
    '\u05d8\u05e8\u05d9\u05e7\u05d5': ['\u05d8\u05e8\u05d9\u05e7\u05d5', 'tricot'],
    '\u05e8\u05e9\u05ea': ['\u05e8\u05e9\u05ea'],
    '\u05d2\u05f3\u05d9\u05e0\u05e1': ['\u05d2\u05f3\u05d9\u05e0\u05e1', 'jeans', '\u05d3\u05e0\u05d9\u05dd'],
    '\u05e7\u05d5\u05e8\u05d3\u05e8\u05d5\u05d9': ['\u05e7\u05d5\u05e8\u05d3\u05e8\u05d5\u05d9', 'corduroy'],
    '\u05e4\u05d9\u05e7\u05d4': ['\u05e4\u05d9\u05e7\u05d4', 'pique'],
    'פרווה': ['פרווה', 'fur', 'faux fur'],
    '\u05db\u05d5\u05ea\u05e0\u05d4': ['\u05db\u05d5\u05ea\u05e0\u05d4', 'cotton'],
    '\u05e4\u05e9\u05ea\u05df': ['\u05e4\u05e9\u05ea\u05df', 'linen'],
    '\u05de\u05e9\u05d9': ['\u05de\u05e9\u05d9', 'silk'],
    '\u05e6\u05de\u05e8': ['\u05e6\u05de\u05e8', 'wool'],
    '\u05e8\u05d9\u05e7\u05de\u05d4': ['\u05e8\u05d9\u05e7\u05de\u05d4', '\u05e8\u05e7\u05d5\u05de\u05d4', '\u05e8\u05e7\u05d5\u05dd', '\u05e8\u05e7\u05de\u05d4', '\u05e8\u05e7\u05de\u05d0', 'embroidery', 'embroidered']
  };
  // דוגמא
  const patternMap = {
    '\u05e4\u05e1\u05d9\u05dd': ['\u05e4\u05e1\u05d9\u05dd', 'stripes'],
    '\u05e4\u05e8\u05d7\u05d5\u05e0\u05d9': ['\u05e4\u05e8\u05d7\u05d5\u05e0\u05d9', '\u05e4\u05e8\u05d7\u05d9\u05dd', 'floral'],
    '\u05de\u05e9\u05d1\u05e6\u05d5\u05ea': ['\u05de\u05e9\u05d1\u05e6\u05d5\u05ea', 'plaid'],
    '\u05e0\u05e7\u05d5\u05d3\u05d5\u05ea': ['\u05e0\u05e7\u05d5\u05d3\u05d5\u05ea', 'dots', 'polka'],
    '\u05d7\u05dc\u05e7': ['\u05d7\u05dc\u05e7', 'plain'],
    '\u05d4\u05d3\u05e4\u05e1': ['\u05d4\u05d3\u05e4\u05e1', 'print', '\u05de\u05d5\u05d3\u05e4\u05e1']
  };
  // עיצוב
  const designMap = {
    '\u05e6\u05d5\u05d5\u05d0\u05e8\u05d5\u05df V': ['\u05e6\u05d5\u05d5\u05d0\u05e8\u05d5\u05df V', 'v-neck'],
    '\u05d2\u05d5\u05dc\u05e3': ['\u05d2\u05d5\u05dc\u05e3', 'turtleneck'],
    '\u05db\u05e4\u05ea\u05d5\u05e8\u05d9\u05dd': ['\u05db\u05e4\u05ea\u05d5\u05e8\u05d9\u05dd', 'buttons'],
    '\u05d7\u05d2\u05d5\u05e8\u05d4': ['\u05d7\u05d2\u05d5\u05e8\u05d4', 'belt'],
    '\u05e9\u05e1\u05e2': ['\u05e9\u05e1\u05e2', 'slit'],
    '\u05db\u05d9\u05e1\u05d9\u05dd': ['\u05db\u05d9\u05e1\u05d9\u05dd', 'pockets'],
    '\u05e7\u05e9\u05d9\u05e8\u05d4': ['\u05e7\u05e9\u05d9\u05e8\u05d4', 'tie'],
    '\u05e7\u05e4\u05dc\u05d9\u05dd': ['\u05e7\u05e4\u05dc\u05d9\u05dd', 'pleats'],
    '\u05de\u05dc\u05de\u05dc\u05d4': ['\u05de\u05dc\u05de\u05dc\u05d4', 'ruffle'],
    '\u05e4\u05e4\u05dc\u05d5\u05dd': ['\u05e4\u05e4\u05dc\u05d5\u05dd', 'peplum']
  };
  const sizeList = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '36', '38', '40', '42', '44'];
  // מילות עצירה - מילים שמופיעות בחיפוש אבל לא צריכות להיות keywords
  const stopWords = new Set(['מידה', 'מידות', 'עד', 'של', 'עם', 'בלי', 'ללא', 'או', 'גם', 'רק', 'כל', 'את', 'זה', 'זו', 'הנחה', 'מבצע', 'sale', 'לי', 'אני', 'רוצה', 'מחפשת', 'מחפש', 'צבע', 'סגנון', 'גיזרה', 'בד', 'דוגמא', 'מחיר', 'שקל', 'שקלים', 'ש"ח', 'שח', 'אורך', 'באורך', 'חנות', 'באתר', 'מאתר', 'ב', 'מ']);
  // קטגוריות שלא מציגים (אקססוריז)
  const excludedCategories = new Set(['גומיות', 'גומייה', 'אקססוריז', 'אביזרים', 'תכשיטים', 'כובעים', 'צעיפים', 'תיקים']);


  // === שלב 1: בדיקת ביטויים רב-מילתיים BEFORE פירוק למילים ===
  const fullText = processedQuery.replace(/\u05e2\u05d3\s*\u20aa?\s*\d+/gi, '').replace(/\d+\s*\u20aa/gi, '').replace(/\d+\s*%/gi, '').trim();
  const usedRanges = []; // track which char ranges were matched by phrases
  
  // Multi-word design details
  const multiWordDesign = {
    'שרוול ארוך': 'שרוול ארוך',
    'שרוול קצר': 'שרוול קצר',
    'שרוול 3/4': 'שרוול 3/4',
    'שרוול פעמון': 'שרוול פעמון',
    'שרוול נפוח': 'שרוול נפוח',
    'ללא שרוולים': 'ללא שרוולים',
    'כתפיים חשופות': 'כתפיים חשופות',
    'צווארון עגול': 'צווארון עגול',
    'צווארון V': 'צווארון V',
    'צווארון סירה': 'צווארון סירה'
  };
  
  for (const [phrase, designName] of Object.entries(multiWordDesign)) {
    if (fullText.includes(phrase)) {
      analysis.designDetails.push(designName);
      const idx = fullText.indexOf(phrase);
      usedRanges.push([idx, idx + phrase.length]);
    }
  }

  const text = processedQuery.replace(/\u05e2\u05d3\s*\u20aa?\s*\d+/gi, '').replace(/\d+\s*\u20aa/gi, '').replace(/\d+\s*%/gi, '').trim();
  const words = text.split(/\s+/).filter(w => w.length >= 1);

  for (const word of words) {
    const upper = word.toUpperCase();
    const lower = word.toLowerCase();
    
    // === קודם כל: דלג על מילים שנתפסו כחלק מביטוי רב-מילתי ===
    if (usedRanges.length > 0) {
      const wordIdx = fullText.indexOf(word);
      if (wordIdx >= 0 && usedRanges.some(([s,e]) => wordIdx >= s && wordIdx < e)) continue;
    }
    
    if (sizeList.includes(upper) && !analysis.size) { analysis.size = upper; continue; }
    
    // בדיקת מידות בעברית
    let sizeMatched = false;
    if (!analysis.size) {
      for (const [sizeName, variants] of Object.entries(hebrewSizeMap)) {
        if (variants.some(v => lower === v.toLowerCase())) { analysis.size = sizeName; sizeMatched = true; break; }
      }
    }
    if (sizeMatched) continue;
    
    let matched = false;
    
    // חנות
    if (!matched) {
      for (const [name, variants] of Object.entries(storeMap)) {
        if (variants.some(v => lower === v.toLowerCase()) || lower === name.toLowerCase()) { if (!analysis.store) analysis.store = name; matched = true; break; }
      }
    }
    if (!matched) {
    for (const [name, variants] of Object.entries(colorMap)) {
      if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.color) analysis.color = name; matched = true; break; }
    }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(categoryMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.category) analysis.category = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(styleMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.style) analysis.style = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(fitMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.fit) analysis.fit = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(fabricMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.fabric) analysis.fabric = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(patternMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { if (!analysis.pattern) analysis.pattern = name; matched = true; break; }
      }
    }
    if (!matched) {
      for (const [name, variants] of Object.entries(designMap)) {
        if (variants.some(v => word.toLowerCase() === v.toLowerCase())) { analysis.designDetails.push(name); matched = true; break; }
      }
    }
    
    if (!matched && !sizeList.includes(upper) && word.length >= 2 && !stopWords.has(word)) {
      analysis.keywords.push(word);
    }
  }

  return analysis;
}

app.get("/out/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).send("Invalid id");
  try {
    const p = await pool.query(`SELECT source_url, store, title FROM products WHERE id = $1`, [id]);
    if (!p.rows.length) return res.status(404).send("Not found");
    // שמירת הלחיצה
    try {
      await pool.query(
        `INSERT INTO clicks (product_id, store, product_title, source_url, user_agent, ip_address, clicked_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [id, p.rows[0].store, p.rows[0].title, p.rows[0].source_url, req.headers['user-agent'] || '', req.ip || '']
      );
    } catch(e) { console.error('click track error:', e.message); }
    res.redirect(p.rows[0].source_url);
  } catch (err) { res.status(500).send("Error"); }
});

// API לצפייה בנתוני לחיצות
app.get("/api/clicks", async (req, res) => {
  try {
    const { days } = req.query;
    const daysBack = parseInt(days) || 30;
    const result = await pool.query(`
      SELECT c.id, c.product_id, c.store, c.product_title, c.source_url, c.clicked_at, c.user_agent, c.ip_address
      FROM clicks c
      WHERE c.clicked_at >= NOW() - INTERVAL '${daysBack} days'
      ORDER BY c.clicked_at DESC
      LIMIT 500
    `);
    res.json({ total: result.rows.length, clicks: result.rows });
  } catch (err) {
    console.error("clicks error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

// סטטיסטיקות לחיצות
app.get("/api/clicks/stats", async (req, res) => {
  try {
    const [total, byStore, byDay, topProducts] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM clicks`),
      pool.query(`SELECT store, COUNT(*) as count FROM clicks GROUP BY store ORDER BY count DESC`),
      pool.query(`SELECT DATE(clicked_at) as day, COUNT(*) as count FROM clicks WHERE clicked_at >= NOW() - INTERVAL '30 days' GROUP BY DATE(clicked_at) ORDER BY day DESC`),
      pool.query(`SELECT product_id, product_title, store, COUNT(*) as count FROM clicks GROUP BY product_id, product_title, store ORDER BY count DESC LIMIT 20`)
    ]);
    res.json({
      total: parseInt(total.rows[0]?.total) || 0,
      byStore: byStore.rows,
      byDay: byDay.rows,
      topProducts: topProducts.rows
    });
  } catch (err) {
    console.error("clicks stats error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});
app.get("/api/debug/db", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        current_database() AS db,
        inet_server_addr() AS server_ip,
        inet_server_port() AS server_port,
        (SELECT COUNT(*) FROM public.products)::int AS products_count
    `);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});


// ===== AUTH HELPERS =====
const JWT_SECRET = process.env.JWT_SECRET || "lookli_secret_2026_change_in_prod";

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = createHmac("sha256", salt).update(password).digest("hex");
  return check === hash;
}

function createToken(userId, email) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 })).toString("base64url");
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, payload, sig] = token.split(".");
    const check = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
    if (check !== sig) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch(e) { return null; }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "לא מחובר" });
  const data = verifyToken(token);
  if (!data) return res.status(401).json({ error: "פג תוקף החיבור" });
  req.userId = data.sub;
  req.userEmail = data.email;
  next();
}

// POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: "אימייל וסיסמה חובה" });
    if (password.length < 6) return res.status(400).json({ error: "סיסמה חייבת לפחות 6 תווים" });
    const emailLower = email.toLowerCase().trim();
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [emailLower]);
    if (existing.rows.length > 0) return res.status(409).json({ error: "אימייל כבר רשום" });
    const hash = hashPassword(password);
    const result = await pool.query(
      "INSERT INTO users(email, password_hash, name) VALUES($1,$2,$3) RETURNING id, email, name, plan, created_at",
      [emailLower, hash, name || null]
    );
    const user = result.rows[0];
    const token = createToken(user.id, user.email);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch (e) {
    console.error("register error:", e.message);
    if (e.message.includes("users") && e.message.includes("exist")) {
      return res.status(500).json({ error: "טבלת משתמשים לא קיימת - הרץ schema_users.sql" });
    }
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "אימייל וסיסמה חובה" });
    const emailLower = email.toLowerCase().trim();
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [emailLower]);
    if (result.rows.length === 0) return res.status(401).json({ error: "אימייל או סיסמה שגויים" });
    const user = result.rows[0];
    if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: "אימייל או סיסמה שגויים" });
    const token = createToken(user.id, user.email);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch (e) {
    console.error("login error:", e.message);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// GET /api/auth/me
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, email, name, plan, created_at FROM users WHERE id=$1", [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "משתמש לא נמצא" });
    res.json({ user: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// POST /api/saved - save a product
app.post("/api/saved", authMiddleware, async (req, res) => {
  try {
    const { source_url, title, price, image, store } = req.body;
    if (!source_url) return res.status(400).json({ error: "חסר URL" });
    await pool.query(
      `INSERT INTO saved_products(user_id, product_source_url, product_title, product_price, product_image, product_store)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id, product_source_url) DO NOTHING`,
      [req.userId, source_url, title || null, price || null, image || null, store || null]
    );
    res.json({ saved: true });
  } catch (e) {
    console.error("save error:", e.message);
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// DELETE /api/saved - remove saved product
app.delete("/api/saved", authMiddleware, async (req, res) => {
  try {
    const { source_url } = req.body;
    await pool.query("DELETE FROM saved_products WHERE user_id=$1 AND product_source_url=$2", [req.userId, source_url]);
    res.json({ removed: true });
  } catch (e) {
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// GET /api/saved - get all saved products
app.get("/api/saved", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM saved_products WHERE user_id=$1 ORDER BY saved_at DESC",
      [req.userId]
    );
    res.json({ saved: result.rows });
  } catch (e) {
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// POST /api/saved/check - batch check saved status
app.post("/api/saved/check", authMiddleware, async (req, res) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) return res.json({ saved: [] });
    const result = await pool.query(
      "SELECT product_source_url FROM saved_products WHERE user_id=$1 AND product_source_url=ANY($2)",
      [req.userId, urls]
    );
    res.json({ saved: result.rows.map(r => r.product_source_url) });
  } catch (e) {
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  // יצירת טבלת clicks אוטומטית אם לא קיימת
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS clicks (
      id SERIAL PRIMARY KEY,
      product_id INTEGER,
      store VARCHAR(50),
      product_title TEXT,
      source_url TEXT,
      user_agent TEXT,
      ip_address VARCHAR(100),
      clicked_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at DESC)`);
  } catch(e) { console.error('clicks table init:', e.message); }
});