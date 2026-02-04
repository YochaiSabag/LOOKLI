import fs from "fs";
import path from "path";
import pg from "pg";

const { Client } = pg;

function needsSSL(databaseUrl) {
  // Railway internal usually doesn't need SSL; public proxies often do.
  // If it's not internal, prefer SSL (safe default for cloud DBs).
  return databaseUrl && !databaseUrl.includes("railway.internal");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL is missing (env var)");
    process.exit(1);
  }

  const schemaPath = path.resolve(process.cwd(), "schema.sql");
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ schema.sql not found at: ${schemaPath}`);
    process.exit(1);
  }

  const schemaSql = fs.readFileSync(schemaPath, "utf8");

  const client = new Client({
    connectionString: databaseUrl,
    ssl: needsSSL(databaseUrl) ? { rejectUnauthorized: false } : false
  });

  try {
    console.log("🧱 init-db: connecting...");
    await client.connect();

    console.log("🧱 init-db: applying schema.sql ...");
    await client.query(schemaSql);

    console.log("✅ init-db: done");
  } catch (err) {
    console.error("❌ init-db failed:", err?.message || err);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
}

main();
