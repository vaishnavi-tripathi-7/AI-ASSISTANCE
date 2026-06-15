require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function runMigration() {
  const sqlFile = path.join(__dirname, 'migrations', '001_enhancement_views_and_tables.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  // Run the entire migration file as a single transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Running migration 001_enhancement_views_and_tables.sql ...\n');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Migration committed successfully.');
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed, rolled back.');
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }

  // Verify key objects were created
  console.log('\n--- Verifying created objects ---');
  const checks = [
    "SELECT COUNT(*) FROM recommendation_feedback",
    "SELECT COUNT(*) FROM category_affinity_scores",
    "SELECT COUNT(*) FROM smart_bundles",
    "SELECT COUNT(*) FROM product_affinity",
    "SELECT COUNT(*) FROM user_persona_view",
    "SELECT COUNT(*) FROM demand_score_view LIMIT 1",
    "SELECT COUNT(*) FROM feedback_score_view LIMIT 1",
    "SELECT COUNT(*) FROM trending_products_view LIMIT 1",
    "SELECT COUNT(*) FROM frequently_bought_together_view LIMIT 1",
    "SELECT COUNT(*) FROM category_affinity_view LIMIT 1",
  ];
  for (const q of checks) {
    try {
      const r = await pool.query(q);
      console.log(`✅ ${q.replace('SELECT COUNT(*) FROM ', '').replace(' LIMIT 1', '')} → ${r.rows[0].count} rows`);
    } catch(e) {
      console.error(`❌ ${q} → ${e.message}`);
    }
  }

  await pool.end();
}

runMigration().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
