import express from "express";
import pkg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;

// Database connection - supports both DATABASE_URL and individual vars
// Database connection - supports both DATABASE_URL and individual vars
const connStr = process.env.DATABASE_URL;

const useSSL =
  !!connStr && (connStr.includes("proxy.rlwy.net") || connStr.includes("rlwy.net"));

const pool = new Pool(
  connStr
    ? { connectionString: connStr, ssl: useSSL ? { rejectUnauthorized: false } : undefined }
    : {
        user: process.env.DB_USER || "postgres",
        host: process.env.DB_HOST || "localhost",
        database: process.env.DB_NAME || "fashion_aggregator",
        password: process.env.DB_PASSWORD || "1423",
        port: parseInt(process.env.DB_PORT) || 5432,
      }
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const validColors = ['שחור', 'לבן', 'שמנת', 'כחול', 'תכלת', 'נייבי', 'אדום', 'בורדו', 'ירוק', 'זית', 'חאקי', 'חום', 'קאמל', 'בז׳', 'ניוד', 'אפור', 'ורוד', 'סגול', 'לילך', 'צהוב', 'חרדל', 'כתום', 'זהב', 'כסף'];

const shippingInfo = {
  'MEKIMI': { cost: 25, threshold: 300 },
  'LICHI': { cost: 30, threshold: 350 }
};

function calculateShipping(store, price) {
  const info = shippingInfo[store] || { cost: 30, threshold: 300 };
  const isFree = price >= info.threshold;
  return { cost: isFree ? 0 : info.cost, isFree, threshold: info.threshold };
}

app.get("/api/filters", async (req, res) => {
  try {
    const { store, category, color, size, style, fit, fabric, pattern } = req.query;
    let baseWhere = '1=1';
    const baseParams = [];
    let paramIndex = 1;
    
    if (store) { baseWhere += ` AND store = $${paramIndex++}`; baseParams.push(store); }
    if (category) { baseWhere += ` AND (category = $${paramIndex} OR title ILIKE $${paramIndex + 1})`; baseParams.push(category, `%${category}%`); paramIndex += 2; }
    if (style) { baseWhere += ` AND (style = $${paramIndex} OR title ILIKE $${paramIndex + 1})`; baseParams.push(style, `%${style}%`); paramIndex += 2; }
    if (fit) { baseWhere += ` AND (fit = $${paramIndex} OR title ILIKE $${paramIndex + 1})`; baseParams.push(fit, `%${fit}%`); paramIndex += 2; }
    if (color) { baseWhere += ` AND (color = $${paramIndex} OR $${paramIndex} = ANY(colors))`; baseParams.push(color); paramIndex++; }
    if (size) { baseWhere += ` AND $${paramIndex} = ANY(sizes)`; baseParams.push(size); paramIndex++; }
    
    const [storesRes, sizesRes, colorsRes, stylesRes, fitsRes, categoriesRes, maxPriceRes] = await Promise.all([
      pool.query(`SELECT DISTINCT store FROM products WHERE ${baseWhere} AND store IS NOT NULL ORDER BY store`, baseParams),
      pool.query(`SELECT DISTINCT unnest(sizes) AS size FROM products WHERE ${baseWhere} AND sizes IS NOT NULL`, baseParams),
      pool.query(`SELECT DISTINCT color FROM products WHERE ${baseWhere} AND color IS NOT NULL AND color != '' ORDER BY color`, baseParams),
      pool.query(`SELECT DISTINCT style FROM products WHERE ${baseWhere} AND style IS NOT NULL AND style != '' ORDER BY style`, baseParams),
      pool.query(`SELECT DISTINCT fit FROM products WHERE ${baseWhere} AND fit IS NOT NULL AND fit != '' ORDER BY fit`, baseParams),
      pool.query(`SELECT DISTINCT category FROM products WHERE ${baseWhere} AND category IS NOT NULL AND category != '' ORDER BY category`, baseParams),
      pool.query(`SELECT MAX(price) as max_price FROM products WHERE ${baseWhere} AND price > 0`, baseParams)
    ]);

    const validColorSet = new Set(validColors);
    res.json({
      stores: storesRes.rows.map(r => r.store).filter(Boolean),
      sizes: sizesRes.rows.map(r => r.size).filter(Boolean),
      colors: colorsRes.rows.map(r => r.color).filter(c => c && validColorSet.has(c)),
      styles: stylesRes.rows.map(r => r.style).filter(Boolean),
      fits: fitsRes.rows.map(r => r.fit).filter(Boolean),
      categories: categoriesRes.rows.map(r => r.category).filter(Boolean),
      maxPrice: Math.ceil(parseFloat(maxPriceRes.rows[0]?.max_price) || 500)
    });
  } catch (err) {
    console.error("filters error:", err.message);
    res.status(500).json({ error: "DB error" });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const { q, color, size, store, style, fit, category, maxPrice, sort, minDiscount, fabric, pattern } = req.query;
    let sql = `SELECT id, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, store, source_url, description FROM products WHERE 1=1`;
    const params = [];
    let i = 1;

    if (q) { sql += ` AND title ILIKE $${i++}`; params.push(`%${q}%`); }
    if (color) { sql += ` AND (color = $${i} OR $${i} = ANY(colors))`; params.push(color); i++; }
    if (size) { sql += ` AND $${i++} = ANY(sizes)`; params.push(size); }
    if (store) { sql += ` AND store = $${i++}`; params.push(store); }
    if (style) { sql += ` AND (style = $${i} OR title ILIKE $${i+1})`; params.push(style, `%${style}%`); i += 2; }
    if (fit) { sql += ` AND (fit = $${i} OR title ILIKE $${i+1})`; params.push(fit, `%${fit}%`); i += 2; }
    if (category) { sql += ` AND (category = $${i} OR title ILIKE $${i+1})`; params.push(category, `%${category}%`); i += 2; }
    if (fabric) { sql += ` AND (title ILIKE $${i} OR description ILIKE $${i})`; params.push(`%${fabric}%`); i++; }
    if (pattern) { sql += ` AND (title ILIKE $${i} OR description ILIKE $${i})`; params.push(`%${pattern}%`); i++; }
    if (maxPrice) { sql += ` AND price <= $${i++}`; params.push(Number(maxPrice)); }
    if (minDiscount) { sql += ` AND original_price IS NOT NULL AND original_price > 0 AND ((original_price - price) / original_price * 100) >= $${i++}`; params.push(Number(minDiscount)); }

    sql += sort === 'price_asc' ? ` ORDER BY price ASC` : sort === 'price_desc' ? ` ORDER BY price DESC` : ` ORDER BY id DESC`;
    sql += ` LIMIT 200`;

    const result = await pool.query(sql, params);
    res.json(result.rows.map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) })));
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
    
    let sql = `SELECT id, title, price, original_price, image_url, images, sizes, color, colors, style, fit, category, store, source_url, description FROM products WHERE 1=1`;
    const params = [];
    let i = 1;

    if (analysis.keywords.length > 0) { sql += ` AND title ILIKE $${i++}`; params.push(`%${analysis.keywords.join(' ')}%`); }
    if (analysis.color) { sql += ` AND (color = $${i} OR $${i} = ANY(colors))`; params.push(analysis.color); i++; }
    if (analysis.size) { sql += ` AND $${i++} = ANY(sizes)`; params.push(analysis.size); }
    if (analysis.category) { sql += ` AND (category = $${i} OR title ILIKE $${i+1})`; params.push(analysis.category, `%${analysis.category}%`); i += 2; }
    if (analysis.style) { sql += ` AND (style = $${i} OR title ILIKE $${i+1})`; params.push(analysis.style, `%${analysis.style}%`); i += 2; }
    if (analysis.fit) { sql += ` AND (fit = $${i} OR title ILIKE $${i+1})`; params.push(analysis.fit, `%${analysis.fit}%`); i += 2; }
    if (analysis.maxPrice) { sql += ` AND price <= $${i++}`; params.push(analysis.maxPrice); }
    if (analysis.minDiscount) { sql += ` AND original_price > 0 AND ((original_price - price) / original_price * 100) >= $${i++}`; params.push(analysis.minDiscount); }

    sql += ` ORDER BY id DESC LIMIT 100`;
    const result = await pool.query(sql, params);
    res.json({ query, analysis, results: result.rows.map(p => ({ ...p, shipping: calculateShipping(p.store, p.price) })), count: result.rows.length });
  } catch (err) {
    console.error("ai-search error:", err.message);
    res.status(500).json({ error: "Search error" });
  }
});

function analyzeQuery(query) {
  const analysis = { keywords: [], color: null, size: null, style: null, fit: null, category: null, maxPrice: null, minDiscount: null };
  
  const priceMatch = query.match(/עד\s*₪?\s*(\d+)|(\d+)\s*₪|(\d+)\s*ש"?ח/i);
  if (priceMatch) analysis.maxPrice = parseInt(priceMatch[1] || priceMatch[2] || priceMatch[3]);
  
  const discountMatch = query.match(/(\d+)\s*%/i);
  if (discountMatch) analysis.minDiscount = parseInt(discountMatch[1]);

  const colorMap = { 'שחור': ['שחור', 'שחורה'], 'לבן': ['לבן', 'לבנה'], 'כחול': ['כחול', 'כחולה', 'נייבי'], 'אדום': ['אדום', 'אדומה'], 'ירוק': ['ירוק', 'ירוקה', 'זית'], 'חום': ['חום', 'חומה'], 'בז׳': ['בז׳', 'בז', 'ניוד'], 'אפור': ['אפור', 'אפורה'], 'ורוד': ['ורוד', 'ורודה'], 'בורדו': ['בורדו'], 'שמנת': ['שמנת', 'cream'], 'סגול': ['סגול', 'סגולה', 'לילך'] };
  const categoryMap = { 'שמלה': ['שמלה', 'שמלת', 'שמלות'], 'חולצה': ['חולצה', 'חולצת', 'טופ'], 'חצאית': ['חצאית', 'חצאיות'], 'מכנסיים': ['מכנס', 'מכנסיים'], 'סריג': ['סריג', 'סוודר', 'קרדיגן'] };
  const sizeList = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '36', '38', '40', '42', '44'];

  const text = query.replace(/עד\s*₪?\s*\d+/gi, '').replace(/\d+\s*₪/gi, '').replace(/\d+\s*%/gi, '').trim();
  const words = text.split(/\s+/).filter(w => w.length >= 1);

  for (const word of words) {
    const upper = word.toUpperCase();
    if (sizeList.includes(upper) && !analysis.size) { analysis.size = upper; continue; }
    
    for (const [name, variants] of Object.entries(colorMap)) {
      if (variants.some(v => word.toLowerCase() === v.toLowerCase()) && !analysis.color) { analysis.color = name; break; }
    }
    for (const [name, variants] of Object.entries(categoryMap)) {
      if (variants.some(v => word.toLowerCase() === v.toLowerCase()) && !analysis.category) { analysis.category = name; break; }
    }
    
    if (!analysis.color && !analysis.category && !sizeList.includes(upper) && word.length >= 2) {
      analysis.keywords.push(word);
    }
  }

  return analysis;
}

app.get("/out/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).send("Invalid id");
  try {
    const p = await pool.query(`SELECT source_url FROM products WHERE id = $1`, [id]);
    if (!p.rows.length) return res.status(404).send("Not found");
    res.redirect(p.rows[0].source_url);
  } catch (err) { res.status(500).send("Error"); }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
