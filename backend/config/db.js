const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'data_authority',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
});

if (!process.env.DB_HOST || !process.env.DB_NAME) {
  console.error('❌ Missing required .env variables (DB_HOST or DB_NAME)');
  process.exit(1);
}

(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL connected');
    connection.release();
  } catch (err) {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
  }
})();

module.exports = pool;