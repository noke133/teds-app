// db.js — MySQL connection pool and table initialization
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDB() {
    const conn = await pool.getConnection();
    try {
        // Clients table
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS clients (
                id INT AUTO_INCREMENT PRIMARY KEY,
                google_id VARCHAR(255) NOT NULL UNIQUE,
                email VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                picture TEXT,
                drive_folder_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Safely add missing columns to existing tables (old schema compat)
        for (const sql of [
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS picture TEXT",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS drive_folder_id VARCHAR(255)",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        ]) {
            try { await conn.execute(sql); } catch (e) { /* ignore: column exists or syntax not supported */ }
        }

        // Admin tokens table (stores the refresh token)
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS admin_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                refresh_token TEXT NOT NULL,
                access_token TEXT,
                token_expiry BIGINT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        console.log('✅ Database tables verified/created.');
    } finally {
        conn.release();
    }
}

module.exports = { pool, initDB };
