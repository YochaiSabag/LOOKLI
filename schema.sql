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
    EXECUTE FUNCTION update_updated_at_column();-- LOOKLI Users & Saved Products Schema
-- SAFE: Only CREATE IF NOT EXISTS, no drops

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  plan VARCHAR(20) DEFAULT 'free',  -- 'free' | 'premium'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Saved products per user
CREATE TABLE IF NOT EXISTS saved_products (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_source_url TEXT NOT NULL,
  product_title TEXT,
  product_price DECIMAL(10,2),
  product_image TEXT,
  product_store VARCHAR(50),
  saved_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, product_source_url)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_saved_user_id ON saved_products(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_user_saved_at ON saved_products(user_id, saved_at DESC);

-- Auto-update updated_at for users
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

-- Sponsored Products (מוצרים ממומנים)
CREATE TABLE IF NOT EXISTS sponsored_products (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store VARCHAR(50),
  priority_row INTEGER DEFAULT 1,    -- באיזו שורת מוצרים להופיע (1=ראשון, 3=שלישי...)
  impression_weight INTEGER DEFAULT 10, -- משקל הגרלה: 10=הכל, 3≈30%, 1≈10%
  active BOOLEAN DEFAULT true,
  price_paid DECIMAL(10,2),
  expires_at TIMESTAMP,
  badge_text VARCHAR(40),            -- טקסט על התמונה: "מומלץ", "מתאים להנקה" וכו'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- מיגרציה בטוחה לDB קיים (ALTER מתעלם אם העמודה כבר קיימת)
DO $$ BEGIN
  ALTER TABLE sponsored_products ADD COLUMN IF NOT EXISTS priority_row INTEGER DEFAULT 1;
  ALTER TABLE sponsored_products ADD COLUMN IF NOT EXISTS impression_weight INTEGER DEFAULT 10;
  ALTER TABLE sponsored_products ADD COLUMN IF NOT EXISTS badge_text VARCHAR(40);
  -- הסר עמודת priority ישנה אם קיימת והמר ל-priority_row
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sponsored_products' AND column_name='priority') THEN
    UPDATE sponsored_products SET priority_row = LEAST(GREATEST(priority,1),20) WHERE priority_row = 1;
    ALTER TABLE sponsored_products DROP COLUMN IF EXISTS priority;
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_sponsored_active ON sponsored_products(active, priority_row ASC);
CREATE INDEX IF NOT EXISTS idx_sponsored_product ON sponsored_products(product_id);

-- Newsletter Subscribers
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  source VARCHAR(50) DEFAULT 'footer',  -- 'footer' / 'register'
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nl_email ON newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_nl_active ON newsletter_subscribers(active);

-- Sidebar Banner Ads (לוחות פרסום בסיידבר)
CREATE TABLE IF NOT EXISTS sidebar_ads (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100),
  image_url TEXT,
  link_url TEXT,
  caption VARCHAR(80),              -- כיתוב על התמונה (אופציונלי)
  size SMALLINT DEFAULT 1,          -- 1=ריבוע (180×180), 2=כפול (180×370), 3=תלת (180×560)
  impression_weight SMALLINT DEFAULT 10, -- 10=תמיד, 5=50%, 3=30%, 1=10%
  active BOOLEAN DEFAULT true,
  starts_at TIMESTAMP,              -- NULL=מיד
  expires_at TIMESTAMP,             -- NULL=ללא תפוגה
  clicks INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  price_paid DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sidebar_active ON sidebar_ads(active);
