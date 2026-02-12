import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const { Client } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL env var");
  console.error("💡 Make sure you have a .env file with DATABASE_URL=...");
  process.exit(1);
}

const schemaPath = path.resolve(__dirname, "schema.sql");
const schemaSql = fs.readFileSync(schemaPath, "utf8");

const ssl =
  DATABASE_URL.includes("proxy.rlwy.net") || 
  DATABASE_URL.includes("rlwy.net") ||
  DATABASE_URL.includes("amazonaws.com")
    ? { rejectUnauthorized: false }
    : undefined;

const client = new Client({ connectionString: DATABASE_URL, ssl });

try {
  console.log("🔌 Connecting to DB...");
  await client.connect();
  console.log("🧱 Running schema.sql...");
  await client.query(schemaSql);
  console.log("✅ DB initialized successfully");
} catch (err) {
  console.error("❌ init-db failed:", err?.message || err);
  process.exit(1);
} finally {
  await client.end();
}