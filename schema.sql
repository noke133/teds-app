-- ============================================================
-- DriveShare App — MySQL Schema (Client-Owned Storage Version)
-- ============================================================

-- Super Admins table: Top-level authority
CREATE TABLE IF NOT EXISTS super_admins (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(255) NOT NULL UNIQUE,
    password      VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO super_admins (username, password) VALUES ('superadmin', 'superadmindummy');

-- Admins (Photographers) table
CREATE TABLE IF NOT EXISTS admins (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(255) NOT NULL UNIQUE,
    password      VARCHAR(255) NOT NULL,
    email         VARCHAR(255) COMMENT 'Photographer email address (optional)',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clients table: Linked to photographers, but with their OWN Google tokens
CREATE TABLE IF NOT EXISTS clients (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    admin_id        INT NOT NULL COMMENT 'The photographer who owns this client',
    name            VARCHAR(255) NOT NULL,
    passcode        VARCHAR(255) NOT NULL UNIQUE COMMENT 'Code for client to login',
    drive_folder_id VARCHAR(255) COMMENT 'Google Drive folder ID (main gallery root in CLIENT drive)',
    
    -- Client's Google Drive tokens
    refresh_token TEXT         COMMENT 'Client long-lived refresh token',
    access_token  TEXT         COMMENT 'Client short-lived access token',
    token_expiry  BIGINT       COMMENT 'Access token expiry timestamp (ms)',

    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_passcode (passcode),
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Client selections table: Tracks which images the client favored
CREATE TABLE IF NOT EXISTS client_selections (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    client_id       INT NOT NULL,
    file_id         VARCHAR(255) NOT NULL COMMENT 'Google Drive file ID of the selected image',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_selection (client_id, file_id),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- INVOICING SYSTEM SCHEMA
-- ============================================================

-- Admin Settings: Stores photographer's company info for invoices
CREATE TABLE IF NOT EXISTS admin_settings (
    admin_id INT PRIMARY KEY,
    company_name VARCHAR(255),
    logo_url TEXT,
    address TEXT,
    email VARCHAR(255),
    phone VARCHAR(50),
    bank_details TEXT,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    public_token VARCHAR(64) NOT NULL UNIQUE,
    client_name VARCHAR(255) NOT NULL,
    client_address TEXT,
    invoice_number VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'Unpaid',
    subtotal DECIMAL(10,2) NOT NULL,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invoice Items
CREATE TABLE IF NOT EXISTS invoice_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT NOT NULL,
    description VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
