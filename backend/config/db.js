const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: 'sdocamnorte2025*',
  database: process.env.DB_NAME || 'data_authority',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  port: 3306,
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