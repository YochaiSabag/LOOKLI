import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

await client.connect();
console.log('Connected!');

// Show existing columns
const res = await client.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name='products' ORDER BY ordinal_position"
);
console.log('\nExisting columns:');
res.rows.forEach(r => console.log('  -', r.column_name));

// Add missing columns
const columns = [
  ['fabric', 'VARCHAR(50)'],
  ['pattern', 'VARCHAR(50)'],
  ['design', 'TEXT[]'],
  ['design_details', 'TEXT[]']
];

for (const [name, type] of columns) {
  try {
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ${name} ${type}`);
    console.log(`Added: ${name}`);
  } catch(e) {
    console.log(`${name}: ${e.message}`);
  }
}

console.log('\nDone!');
await client.end();
