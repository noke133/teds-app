/**
 * Google Drive Integration Service for PHP App - v5
 */
window.DriveUI = {
    accessToken: null,

    executeWithToken: async function (user, token) {
        console.log("Executing Drive automation for:", user.email);
        const statusEl = document.getElementById('drive-status');
        this.accessToken = token;

        try {
            statusEl.innerText = 'Creating Google Drive Folder...';
            const folderName = `App-Data-${user.name}`;
            const folderId = await this.createFolderIfNotExists(folderName);

            statusEl.innerText = 'Folder Ready. Syncing with Admin...';
            console.log("Folder ID created/found:", folderId);

            // Register with PHP backend (MySQL)
            await this.registerWithPHP(user, folderId);

            statusEl.innerText = 'Success! Fully Synced ✅';
            statusEl.style.background = '#e6f4ea';
            statusEl.style.color = '#137333';
        } catch (error) {
            console.error("Drive Automation Error:", error);
            statusEl.innerText = 'Error: ' + error.message;
            statusEl.style.background = '#fce8e6';
            statusEl.style.color = '#c5221f';
        }
    },

    registerWithPHP: async function (user, folderId) {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                google_id: user.sub || user.id,
                email: user.email,
                name: user.name,
                picture: user.picture,
                drive_folder_id: folderId
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error('Server Error: ' + text);
        }

        const data = await response.json();
        console.log("Server Response:", data);
        return data;
    },

    createFolderIfNotExists: async function (name) {
        const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
        const searchRes = await fetch(`${DRIVE_API_URL}?q=name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, {
            headers: { Authorization: `Bearer ${this.accessToken}` }
        });

        if (!searchRes.ok) {
            const err = await searchRes.json();
            throw new Error('Google Search Error: ' + (err.error?.message || 'Unknown'));
        }

        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
            return searchData.files[0].id;
        }

        const createRes = await fetch(DRIVE_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder' })
        });

        if (!createRes.ok) {
            const err = await createRes.json();
            throw new Error('Google Create Error: ' + (err.error?.message || 'Unknown'));
        }

        const createData = await createRes.json();

        // Share the folder so Admin can upload to it
        await fetch(`https://www.googleapis.com/drive/v3/files/${createData.id}/permissions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ role: 'writer', type: 'anyone' })
        });

        return createData.id;
    },



    uploadFile: async function (file, folderId) {
        if (!folderId || folderId === 'undefined') throw new Error('Invalid Folder ID. Check client login.');

        const metadata = {
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            parents: [folderId]
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', file);

        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.accessToken}`
            },
            body: form
        });

        if (!res.ok) {
            let errorMsg = 'Upload Failed';
            try {
                const errJson = await res.json();
                if (errJson.error && errJson.error.message) {
                    errorMsg = errJson.error.message;
                }
            } catch (e) {
                errorMsg = await res.text();
            }
            throw new Error(errorMsg);
        }

        return await res.json();
    },

    listAllFiles: async function (folderId) {
        const q = `'${folderId}' in parents and trashed=false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,thumbnailLink,mimeType,webViewLink)`, {
            headers: { Authorization: `Bearer ${this.accessToken}` }
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error('List Failed: ' + (err.error?.message || 'Unknown'));
        }

        const data = await res.json();
        return data.files || [];
    },

    deleteFile: async function (fileId) {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${this.accessToken}` }
        });
        if (!res.ok) throw new Error('Delete Failed');
        return true;
    }
};

console.log("DriveUI v5 loaded. methods:", Object.keys(window.DriveUI));
