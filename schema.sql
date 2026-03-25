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
