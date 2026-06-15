require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  // Get matview definitions
  const defs = await pool.query(`
    SELECT matviewname, definition
    FROM pg_matviews WHERE schemaname = 'public'
  `);
  defs.rows.forEach(r => {
    console.log('\n=== MATVIEW:', r.matviewname, '===');
    console.log(r.definition);
  });

  // Sample a few rows from each
  for (const r of defs.rows) {
    try {
      const sample = await pool.query('SELECT * FROM ' + r.matviewname + ' LIMIT 3');
      console.log('\nSAMPLE from', r.matviewname, ':');
      console.log(JSON.stringify(sample.rows, null, 2));
    } catch(e) { console.log('Could not sample:', e.message); }
  }

  // Check product_affinity data
  const aff = await pool.query('SELECT COUNT(*) FROM product_affinity');
  console.log('\nproduct_affinity rows:', aff.rows[0].count);

  // Check interactions sample
  const inter = await pool.query('SELECT action, COUNT(*) FROM interactions GROUP BY action LIMIT 10');
  console.log('\ninteractions by action:');
  inter.rows.forEach(r => console.log(r.action, ':', r.count));

  // Check users table
  const users = await pool.query('SELECT user_id, name, persona, loyalty_tier, avg_order_value FROM users LIMIT 5');
  console.log('\nSample users:');
  users.rows.forEach(r => console.log(JSON.stringify(r)));

  // Check sample products
  const prods = await pool.query('SELECT product_id, name, category, subcategory, price, urgency_score FROM products LIMIT 5');
  console.log('\nSample products:');
  prods.rows.forEach(r => console.log(JSON.stringify(r)));

  // Check if feedback_score or similar columns exist
  const feedbackCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name ILIKE '%feedback%'
  `);
  console.log('\nFeedback-related columns:', feedbackCheck.rows);

  // Check user_profile matview columns
  const upCols = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profile'
    ORDER BY ordinal_position
  `);
  console.log('\nuser_profile matview columns:');
  upCols.rows.forEach(r => console.log(r.column_name, '|', r.data_type));

  // Check product_context matview columns
  const pcCols = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_context'
    ORDER BY ordinal_position
  `);
  console.log('\nproduct_context matview columns:');
  pcCols.rows.forEach(r => console.log(r.column_name, '|', r.data_type));

  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
