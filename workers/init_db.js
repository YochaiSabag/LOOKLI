import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";

const { Client } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_PUBLIC || process.env.DATABASE_URL_PRIVATE;
  if (!connectionString) {
    console.error("Missing DATABASE_URL env var");
    process.exit(1);
  }

  // Railway לפעמים דורש SSL בחיבור ציבורי. אם זה נופל על SSL – נדליק.
  const client = new Client({
    connectionString,
    ssl: connectionString.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : undefined
  });

  const schemaPath = path.join(__dirname, "..", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  await client.connect();
  await client.query(sql);
  await client.end();

  console.log("DB initialized ✅");
}

main().catch((e) => {
  console.error("init-db failed:", e.message);
  process.exit(1);
});
