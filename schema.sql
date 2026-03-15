-- ============================================================
-- DriveShare App — MySQL Schema
-- Run this SQL in your Hostinger phpMyAdmin ONCE before
-- deploying the app. The server also auto-creates these
-- tables on startup, so this is just a reference / manual setup.
-- ============================================================

-- Clients table: Stores Google-authenticated client info
CREATE TABLE IF NOT EXISTS clients (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    google_id       VARCHAR(255) NOT NULL UNIQUE COMMENT 'Google sub (user ID)',
    email           VARCHAR(255) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    picture         TEXT         COMMENT 'Google profile picture URL',
    drive_folder_id VARCHAR(255) COMMENT 'Google Drive folder ID',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_drive_folder (drive_folder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin tokens table: Stores admin's Google OAuth tokens for server-side uploads
CREATE TABLE IF NOT EXISTS admin_tokens (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) NOT NULL COMMENT 'Admin email address',
    refresh_token TEXT         NOT NULL COMMENT 'Long-lived refresh token',
    access_token  TEXT         COMMENT 'Short-lived access token (auto-refreshed)',
    token_expiry  BIGINT       COMMENT 'Access token expiry timestamp (ms)',
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
