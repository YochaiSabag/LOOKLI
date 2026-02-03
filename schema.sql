-- LOOKA Fashion Aggregator - Database Schema
-- Run this script to create the required tables

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    store VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    price DECIMAL(10, 2),
    original_price DECIMAL(10, 2),
    image_url TEXT,
    images TEXT[],
    sizes TEXT[],
    color VARCHAR(50),
    colors TEXT[],
    style VARCHAR(50),
    fit VARCHAR(50),
    category VARCHAR(100),
    description TEXT,
    source_url TEXT UNIQUE,
    color_sizes JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_color ON products(color);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_sizes ON products USING GIN(sizes);
CREATE INDEX IF NOT EXISTS idx_products_colors ON products USING GIN(colors);

-- Product clicks tracking (optional)
CREATE TABLE IF NOT EXISTS product_clicks (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    store VARCHAR(50),
    source_url TEXT,
    user_agent TEXT,
    clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sample data (optional - remove in production)
-- INSERT INTO products (store, title, price, original_price, image_url, sizes, color, category)
-- VALUES ('MEKIMI', 'שמלה שחורה אלגנטית', 299, 399, 'https://example.com/image.jpg', ARRAY['S', 'M', 'L'], 'שחור', 'שמלה');
