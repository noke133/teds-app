-- ============================================================
-- DriveShare App — MySQL Schema (SaaS Version)
-- Run this SQL in your Hostinger phpMyAdmin ONCE before
-- deploying the app. The server also auto-creates these
-- tables on startup, so this is just a reference / manual setup.
-- ============================================================

-- Super Admins table: Top-level authority
CREATE TABLE IF NOT EXISTS super_admins (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(255) NOT NULL UNIQUE,
    password      VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default super admin if empty (password is just for first run, typically you'd hash this, but we will handle logic in JS)
-- For the scope of this project, we'll assume bcrypt hashes or plain text as desired, but we'll use a placeholder
INSERT IGNORE INTO super_admins (username, password) VALUES ('superadmin', 'superadmindummy');

-- Admins (Photographers) table
CREATE TABLE IF NOT EXISTS admins (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(255) NOT NULL UNIQUE,
    password      VARCHAR(255) NOT NULL,
    email         VARCHAR(255) COMMENT 'Photographer email address (optional)',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin tokens table: Stores photographer's Google OAuth tokens for server-side uploads
CREATE TABLE IF NOT EXISTS admin_tokens (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    admin_id      INT NOT NULL UNIQUE COMMENT 'Links to photographers',
    email         VARCHAR(255) COMMENT 'Google email for reference',
    refresh_token TEXT         NOT NULL COMMENT 'Long-lived refresh token',
    access_token  TEXT         COMMENT 'Short-lived access token (auto-refreshed)',
    token_expiry  BIGINT       COMMENT 'Access token expiry timestamp (ms)',
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clients table: Now linked to photographers and uses passcode auth
CREATE TABLE IF NOT EXISTS clients (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    admin_id        INT NOT NULL COMMENT 'The photographer who owns this client',
    name            VARCHAR(255) NOT NULL,
    passcode        VARCHAR(255) NOT NULL UNIQUE COMMENT 'Code for client to login',
    drive_folder_id VARCHAR(255) COMMENT 'Google Drive folder ID (main gallery root)',
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
