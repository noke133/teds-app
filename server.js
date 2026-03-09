const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const multer = require('multer');
require('dotenv').config();

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- App Root ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// 0. Configuration for clients
app.get('/api/config', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT admin_email FROM settings WHERE id = 1');
        res.json({
            GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
            ADMIN_EMAIL: (rows[0] && rows[0].admin_email) || null
        });
    } catch (err) {
        res.json({ GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID });
    }
});

// --- API Endpoints ---

// 1. Register or get client
app.post('/api/register', async (req, res) => {
    try {
        const { google_id, email, name, picture } = req.body;
        let drive_folder_id = req.body.drive_folder_id;

        if (!google_id || !email || !name) {
            return res.status(400).json({ error: 'Missing required Google Auth fields' });
        }

        const [rows] = await db.query('SELECT * FROM clients WHERE google_id = ?', [google_id]);
        let client = rows[0];

        // NEW LOGIC: Create Admin-owned folder if needed
        if (!drive_folder_id && (!client || !client.drive_folder_id)) {
            try {
                const adminToken = await getAdminAccessToken();
                const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: `App-Data-${name}`, mimeType: 'application/vnd.google-apps.folder' })
                });

                const createData = await createRes.json();
                if (createData.error) throw new Error(createData.error.message);

                drive_folder_id = createData.id;

                // Share back to client (Optional view/edit access)
                await fetch(`https://www.googleapis.com/drive/v3/files/${drive_folder_id}/permissions`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email })
                }).catch(e => console.error("Could not share back to client:", e));
            } catch (err) {
                console.error("Admin Folder Creation Error:", err);
            }
        }

        if (client) {
            // Update existing client
            let updateQuery = 'UPDATE clients SET name = ?, picture = ?';
            const queryParams = [name, picture];

            // Only update drive_folder_id if provided and current is null
            if (drive_folder_id && !client.drive_folder_id) {
                updateQuery += ', drive_folder_id = ?';
                queryParams.push(drive_folder_id);
            }

            updateQuery += ' WHERE id = ?';
            queryParams.push(client.id);

            await db.query(updateQuery, queryParams);

            // Re-fetch
            const [updated] = await db.query('SELECT * FROM clients WHERE id = ?', [client.id]);
            return res.json({ success: true, client: updated[0] });
        } else {
            // Insert new client
            const [result] = await db.query(
                'INSERT INTO clients (google_id, email, name, picture, drive_folder_id) VALUES (?, ?, ?, ?, ?)',
                [google_id, email, name, picture, drive_folder_id || null]
            );

            const [newClient] = await db.query('SELECT * FROM clients WHERE id = ?', [result.insertId]);
            return res.json({ success: true, client: newClient[0] });
        }
    } catch (err) {
        console.error("Registration Error Detail:", err);
        res.status(500).json({
            error: 'Database error during registration',
            details: err.message,
            code: err.code
        });
    }
});

// 2. Get all clients for admin
app.get('/api/clients', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM clients ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

// 3. Get single client
app.get('/api/clients/:id', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch client' });
    }
});

// 4. Unlink Google Drive ID
app.post('/api/clients/:id/unlink', async (req, res) => {
    try {
        await db.query('UPDATE clients SET drive_folder_id = NULL WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Client folder unlinked' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to unlink client' });
    }
});

// --- PERSISTENT ADMIN AUTH (GOOGLE OAUTH2) ---

// A. Exchange Auth Code for Refresh Token (One-time setup)
app.post('/api/admin/auth/exchange', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Code missing" });

    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: 'postmessage',
                grant_type: 'authorization_code'
            })
        });

        const data = await tokenRes.json();
        if (data.error) throw new Error(data.error_description || data.error);

        // Fetch Admin Info to get Email
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${data.access_token}` }
        });
        const userData = await userRes.json();

        // Save refresh token and email to DB
        await db.query(
            'INSERT INTO settings (id, admin_refresh_token, admin_email) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE admin_refresh_token = ?, admin_email = ?',
            [data.refresh_token, userData.email, data.refresh_token, userData.email]
        );

        res.json({ success: true, message: "Offline access enabled!", email: userData.email });
    } catch (err) {
        console.error("Token Exchange Error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/auth/status', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT admin_refresh_token, admin_email FROM settings WHERE id = 1');
        res.json({
            connected: !!(rows[0] && rows[0].admin_refresh_token),
            email: (rows[0] && rows[0].admin_email) || null
        });
    } catch (err) {
        res.json({ connected: false });
    }
});

// Helper: Get fresh access token from Refresh Token
async function getAdminAccessToken() {
    const [rows] = await db.query('SELECT admin_refresh_token FROM settings WHERE id = 1');
    if (!rows[0] || !rows[0].admin_refresh_token) throw new Error("No Admin Refresh Token found. Please connect admin account.");

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: rows[0].admin_refresh_token,
            grant_type: 'refresh_token'
        })
    });

    const data = await res.json();
    if (data.error) throw new Error("Refresh failed: " + data.error);
    return data.access_token;
}

// B. PROXY: List Drive Files
app.get('/api/admin/drive/list/:folderId', async (req, res) => {
    try {
        const token = await getAdminAccessToken();
        const q = `'${req.params.folderId}' in parents and trashed=false`;
        const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,thumbnailLink,mimeType,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await driveRes.json();
        if (!driveRes.ok) throw new Error(data.error?.message || "List failed");
        res.json(data.files || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// C. PROXY: Upload File (Robust Multipart Handling)
app.post('/api/admin/drive/upload/:folderId', upload.single('file'), async (req, res) => {
    try {
        const token = await getAdminAccessToken();
        const metadata = {
            name: req.file.originalname,
            parents: [req.params.folderId]
        };

        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const closeDelim = "\r\n--" + boundary + "--";

        const contentType = req.file.mimetype || 'application/octet-stream';
        const metadataPart = 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata);

        // Construct the multipart body as a Buffer
        const bodyBuffer = Buffer.concat([
            Buffer.from(delimiter + metadataPart + delimiter + 'Content-Type: ' + contentType + '\r\n\r\n'),
            req.file.buffer,
            Buffer.from(closeDelim)
        ]);

        const driveRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'multipart/related; boundary=' + boundary
            },
            body: bodyBuffer
        });

        const data = await driveRes.json();
        if (!driveRes.ok) throw new Error(data.error?.message || "Google Drive Upload Failed");

        res.json(data);
    } catch (err) {
        console.error("Proxy Upload Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// E. Connection Test Endpoint
app.get('/api/admin/drive/test', async (req, res) => {
    try {
        const token = await getAdminAccessToken();
        const driveRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await driveRes.json();
        res.json({ success: true, user: data.user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// D. PROXY: Delete File
app.delete('/api/admin/drive/delete/:fileId', async (req, res) => {
    try {
        const token = await getAdminAccessToken();
        const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${req.params.fileId}?supportsAllDrives=true`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!driveRes.ok) {
            const data = await driveRes.json();
            throw new Error(data.error?.message || "Delete failed");
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express server running on port ${PORT}`);
    console.log(`DB Host: ${process.env.DB_HOST}`);
});
