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
                admin_id INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                passcode VARCHAR(255) NOT NULL UNIQUE,
                drive_folder_id VARCHAR(255),
                refresh_token TEXT,
                access_token TEXT,
                token_expiry BIGINT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Client selections table
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS client_selections (
                id INT AUTO_INCREMENT PRIMARY KEY,
                client_id INT NOT NULL,
                file_id VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_selection (client_id, file_id),
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Safely add missing columns to existing tables (old schema compat)
        for (const sql of [
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS admin_id INT AFTER id",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS passcode VARCHAR(255) AFTER name",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS refresh_token TEXT AFTER drive_folder_id",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS access_token TEXT AFTER refresh_token",
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS token_expiry BIGINT AFTER access_token"
        ]) {
            try { await conn.execute(sql); } catch (e) { /* ignore */ }
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

        // INVOICES SYSTEM TABLES
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS admin_settings (
                admin_id INT PRIMARY KEY,
                company_name VARCHAR(255),
                logo_url TEXT,
                address TEXT,
                email VARCHAR(255),
                phone VARCHAR(50),
                bank_details TEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await conn.execute(`
            CREATE TABLE IF NOT EXISTS invoices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                admin_id INT NOT NULL,
                public_token VARCHAR(64) NOT NULL UNIQUE,
                client_name VARCHAR(255) NOT NULL,
                client_address TEXT,
                event_details TEXT,
                invoice_number VARCHAR(50) NOT NULL,
                date DATE NOT NULL,
                due_date DATE NOT NULL,
                status VARCHAR(20) DEFAULT 'Unpaid',
                subtotal DECIMAL(10,2) NOT NULL,
                discount DECIMAL(10,2) DEFAULT 0,
                tax_rate DECIMAL(5,2) DEFAULT 0,
                shipping DECIMAL(10,2) DEFAULT 0,
                total DECIMAL(10,2) NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        for (const sql of [
            "ALTER TABLE invoices ADD COLUMN event_details TEXT AFTER client_address",
            "ALTER TABLE invoices ADD COLUMN discount DECIMAL(10,2) DEFAULT 0 AFTER subtotal",
            "ALTER TABLE invoices ADD COLUMN shipping DECIMAL(10,2) DEFAULT 0 AFTER tax_rate"
        ]) {
            try { await conn.execute(sql); } catch (e) { /* ignore */ }
        }

        await conn.execute(`
            CREATE TABLE IF NOT EXISTS invoice_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_id INT NOT NULL,
                description VARCHAR(255) NOT NULL,
                quantity INT NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        console.log('✅ Database tables verified/created.');
    } finally {
        conn.release();
    }
}

module.exports = { pool, initDB };
