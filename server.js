const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Health Check / Root ---
app.get('/', (req, res) => {
    res.send('TDS App Express Server is Running!');
});

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// --- API Endpoints ---

// 1. Register or get client
app.post('/api/register', async (req, res) => {
    try {
        const { google_id, email, name, picture, drive_folder_id } = req.body;

        if (!google_id || !email || !name) {
            return res.status(400).json({ error: 'Missing required Google Auth fields' });
        }

        const [rows] = await db.query('SELECT * FROM clients WHERE google_id = ?', [google_id]);
        let client = rows[0];

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
        console.error(err);
        res.status(500).json({ error: 'Database error during registration' });
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express server running on port ${PORT}`);
    console.log(`DB Host: ${process.env.DB_HOST}`);
});
