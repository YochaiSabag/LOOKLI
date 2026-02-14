import pkg from "pg";
const { Client } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const ssl =
  DATABASE_URL.includes("proxy.rlwy.net") || DATABASE_URL.includes("rlwy.net")
    ? { rejectUnauthorized: false }
    : undefined;

const client = new Client({ connectionString: DATABASE_URL, ssl });

try {
  await client.connect();
  const r = await client.query("SELECT COUNT(*)::int AS cnt FROM public.products");
  console.log("Railway products count =", r.rows[0].cnt);
} catch (e) {
  console.error("DB check failed:", e.message || e);
  process.exit(1);
} finally {
  await client.end();
}
