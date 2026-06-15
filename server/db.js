require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    release();
    console.log("✅ Connected to Railway PostgreSQL");
  }
});

module.exports = pool;
