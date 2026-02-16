-- חיפושIT - Fashion Search Engine Database Schema
-- SAFE schema - never drops existing data

-- Products table
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  store VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  price DECIMAL(10, 2) DEFAULT 0,
  original_price DECIMAL(10, 2),
  image_url TEXT,
  images TEXT[],
  sizes TEXT[],
  color VARCHAR(50),
  colors TEXT[],
  style VARCHAR(50),
  fit VARCHAR(50),
  category VARCHAR(50),
  description TEXT,
  source_url TEXT UNIQUE NOT NULL,
  color_sizes JSONB,
  fabric VARCHAR(50),
  pattern VARCHAR(50),
  design_details TEXT[],
  last_seen TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add columns if missing (safe for existing DB)
DO $$ BEGIN
  ALTER TABLE products ADD COLUMN IF NOT EXISTS fabric VARCHAR(50);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS pattern VARCHAR(50);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS design_details TEXT[];
  ALTER TABLE products ADD COLUMN IF NOT EXISTS color_sizes JSONB;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Clicks tracking table
CREATE TABLE IF NOT EXISTS clicks (
  id SERIAL PRIMARY KEY,
  product_id INTEGER,
  store VARCHAR(50),
  product_title TEXT,
  source_url TEXT,
  user_agent TEXT,
  ip_address VARCHAR(50),
  clicked_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_color ON products(color);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_colors ON products USING gin(colors);
CREATE INDEX IF NOT EXISTS idx_products_sizes ON products USING gin(sizes);
CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen);
CREATE INDEX IF NOT EXISTS idx_products_fabric ON products(fabric);
CREATE INDEX IF NOT EXISTS idx_products_pattern ON products(pattern);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);

-- Hebrew text search index
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_products_title ON products USING gin(to_tsvector('hebrew', title));
EXCEPTION WHEN OTHERS THEN
  CREATE INDEX IF NOT EXISTS idx_products_title_simple ON products USING gin(to_tsvector('simple', title));
END $$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();