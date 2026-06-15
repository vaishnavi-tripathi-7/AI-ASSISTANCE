require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const isSSL = (process.env.DATABASE_URL || '').includes('railway') || (process.env.DATABASE_URL || '').includes('render') || (process.env.DATABASE_URL || '').includes('neon');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isSSL ? { rejectUnauthorized: false } : false
});

async function inspectSchema() {
  // 1. All tables + row counts
  const tables = await pool.query(`
    SELECT t.table_name,
           COALESCE(pg_stat_get_live_tuples(c.oid), 0) AS live_rows
    FROM information_schema.tables t
    LEFT JOIN pg_class c ON c.relname = t.table_name
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name
  `);
  console.log('=== TABLES ===');
  tables.rows.forEach(r => console.log(r.table_name, '| rows:', r.live_rows));

  // 2. All views
  const views = await pool.query(`
    SELECT table_name FROM information_schema.views WHERE table_schema = 'public'
  `);
  console.log('\n=== VIEWS ===');
  if (views.rows.length === 0) console.log('(none)');
  views.rows.forEach(r => console.log(r.table_name));

  // 3. All materialized views
  const matviews = await pool.query(`
    SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'
  `);
  console.log('\n=== MATERIALIZED VIEWS ===');
  if (matviews.rows.length === 0) console.log('(none)');
  matviews.rows.forEach(r => console.log(r.matviewname));

  // 4. All columns per table
  const cols = await pool.query(`
    SELECT table_name, column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  console.log('\n=== COLUMNS ===');
  let lastTable = '';
  cols.rows.forEach(r => {
    if (r.table_name !== lastTable) { console.log('\n-- ' + r.table_name); lastTable = r.table_name; }
    const def = r.column_default ? ' | default: ' + r.column_default : '';
    console.log('  ', r.column_name, '|', r.data_type, '| nullable:', r.is_nullable + def);
  });

  // 5. All indexes
  const idxs = await pool.query(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);
  console.log('\n=== INDEXES ===');
  idxs.rows.forEach(r => console.log(r.tablename, '->', r.indexname));

  // 6. Foreign keys
  const fks = await pool.query(`
    SELECT
      tc.table_name, kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name
  `);
  console.log('\n=== FOREIGN KEYS ===');
  fks.rows.forEach(r => console.log(r.table_name + '.' + r.column_name, '->', r.foreign_table_name + '.' + r.foreign_column_name));

  await pool.end();
}

inspectSchema().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
