# TDS App - Deployment Guide (Hostinger)

This folder contains the complete code for your TDS App, converted to HTML/CSS/PHP for easy hosting.

## Steps to Go Live

### 1. Database Setup (Hostinger hPanel)
- Go to **Databases > MySQL Databases**.
- Create a new Database (e.g., `u1234_tds_db`).
- Create a new User and Password.
- **IMPORTANT**: Copy these details.

### 2. Configuration
- Open `config.php`.
- Enter your Hostinger Database name, user, and password.
- Ensure your `GOOGLE_CLIENT_ID` is correct.

### 3. Upload Files
- Log in to your Hostinger **File Manager**.
- Go to the `public_html` folder.
- Upload all files from this `php_app` folder directly into `public_html`.
- Log in to your Hostinger **File Manager**.
- Go to the `public_html` folder.
- Upload all files from this `php_app` folder directly into `public_html`.

### 4. Update Google Cloud Console
- Go to [Google Cloud Console](https://console.cloud.google.com/).
- Edit your **OAuth 2.0 Client ID**.
- Under **Authorized JavaScript origins**, add your domain: `https://yourdomain.com`.
- Under **Authorized redirect URIs**, add the SAME domain: `https://yourdomain.com`.
- Click **Save**.

## Support
- The **Admin Panel** is accessible at `https://yourdomain.com/admin.php`.
- New clients will be automatically added there when they login.
