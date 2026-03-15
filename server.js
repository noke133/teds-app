// server.js — Main Express server
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { pool, initDB } = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24h
}));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Google OAuth2 Client (for Admin server-side) ─────────────
function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.REDIRECT_URI
    );
}

// ─── Helper: Get Admin OAuth2 Client with stored tokens ───────
async function getAdminAuthClient() {
    const [rows] = await pool.execute(
        'SELECT * FROM admin_tokens WHERE email = ? LIMIT 1',
        [process.env.ADMIN_EMAIL]
    );
    if (!rows.length) throw new Error('Admin not connected to Google. Please authorize first via /api/admin/auth');

    const tokenData = rows[0];
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        expiry_date: tokenData.token_expiry
    });

    // Auto-refresh if expired
    oauth2Client.on('tokens', async (tokens) => {
        await pool.execute(
            'UPDATE admin_tokens SET access_token = ?, token_expiry = ? WHERE email = ?',
            [tokens.access_token, tokens.expiry_date, process.env.ADMIN_EMAIL]
        );
    });

    return oauth2Client;
}

// ─── Middleware: Require Admin Session ────────────────────────
function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    return res.status(401).json({ error: 'Unauthorized. Please log in as admin.' });
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /health — Debug endpoint (shows env and DB status)
app.get('/health', async (req, res) => {
    let dbStatus = 'untested';
    try {
        await pool.execute('SELECT 1');
        dbStatus = 'connected';
    } catch (e) {
        dbStatus = 'ERROR: ' + e.message;
    }
    res.json({
        status: 'running',
        port: PORT,
        db: dbStatus,
        env: {
            DB_HOST:               !!process.env.DB_HOST,
            DB_USER:               !!process.env.DB_USER,
            DB_PASS:               !!process.env.DB_PASS,
            DB_NAME:               !!process.env.DB_NAME,
            GOOGLE_CLIENT_ID:      !!process.env.GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET:  !!process.env.GOOGLE_CLIENT_SECRET,
            REDIRECT_URI:          process.env.REDIRECT_URI || 'NOT SET',
            SESSION_SECRET:        !!process.env.SESSION_SECRET,
            ADMIN_EMAIL:           process.env.ADMIN_EMAIL || 'NOT SET',
            ADMIN_USER:            !!process.env.ADMIN_USER,
            ADMIN_PASS:            !!process.env.ADMIN_PASS
        }
    });
});

// GET /api/config — Returns public config to frontend
app.get('/api/config', (req, res) => {
    res.json({
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        ADMIN_EMAIL: process.env.ADMIN_EMAIL
    });
});

// POST /api/register — Called by client after Drive folder is created
app.post('/api/register', async (req, res) => {
    const { google_id, email, name, picture, drive_folder_id } = req.body;
    if (!google_id || !email || !name) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }
    try {
        await pool.execute(`
            INSERT INTO clients (google_id, email, name, picture, drive_folder_id)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                picture = VALUES(picture),
                drive_folder_id = COALESCE(VALUES(drive_folder_id), drive_folder_id),
                updated_at = NOW()
        `, [google_id, email, name, picture || null, drive_folder_id || null]);

        const [rows] = await pool.execute('SELECT * FROM clients WHERE google_id = ?', [google_id]);
        res.json({ success: true, client: rows[0] });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN AUTH ROUTES
// ═══════════════════════════════════════════════════════════════

// POST /api/admin/login — Admin site login with username/password
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        req.session.isAdmin = true;
        req.session.adminEmail = process.env.ADMIN_EMAIL;
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Invalid credentials.' });
});

// POST /api/admin/logout
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// GET /api/admin/status — Check if admin is logged in and Google is connected
app.get('/api/admin/status', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, email, updated_at FROM admin_tokens WHERE email = ? LIMIT 1',
            [process.env.ADMIN_EMAIL]
        );
        res.json({ loggedIn: true, googleConnected: rows.length > 0, tokenInfo: rows[0] || null });
    } catch (err) {
        res.json({ loggedIn: true, googleConnected: false });
    }
});

// GET /api/admin/auth — Start Google OAuth flow for admin (offline access)
app.get('/api/admin/auth', requireAdmin, (req, res) => {
    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive'],
        prompt: 'consent', // Always show consent to ensure refresh_token is returned
        login_hint: process.env.ADMIN_EMAIL
    });
    res.redirect(authUrl);
});

// GET /api/admin/callback — Handle OAuth callback, save refresh_token
app.get('/api/admin/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) {
        return res.redirect('/admin.html?error=' + encodeURIComponent(error));
    }
    if (!code) {
        return res.redirect('/admin.html?error=no_code');
    }

    try {
        const oauth2Client = getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
            // Token already exists, try to use existing one
            const [existing] = await pool.execute(
                'SELECT refresh_token FROM admin_tokens WHERE email = ? LIMIT 1',
                [process.env.ADMIN_EMAIL]
            );
            if (!existing.length) {
                return res.redirect('/admin.html?error=no_refresh_token_revoke_and_retry');
            }
        }

        await pool.execute(`
            INSERT INTO admin_tokens (email, refresh_token, access_token, token_expiry)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
                access_token = VALUES(access_token),
                token_expiry = VALUES(token_expiry),
                updated_at = NOW()
        `, [
            process.env.ADMIN_EMAIL,
            tokens.refresh_token || null,
            tokens.access_token || null,
            tokens.expiry_date || null
        ]);

        console.log('✅ Admin Google token saved.');
        res.redirect('/admin.html?google=connected');
    } catch (err) {
        console.error('OAuth callback error:', err);
        res.redirect('/admin.html?error=' + encodeURIComponent(err.message));
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN CLIENT MANAGEMENT ROUTES (Protected)
// ═══════════════════════════════════════════════════════════════

// GET /api/clients — Get all clients
app.get('/api/clients', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, google_id, email, name, picture, drive_folder_id, created_at, updated_at FROM clients ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (err) {
        console.error('Get clients error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/clients/:id — Get single client
app.get('/api/clients/:id', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM clients WHERE id = ?',
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Client not found.' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/clients/:id/unlink — Unlink Drive folder from client
app.post('/api/clients/:id/unlink', requireAdmin, async (req, res) => {
    try {
        await pool.execute(
            'UPDATE clients SET drive_folder_id = NULL WHERE id = ?',
            [req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// DRIVE PROXY ROUTES (Server-side using Admin Token)
// ═══════════════════════════════════════════════════════════════

// GET /api/drive/list/:folderId — List files in a client folder
app.get('/api/drive/list/:folderId', requireAdmin, async (req, res) => {
    try {
        const auth = await getAdminAuthClient();
        const drive = google.drive({ version: 'v3', auth });

        const response = await drive.files.list({
            q: `'${req.params.folderId}' in parents and trashed=false`,
            fields: 'files(id, name, mimeType, size, thumbnailLink, webViewLink, createdTime)',
            orderBy: 'createdTime desc'
        });

        res.json(response.data.files || []);
    } catch (err) {
        console.error('Drive list error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/drive/upload/:folderId — Upload file to a client folder
app.post('/api/drive/upload/:folderId', requireAdmin, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    try {
        const auth = await getAdminAuthClient();
        const drive = google.drive({ version: 'v3', auth });

        // Convert buffer to readable stream
        const fileStream = new Readable();
        fileStream.push(req.file.buffer);
        fileStream.push(null);

        const response = await drive.files.create({
            requestBody: {
                name: req.file.originalname,
                mimeType: req.file.mimetype,
                parents: [req.params.folderId]
            },
            media: {
                mimeType: req.file.mimetype,
                body: fileStream
            },
            fields: 'id, name, mimeType, size, webViewLink, thumbnailLink'
        });

        res.json({ success: true, file: response.data });
    } catch (err) {
        console.error('Drive upload error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/drive/delete/:fileId — Delete a file from Drive
app.delete('/api/drive/delete/:fileId', requireAdmin, async (req, res) => {
    try {
        const auth = await getAdminAuthClient();
        const drive = google.drive({ version: 'v3', auth });

        await drive.files.delete({ fileId: req.params.fileId });
        res.json({ success: true });
    } catch (err) {
        console.error('Drive delete error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── Catch-all: serve index.html for SPA-style routing ────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`   Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   ENV CHECK: DB_HOST=${process.env.DB_HOST}, DB_NAME=${process.env.DB_NAME}`);
});

// Attempt DB init after server starts (non-blocking)
initDB().then(() => {
    console.log('✅ Database ready.');
}).catch(err => {
    console.error('⚠️  DB init failed (server still running):', err.message);
    // Don't exit — server stays up so /health route can report the error
});
