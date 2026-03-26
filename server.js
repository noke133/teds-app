// server.js — Main Express server (SaaS Version - Client Owned Storage)
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
    schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } }
});

app.use(session({
    key: 'driveshare_sid',
    secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
    store: sessionStore,
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));
// ... (removed express.static from here to move it after custom routes)


// ─── Google OAuth2 Client ─────────────
function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.REDIRECT_URI
    );
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.adminId) return next();
    return res.status(401).json({ error: 'Unauthorized. Please log in as photographer.' });
}
function requireSuperAdmin(req, res, next) {
    if (req.session && req.session.superAdminId) return next();
    return res.status(401).json({ error: 'Unauthorized. Super Admin access required.' });
}
function requireClient(req, res, next) {
    if (req.session && req.session.clientId) return next();
    return res.status(401).json({ error: 'Unauthorized. Please log in with your gallery code.' });
}

// Helper: Get Google Auth Client for specific CLIENT
async function getClientAuthClient(clientId) {
    const [rows] = await pool.execute('SELECT refresh_token, access_token, token_expiry FROM clients WHERE id = ? LIMIT 1', [clientId]);
    if (!rows.length || !rows[0].refresh_token) throw new Error('Client has not connected their Google Drive yet.');

    const tokenData = rows[0];
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        expiry_date: tokenData.token_expiry
    });

    oauth2Client.on('tokens', async (tokens) => {
        await pool.execute(
            'UPDATE clients SET access_token = ?, token_expiry = ? WHERE id = ?',
            [tokens.access_token, tokens.expiry_date, clientId]
        );
    });
    return oauth2Client;
}


app.get('/health', async (req, res) => res.json({ status: 'running', port: PORT }));
app.get('/api/config', (req, res) => res.json({ title: 'Photographer SaaS' }));

// ═══════════════════════════════════════════════════════════════
// SUPER ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════
app.post('/api/superadmin/login', async (req, res) => {
    const { username, password } = req.body;
    const [rows] = await pool.execute('SELECT id FROM super_admins WHERE username = ? AND password = ?', [username, password]);
    if (rows.length > 0) { req.session.superAdminId = rows[0].id; return res.json({ success: true }); }
    res.status(401).json({ error: 'Invalid super admin credentials' });
});
app.post('/api/superadmin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/superadmin/status', requireSuperAdmin, (req, res) => res.json({ loggedIn: true }));
app.get('/api/superadmin/admins', requireSuperAdmin, async (req, res) => {
    const [rows] = await pool.execute('SELECT id, username, email, created_at FROM admins ORDER BY created_at DESC'); res.json(rows);
});
app.post('/api/superadmin/admins', requireSuperAdmin, async (req, res) => {
    const { username, password, email } = req.body;
    try {
        await pool.execute('INSERT INTO admins (username, password, email) VALUES (?, ?, ?)', [username, password, email || null]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/superadmin/admins/:id', requireSuperAdmin, async (req, res) => {
    try { await pool.execute('DELETE FROM admins WHERE id = ?', [req.params.id]); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// PHOTOGRAPHER (ADMIN) ROUTES
// ═══════════════════════════════════════════════════════════════
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const [rows] = await pool.execute('SELECT id, email FROM admins WHERE username = ? AND password = ?', [username, password]);
    if (rows.length > 0) { req.session.adminId = rows[0].id; return res.json({ success: true }); }
    res.status(401).json({ error: 'Invalid photographer credentials.' });
});
app.post('/api/admin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/admin/status', requireAdmin, async (req, res) => res.json({ loggedIn: true }));

app.get('/api/clients', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT id, name, passcode, drive_folder_id, refresh_token IS NOT NULL as isConnected FROM clients WHERE admin_id = ? ORDER BY created_at DESC', [req.session.adminId]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/clients', requireAdmin, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Client name needed.' });
    const passcode = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        const [result] = await pool.execute('INSERT INTO clients (admin_id, name, passcode) VALUES (?, ?, ?)', [req.session.adminId, name, passcode]);
        res.json({ success: true, clientId: result.insertId, passcode: passcode });
    } catch (err) { 
        console.error('Client creation error:', err);
        res.status(500).json({ error: err.message }); 
    }
});

// Photographer fetching clients' drive contents (uses Client's token)
app.get('/api/drive/list/:clientId/:folderId', requireAdmin, async (req, res) => {
    try {
        const auth = await getClientAuthClient(req.params.clientId);
        const drive = google.drive({ version: 'v3', auth });
        const response = await drive.files.list({
            q: `'${req.params.folderId}' in parents and trashed=false`, // folderId is the client's root gallery folder
            fields: 'files(id, name, mimeType, size, thumbnailLink, webContentLink, createdTime)',
            orderBy: 'createdTime desc'
        });
        res.json(response.data.files || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Photographer creating subfolder in Client's drive
app.post('/api/drive/folders/:clientId/:folderId', requireAdmin, async (req, res) => {
    const { name } = req.body;
    try {
        const auth = await getClientAuthClient(req.params.clientId);
        const drive = google.drive({ version: 'v3', auth });
        const folder = await drive.files.create({
            requestBody: { name: name, mimeType: 'application/vnd.google-apps.folder', parents: [req.params.folderId] },
            fields: 'id'
        });
        res.json({ success: true, folderId: folder.data.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Photographer upload session (to client's drive)
app.post('/api/drive/upload-session/:clientId/:folderId', requireAdmin, async (req, res) => {
    const { name, mimeType } = req.body;
    try {
        const auth = await getClientAuthClient(req.params.clientId);
        const tokenResponse = await auth.getAccessToken();
        const response = await axios({
            method: 'post', url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
            headers: { 'Authorization': `Bearer ${tokenResponse.token}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': mimeType },
            data: { name: name, parents: [req.params.folderId] }
        });
        res.json({ sessionUrl: response.headers.location });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create upload session', details: err.response?.data || err.message });
    }
});

// Admin fetching full gallery (similar to client gallery but for admin view)
app.get('/api/admin/gallery/:clientId', requireAdmin, async (req, res) => {
    try {
        const [clientData] = await pool.execute('SELECT drive_folder_id FROM clients WHERE id = ?', [req.params.clientId]);
        const drive_folder_id = clientData[0].drive_folder_id;
        if(!drive_folder_id) return res.json([]);

        const auth = await getClientAuthClient(req.params.clientId);
        const drive = google.drive({ version: 'v3', auth });
        
        const response = await drive.files.list({
            q: `'${drive_folder_id}' in parents and trashed=false`,
            fields: 'files(id, name, mimeType, thumbnailLink, webContentLink)',
            orderBy: 'createdTime desc',
            pageSize: 1000
        });
        
        const subfolders = (response.data.files || []).filter(f => f.mimeType === 'application/vnd.google-apps.folder');
        const images = (response.data.files || []).filter(f => f.mimeType.startsWith('image/'));
        
        for (let sf of subfolders) {
            try {
                const sfRes = await drive.files.list({
                    q: `'${sf.id}' in parents and trashed=false`,
                    fields: 'files(id, name, mimeType, thumbnailLink, webContentLink)',
                    pageSize: 1000
                });
                images.push(...(sfRes.data.files || []).filter(f => f.mimeType.startsWith('image/')).map(f => ({...f, folderName: sf.name})));
            } catch(sfErr) { console.error(`Failed to list subfolder ${sf.name}:`, sfErr.message); }
        }

        res.json(images);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin fetching client selections
app.get('/api/admin/selections/:clientId', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT file_id FROM client_selections WHERE client_id = ?', [req.params.clientId]);
        res.json(rows.map(r => r.file_id));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin download token for direct download from Drive API
app.get('/api/admin/download-token/:clientId', requireAdmin, async (req, res) => {
    try {
        const auth = await getClientAuthClient(req.params.clientId);
        const tokenRes = await auth.getAccessToken();
        res.json({ token: tokenRes.token });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin bulk/single delete files from client's drive
app.delete('/api/drive/files/:clientId/:fileId', requireAdmin, async (req, res) => {
    try {
        const auth = await getClientAuthClient(req.params.clientId);
        const drive = google.drive({ version: 'v3', auth });
        
        await drive.files.delete({ fileId: req.params.fileId });
        await pool.execute('DELETE FROM client_selections WHERE client_id = ? AND file_id = ?', [req.params.clientId, req.params.fileId]);
        
        res.json({ success: true });
    } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// INVOICE & SETTINGS ROUTES (ADMIN)
// ═══════════════════════════════════════════════════════════════

// Get Admin Settings
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM admin_settings WHERE admin_id = ?', [req.session.adminId]);
        res.json(rows[0] || {});
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Save Admin Settings
app.post('/api/admin/settings', requireAdmin, async (req, res) => {
    const { company_name, logo_url, address, email, phone, bank_details } = req.body;
    try {
        const [existing] = await pool.execute('SELECT admin_id FROM admin_settings WHERE admin_id = ?', [req.session.adminId]);
        if (existing.length > 0) {
            await pool.execute(
                'UPDATE admin_settings SET company_name=?, logo_url=?, address=?, email=?, phone=?, bank_details=? WHERE admin_id=?',
                [company_name, logo_url, address, email, phone, bank_details, req.session.adminId]
            );
        } else {
            await pool.execute(
                'INSERT INTO admin_settings (admin_id, company_name, logo_url, address, email, phone, bank_details) VALUES (?,?,?,?,?,?,?)',
                [req.session.adminId, company_name, logo_url, address, email, phone, bank_details]
            );
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create Invoice
app.post('/api/admin/invoices', requireAdmin, async (req, res) => {
    const { client_name, client_address, event_details, invoice_number, date, due_date, status, subtotal, discount, tax_rate, shipping, total, notes, items } = req.body;
    const public_token = crypto.randomBytes(16).toString('hex');
    
    // Start transaction manually via query since the pool helper doesn't expose connection directly securely without grabbing one
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [invRes] = await conn.execute(
            `INSERT INTO invoices (admin_id, public_token, client_name, client_address, event_details, invoice_number, date, due_date, status, subtotal, discount, tax_rate, shipping, total, notes) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.session.adminId, public_token, client_name, client_address, event_details||'', invoice_number, date, due_date, status, subtotal, discount||0, tax_rate, shipping||0, total, notes]
        );
        const invoiceId = invRes.insertId;
        
        for(let item of items) {
            await conn.execute(
                'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price) VALUES (?, ?, ?, ?)',
                [invoiceId, item.description, item.quantity, item.unit_price]
            );
        }
        
        await conn.commit();
        res.json({ success: true, id: invoiceId, public_token });
    } catch (err) { 
        await conn.rollback();
        res.status(500).json({ error: err.message }); 
    } finally {
        conn.release();
    }
});

// Edit Invoice
app.put('/api/admin/invoices/:id', requireAdmin, async (req, res) => {
    const { client_name, client_address, event_details, invoice_number, date, due_date, status, subtotal, discount, tax_rate, shipping, total, notes, items } = req.body;
    const invoiceId = req.params.id;
    
    const conn = await pool.getConnection();
    try {
        // Verify ownership
        const [ownerCheck] = await conn.execute('SELECT admin_id FROM invoices WHERE id = ?', [invoiceId]);
        if (ownerCheck.length === 0 || ownerCheck[0].admin_id !== req.session.adminId) return res.status(403).json({ error: 'Unauthorized' });
        
        await conn.beginTransaction();
        await conn.execute(
            `UPDATE invoices SET client_name=?, client_address=?, event_details=?, invoice_number=?, date=?, due_date=?, status=?, subtotal=?, discount=?, tax_rate=?, shipping=?, total=?, notes=? WHERE id=?`,
            [client_name, client_address, event_details||'', invoice_number, date, due_date, status, subtotal, discount||0, tax_rate, shipping||0, total, notes, invoiceId]
        );
        
        await conn.execute('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
        for(let item of items) {
            await conn.execute(
                'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price) VALUES (?, ?, ?, ?)',
                [invoiceId, item.description, item.quantity, item.unit_price]
            );
        }
        
        await conn.commit();
        res.json({ success: true });
    } catch (err) { 
        await conn.rollback();
        res.status(500).json({ error: err.message }); 
    } finally {
        conn.release();
    }
});

// List Invoices
app.get('/api/admin/invoices', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM invoices WHERE admin_id = ? ORDER BY date DESC, id DESC', [req.session.adminId]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update Invoice Status
app.put('/api/admin/invoices/:id/status', requireAdmin, async (req, res) => {
    try {
        await pool.execute('UPDATE invoices SET status = ? WHERE id = ? AND admin_id = ?', [req.body.status, req.params.id, req.session.adminId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete Invoice
app.delete('/api/admin/invoices/:id', requireAdmin, async (req, res) => {
    try {
        await pool.execute('DELETE FROM invoices WHERE id = ? AND admin_id = ?', [req.params.id, req.session.adminId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC INVOICE ROUTE
// ═══════════════════════════════════════════════════════════════
app.get('/api/invoice/:token', async (req, res) => {
    try {
        const rawToken = req.params.token || '';
        const cleanToken = rawToken.trim().substring(0, 32);
        
        const [invoices] = await pool.execute('SELECT * FROM invoices WHERE public_token = ?', [cleanToken]);
        if (invoices.length === 0) return res.status(404).json({ error: 'Invoice not found.' });
        
        const invoice = invoices[0];
        const [items] = await pool.execute('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoice.id]);
        const [settings] = await pool.execute('SELECT * FROM admin_settings WHERE admin_id = ?', [invoice.admin_id]);
        
        res.json({ invoice, items, settings: settings[0] || {} });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// ═══════════════════════════════════════════════════════════════
// CLIENT ROUTES (GALLERY & GOOGLE AUTH)
// ═══════════════════════════════════════════════════════════════
app.post('/api/client/login', async (req, res) => {
    const { passcode } = req.body;
    if (!passcode) return res.status(400).json({ error: 'Passcode required' });
    const [rows] = await pool.execute('SELECT * FROM clients WHERE passcode = ?', [passcode]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid passcode.' });
    
    const client = rows[0];
    req.session.clientId = client.id;
    req.session.clientAdminId = client.admin_id; 
    
    res.json({ success: true, name: client.name, isConnected: !!client.refresh_token });
});

app.post('/api/client/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/client/status', requireClient, async (req, res) => {
    const [rows] = await pool.execute('SELECT name, refresh_token IS NOT NULL as isConnected FROM clients WHERE id = ?', [req.session.clientId]);
    res.json({ loggedIn: true, name: rows[0]?.name, isConnected: !!rows[0]?.isConnected });
});

app.get('/api/client/download-token', requireClient, async (req, res) => {
    try {
        const auth = await getClientAuthClient(req.session.clientId);
        const tokenRes = await auth.getAccessToken(); // Refreshes if needed
        res.json({ token: tokenRes.token });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Client initiates Google Auth
app.get('/api/client/auth', requireClient, (req, res) => {
    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive'],
        prompt: 'consent' // Force consent to ensure refresh token
    });
    res.redirect(authUrl);
});

// Client oauth callback (Kept as /api/admin/callback to match existing Google Console REDIRECT_URI)
app.get('/api/admin/callback', requireClient, async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.redirect('/?error=' + encodeURIComponent(error));
    if (!code) return res.redirect('/?error=no_code');

    try {
        const oauth2Client = getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        
        // We MUST have a refresh token for offline uploads by photographer
        let refreshTokenToSave = tokens.refresh_token; 
        if (!refreshTokenToSave) {
            const [existing] = await pool.execute('SELECT refresh_token FROM clients WHERE id = ?', [req.session.clientId]);
            if (existing.length && existing[0].refresh_token) {
                refreshTokenToSave = existing[0].refresh_token;
            } else {
                return res.redirect('/?error=' + encodeURIComponent('Google did not return an offline token. Please revoke the app from your Google account and try again.'));
            }
        }

        oauth2Client.setCredentials(tokens);

        // Before returning, ensure setting up the root drive folder for this client
        const drive = google.drive({version: 'v3', auth: oauth2Client});
        
        // Check if we already have a folder ID
        const [current] = await pool.execute('SELECT drive_folder_id, name FROM clients WHERE id = ?', [req.session.clientId]);
        let folderIdStr = current[0].drive_folder_id;
        
        if (!folderIdStr) {
            const folderName = `Photo Gallery - ${current[0].name}`;
            const folderRes = await drive.files.create({
                requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
                fields: 'id'
            });
            folderIdStr = folderRes.data.id;
        }

        await pool.execute(`
            UPDATE clients 
            SET refresh_token = ?, access_token = ?, token_expiry = ?, drive_folder_id = ?
            WHERE id = ?
        `, [refreshTokenToSave, tokens.access_token || null, tokens.expiry_date || null, folderIdStr, req.session.clientId]);

        res.redirect('/?google=connected');
    } catch (err) {
        console.error('Client OAuth callback error:', err);
        res.redirect('/?error=' + encodeURIComponent(err.message));
    }
});

app.get('/api/client/gallery', requireClient, async (req, res) => {
    try {
        const [clientData] = await pool.execute('SELECT drive_folder_id FROM clients WHERE id = ?', [req.session.clientId]);
        const drive_folder_id = clientData[0].drive_folder_id;
        if(!drive_folder_id) return res.json([]);

        const auth = await getClientAuthClient(req.session.clientId);
        const drive = google.drive({ version: 'v3', auth });
        
        const response = await drive.files.list({
            q: `'${drive_folder_id}' in parents and trashed=false`,
            fields: 'files(id, name, mimeType, thumbnailLink, webContentLink, createdTime)',
            orderBy: 'createdTime desc',
            pageSize: 1000
        });
        
        const subfolders = (response.data.files || []).filter(f => f.mimeType === 'application/vnd.google-apps.folder');
        const images = (response.data.files || []).filter(f => f.mimeType.startsWith('image/'));
        
        for (let sf of subfolders) {
            try {
                const sfRes = await drive.files.list({
                    q: `'${sf.id}' in parents and trashed=false`,
                    fields: 'files(id, name, mimeType, thumbnailLink, webContentLink)',
                    pageSize: 1000
                });
                images.push(...(sfRes.data.files || []).filter(f => f.mimeType.startsWith('image/')).map(f => ({...f, folderName: sf.name})));
            } catch(sfErr) { console.error(`Failed to list subfolder ${sf.name}:`, sfErr.message); }
        }

        res.json(images);
    } catch (err) { console.error("Client Gallery API Error:", err); res.status(500).json({ error: err.message }); }
});

app.get('/api/client/selections', requireClient, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT file_id FROM client_selections WHERE client_id = ?', [req.session.clientId]);
        res.json(rows.map(r => r.file_id));
    } catch (err) { console.error("Get Selections Error:", err); res.status(500).json({ error: err.message }); }
});

app.post('/api/client/selections', requireClient, async (req, res) => {
    const { file_id, selected } = req.body;
    console.log(`Selection update: client=${req.session.clientId}, file=${file_id}, selected=${selected}`);
    try {
        if (selected) {
            await pool.execute('INSERT IGNORE INTO client_selections (client_id, file_id) VALUES (?, ?)', [req.session.clientId, file_id]);
        } else {
            await pool.execute('DELETE FROM client_selections WHERE client_id = ? AND file_id = ?', [req.session.clientId, file_id]);
        }
        res.json({ success: true });
    } catch (err) { console.error("Post Selections Error:", err); res.status(500).json({ error: err.message }); }
});

// ─── Routing mappings ─────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/gallery', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gallery.html')));
app.get('/superadmin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/invoice', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoice.html')));

app.get('*', (req, res) => {
    if (req.accepts('html')) {
        // Default to landing page for unknown routes if not specifically handled
        res.sendFile(path.join(__dirname, 'public', 'landing.html'));
    } else {
        res.status(404).end();
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
    console.log(`🚀 Photographer SaaS App running at http://localhost:${PORT}`);
});
initDB().then(() => console.log('✅ Database ready.')).catch(err => console.error('⚠️ DB init failed:', err.message));
