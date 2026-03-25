// server.js — Main Express server (SaaS Version)
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
const Busboy = require('busboy');
const axios = require('axios');
const crypto = require('crypto');
const { pool, initDB } = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionStore = new MySQLStore({
    host:               process.env.DB_HOST,
    port:               3306,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASS,
    database:           process.env.DB_NAME,
    createDatabaseTable: true,
    schema: {
        tableName: 'sessions',
        columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
    }
});

app.use(session({
    key: 'driveshare_sid',
    secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Google OAuth2 Client ─────────────
function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.REDIRECT_URI
    );
}

// ─── Middleware: Require Admin (Photographer) ─────────────────
function requireAdmin(req, res, next) {
    if (req.session && req.session.adminId) return next();
    return res.status(401).json({ error: 'Unauthorized. Please log in as photographer.' });
}

// ─── Middleware: Require Super Admin ──────────────────────────
function requireSuperAdmin(req, res, next) {
    if (req.session && req.session.superAdminId) return next();
    return res.status(401).json({ error: 'Unauthorized. Super Admin access required.' });
}

// ─── Middleware: Require Client ───────────────────────────────
function requireClient(req, res, next) {
    if (req.session && req.session.clientId) return next();
    return res.status(401).json({ error: 'Unauthorized. Please log in with your gallery code.' });
}

// Helper: Get Google Auth Client for specific photographer
async function getAdminAuthClient(adminId) {
    const [rows] = await pool.execute(
        'SELECT * FROM admin_tokens WHERE admin_id = ? LIMIT 1',
        [adminId]
    );
    if (!rows.length) throw new Error('Photographer not connected to Google. Please connect first.');

    const tokenData = rows[0];
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        expiry_date: tokenData.token_expiry
    });

    oauth2Client.on('tokens', async (tokens) => {
        await pool.execute(
            'UPDATE admin_tokens SET access_token = ?, token_expiry = ? WHERE admin_id = ?',
            [tokens.access_token, tokens.expiry_date, adminId]
        );
    });

    return oauth2Client;
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════
app.get('/health', async (req, res) => {
    let dbStatus = 'untested';
    try {
        await pool.execute('SELECT 1');
        dbStatus = 'connected';
    } catch (e) {
        dbStatus = 'ERROR: ' + e.message;
    }
    res.json({ status: 'running', port: PORT, db: dbStatus });
});

app.get('/api/config', (req, res) => {
    // Only send what's strictly needed for public
    res.json({ title: 'Photographer SaaS' });
});

// ═══════════════════════════════════════════════════════════════
// SUPER ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════
app.post('/api/superadmin/login', async (req, res) => {
    const { username, password } = req.body;
    // For simplicity without bcrypt, exact match from DB (in production use bcrypt!)
    const [rows] = await pool.execute('SELECT id FROM super_admins WHERE username = ? AND password = ?', [username, password]);
    if (rows.length > 0) {
        req.session.superAdminId = rows[0].id;
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Invalid super admin credentials' });
});

app.post('/api/superadmin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/superadmin/status', requireSuperAdmin, (req, res) => {
    res.json({ loggedIn: true });
});

app.get('/api/superadmin/admins', requireSuperAdmin, async (req, res) => {
    // List all photographers
    const [rows] = await pool.execute('SELECT id, username, email, created_at FROM admins ORDER BY created_at DESC');
    res.json(rows);
});

app.post('/api/superadmin/admins', requireSuperAdmin, async (req, res) => {
    const { username, password, email } = req.body;
    try {
        await pool.execute('INSERT INTO admins (username, password, email) VALUES (?, ?, ?)', [username, password, email]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/superadmin/admins/:id', requireSuperAdmin, async (req, res) => {
    try {
        await pool.execute('DELETE FROM admins WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// PHOTOGRAPHER (ADMIN) ROUTES
// ═══════════════════════════════════════════════════════════════
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const [rows] = await pool.execute('SELECT id, email FROM admins WHERE username = ? AND password = ?', [username, password]);
    if (rows.length > 0) {
        req.session.adminId = rows[0].id;
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Invalid photographer credentials.' });
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/admin/status', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT id FROM admin_tokens WHERE admin_id = ?', [req.session.adminId]);
        res.json({ loggedIn: true, googleConnected: rows.length > 0 });
    } catch (err) {
        res.json({ loggedIn: true, googleConnected: false });
    }
});

app.get('/api/admin/auth', requireAdmin, (req, res) => {
    const oauth2Client = getOAuth2Client();
    const state = req.session.adminId.toString(); // Pass photographer ID through state
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive'],
        prompt: 'consent',
        state: state
    });
    res.redirect(authUrl);
});

app.get('/api/admin/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/admin.html?error=' + encodeURIComponent(error));
    if (!code) return res.redirect('/admin.html?error=no_code');
    const adminId = parseInt(state, 10);
    if (!adminId) return res.redirect('/admin.html?error=invalid_state');

    try {
        const oauth2Client = getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        
        let refreshTokenToSave = tokens.refresh_token;
        if (!refreshTokenToSave) {
            const [existing] = await pool.execute('SELECT refresh_token FROM admin_tokens WHERE admin_id = ? LIMIT 1', [adminId]);
            if (existing.length && existing[0].refresh_token) {
                refreshTokenToSave = existing[0].refresh_token;
            } else {
                return res.redirect('/admin.html?error=' + encodeURIComponent('Google did not return a refresh token. Revoke access from Google and try again.'));
            }
        }

        await pool.execute(`
            INSERT INTO admin_tokens (admin_id, refresh_token, access_token, token_expiry)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                refresh_token = VALUES(refresh_token),
                access_token  = VALUES(access_token),
                token_expiry  = VALUES(token_expiry)
        `, [adminId, refreshTokenToSave, tokens.access_token || null, tokens.expiry_date || null]);

        res.redirect('/admin.html?google=connected');
    } catch (err) {
        console.error('OAuth callback error:', err);
        res.redirect('/admin.html?error=' + encodeURIComponent(err.message));
    }
});

// Photographer Client Management
app.get('/api/clients', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM clients WHERE admin_id = ? ORDER BY created_at DESC', [req.session.adminId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clients', requireAdmin, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Client name needed.' });
    
    // Generate a 6-digit random code
    const passcode = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        // Also create a root folder in Google Drive for this client
        const auth = await getAdminAuthClient(req.session.adminId);
        const drive = google.drive({ version: 'v3', auth });
        
        const folder = await drive.files.create({
            requestBody: { name: `Client_${name}_${passcode}`, mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id'
        });

        const [result] = await pool.execute(
            'INSERT INTO clients (admin_id, name, passcode, drive_folder_id) VALUES (?, ?, ?, ?)',
            [req.session.adminId, name, passcode, folder.data.id]
        );
        res.json({ success: true, clientId: result.insertId, passcode: passcode, folderId: folder.data.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create subfolder for a client
app.post('/api/drive/folders/:folderId', requireAdmin, async (req, res) => {
    const { name } = req.body;
    try {
        const auth = await getAdminAuthClient(req.session.adminId);
        const drive = google.drive({ version: 'v3', auth });

        const folder = await drive.files.create({
            requestBody: {
                name: name,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [req.params.folderId]
            },
            fields: 'id'
        });
        res.json({ success: true, folderId: folder.data.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin fetching clients' drive contents
app.get('/api/drive/list/:folderId', requireAdmin, async (req, res) => {
    try {
        const auth = await getAdminAuthClient(req.session.adminId);
        const drive = google.drive({ version: 'v3', auth });

        const response = await drive.files.list({
            q: `'${req.params.folderId}' in parents and trashed=false`,
            fields: 'files(id, name, mimeType, size, thumbnailLink, webContentLink, createdTime)',
            orderBy: 'createdTime desc'
        });
        res.json(response.data.files || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin upload session
app.post('/api/drive/upload-session/:folderId', requireAdmin, async (req, res) => {
    const { name, mimeType } = req.body;
    try {
        const auth = await getAdminAuthClient(req.session.adminId);
        const tokenResponse = await auth.getAccessToken();
        const response = await axios({
            method: 'post',
            url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
            headers: {
                'Authorization': `Bearer ${tokenResponse.token}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': mimeType,
            },
            data: { name: name, parents: [req.params.folderId] }
        });
        res.json({ sessionUrl: response.headers.location });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create upload session', details: err.response?.data || err.message });
    }
});

// Admin proxy delete
app.delete('/api/drive/delete/:fileId', requireAdmin, async (req, res) => {
    try {
        const auth = await getAdminAuthClient(req.session.adminId);
        const drive = google.drive({ version: 'v3', auth });
        await drive.files.delete({ fileId: req.params.fileId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ═══════════════════════════════════════════════════════════════
// CLIENT ROUTES (GALLERY)
// ═══════════════════════════════════════════════════════════════
app.post('/api/client/login', async (req, res) => {
    const { passcode } = req.body;
    if (!passcode) return res.status(400).json({ error: 'Passcode required' });
    
    const [rows] = await pool.execute('SELECT * FROM clients WHERE passcode = ?', [passcode]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid passcode.' });
    
    const client = rows[0];
    req.session.clientId = client.id;
    req.session.clientAdminId = client.admin_id; // Need this to access drive api
    req.session.driveFolderId = client.drive_folder_id;
    
    res.json({ success: true, name: client.name });
});

app.post('/api/client/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/client/status', requireClient, async (req, res) => {
    const [rows] = await pool.execute('SELECT name FROM clients WHERE id = ?', [req.session.clientId]);
    res.json({ loggedIn: true, name: rows[0]?.name });
});

// Client view their own gallery (fetches from root folder and subfolders)
// For simplicity, we assume one level inside root, or list all images in folder tree
app.get('/api/client/gallery', requireClient, async (req, res) => {
    try {
        const auth = await getAdminAuthClient(req.session.clientAdminId);
        const drive = google.drive({ version: 'v3', auth });
        
        // Find files in the client root folder AND subfolders
        // Better: Find all files that are owned by photographer and NOT trashed...
        // For a true nested tree we'd recursively get. Here we just query the root directly.
        const response = await drive.files.list({
            q: `'${req.session.driveFolderId}' in parents and trashed=false`, // Just listing root folder for now
            fields: 'files(id, name, mimeType, thumbnailLink, webContentLink)',
            orderBy: 'createdTime desc'
        });
        
        // Let's find subfolders to see inside them too
        const subfolders = response.data.files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
        const images = response.data.files.filter(f => f.mimeType.startsWith('image/'));
        
        // Optional: fetch images in subfolders
        for (let sf of subfolders) {
            const sfRes = await drive.files.list({
                q: `'${sf.id}' in parents and trashed=false and mimeType contains 'image/'`,
                fields: 'files(id, name, mimeType, thumbnailLink, webContentLink)'
            });
            images.push(...(sfRes.data.files || []).map(f => ({...f, folderName: sf.name})));
        }

        res.json(images);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Client Selections endpoints
app.get('/api/client/selections', requireClient, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT file_id FROM client_selections WHERE client_id = ?', [req.session.clientId]);
        res.json(rows.map(r => r.file_id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/client/selections', requireClient, async (req, res) => {
    const { file_id, selected } = req.body;
    try {
        if (selected) {
            await pool.execute('INSERT IGNORE INTO client_selections (client_id, file_id) VALUES (?, ?)', [req.session.clientId, file_id]);
        } else {
            await pool.execute('DELETE FROM client_selections WHERE client_id = ? AND file_id = ?', [req.session.clientId, file_id]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Routing mappings ─────────────────────────────────────────

app.get('/superadmin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.get('*', (req, res) => {
    // If client HTML request
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).end();
    }
});

// ─── Start Server ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`🚀 Photographer SaaS App running at http://localhost:${PORT}`);
    console.log(`   ENV CHECK: DB_HOST=${process.env.DB_HOST}`);
});

initDB().then(() => console.log('✅ Database ready.'))
        .catch(err => console.error('⚠️ DB init failed:', err.message));
