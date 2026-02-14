-- חיפושIT - Fashion Search Engine Database Schema

-- Drop existing tables if needed
DROP TABLE IF EXISTS products CASCADE;

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
  last_seen TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_color ON products(color);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_title ON products USING gin(to_tsvector('hebrew', title));
CREATE INDEX IF NOT EXISTS idx_products_colors ON products USING gin(colors);
CREATE INDEX IF NOT EXISTS idx_products_sizes ON products USING gin(sizes);
CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert sample data (optional, for testing)
-- Uncomment if you want some initial data
/*
INSERT INTO products (store, title, price, original_price, image_url, images, sizes, color, colors, category, source_url)
VALUES 
  ('MEKIMI', 'שמלה שחורה אלגנטית', 299, 399, 'https://example.com/1.jpg', ARRAY['https://example.com/1.jpg'], ARRAY['S', 'M', 'L'], 'שחור', ARRAY['שחור'], 'שמלה', 'https://example.com/product-1'),
  ('MEKIMI', 'חולצת סריג לבנה', 149, NULL, 'https://example.com/2.jpg', ARRAY['https://example.com/2.jpg'], ARRAY['M', 'L'], 'לבן', ARRAY['לבן', 'שמנת'], 'חולצה', 'https://example.com/product-2')
ON CONFLICT (source_url) DO NOTHING;
*/
