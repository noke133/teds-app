/**
 * drive.js — Client-side Google Drive logic
 * Handles: Google login → folder creation → permission sharing → server registration
 */

const App = {
    user: null,
    accessToken: null,
    folderId: null,
    folderName: null,
    tokenClient: null,
    config: null,

    // ─── Bootstrap ─────────────────────────────────────────────
    async init() {
        // Restore session from localStorage
        const saved = localStorage.getItem('ds_client');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.user = data.user;
                this.folderId = data.folderId;
                this.folderName = data.folderName;
                this.showDashboard();
                return;
            } catch (e) {
                localStorage.removeItem('ds_client');
            }
        }
        this.showLogin();
    },

    // ─── UI Helpers ──────────────────────────────────────────────
    showLogin()     { switchView('login-view'); },
    showSetup()     { switchView('setup-view'); },
    showDashboard() {
        switchView('dashboard-view');
        document.getElementById('dash-name').textContent  = this.user?.name  || '—';
        document.getElementById('dash-email').textContent = this.user?.email || '—';
        document.getElementById('dash-avatar').src        = this.user?.picture || '';
        document.getElementById('folder-name-sub').textContent = this.folderName || 'Your folder';
        const fl = document.getElementById('folder-link');
        if (this.folderId) {
            fl.href = `https://drive.google.com/drive/folders/${this.folderId}`;
        }
        this.loadFiles();
    },

    // ─── Step 1: Trigger Google Login ────────────────────────────
    async startLogin() {
        if (!this.config) {
            this.config = await fetch('/api/config').then(r => r.json());
        }

        // Initialize Google Identity Services token client
        this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: this.config.GOOGLE_CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/drive openid email profile',
            callback: (tokenResponse) => this.handleTokenResponse(tokenResponse)
        });

        this.tokenClient.requestAccessToken({ prompt: 'consent' });
    },

    // ─── Step 2: Handle Token Response ───────────────────────────
    async handleTokenResponse(tokenResponse) {
        if (tokenResponse.error) {
            toast('Google sign-in failed: ' + tokenResponse.error, 'error');
            return;
        }
        this.accessToken = tokenResponse.access_token;
        this.showSetup();

        try {
            setStep(1, 'done');
            setProgress(20);

            // Fetch user info from Google
            const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${this.accessToken}` }
            }).then(r => r.json());
            this.user = userInfo;

            setStep(2, 'active');
            setProgress(40);
            updateStatus('Creating your Drive folder…', 'info');

            // Create folder
            this.folderName = `Share-${userInfo.name}`;
            this.folderId = await this.createDriveFolder(this.folderName);

            setStep(2, 'done');
            setStep(3, 'active');
            setProgress(65);
            updateStatus('Setting up permissions…', 'info');

            // Share folder with admin
            await this.shareFolderWithAdmin(this.folderId);

            setStep(3, 'done');
            setStep(4, 'active');
            setProgress(85);
            updateStatus('Syncing with server…', 'info');

            // Register with backend
            await this.registerWithServer(userInfo, this.folderId);

            setStep(4, 'done');
            setProgress(100);
            updateStatus('All set! Redirecting to your dashboard…', 'success');

            // Save to localStorage
            localStorage.setItem('ds_client', JSON.stringify({
                user: this.user,
                folderId: this.folderId,
                folderName: this.folderName
            }));

            setTimeout(() => this.showDashboard(), 1200);
        } catch (err) {
            console.error('Setup error:', err);
            updateStatus('Error: ' + err.message, 'error');
            toast(err.message, 'error');
        }
    },

    // ─── Create Drive Folder ──────────────────────────────────────
    async createDriveFolder(name) {
        const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
        const headers = { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' };

        // Search for existing folder
        const search = await fetch(
            `${DRIVE_API}?q=${encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}`,
            { headers }
        );
        const searchData = await search.json();
        if (searchData.files && searchData.files.length > 0) {
            console.log('Folder already exists:', searchData.files[0].id);
            return searchData.files[0].id;
        }

        // Create new folder
        const create = await fetch(DRIVE_API, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' })
        });
        if (!create.ok) {
            const e = await create.json();
            throw new Error('Drive folder creation failed: ' + (e.error?.message || 'Unknown'));
        }
        const created = await create.json();
        return created.id;
    },

    // ─── Share Folder with Admin ──────────────────────────────────
    async shareFolderWithAdmin(folderId) {
        const headers = { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' };
        const permsUrl = `https://www.googleapis.com/drive/v3/files/${folderId}/permissions?sendNotificationEmail=false`;

        const emailsToShare = [this.config.ADMIN_EMAIL].filter(Boolean);

        for (const email of emailsToShare) {
            try {
                const r = await fetch(permsUrl, {
                    method: 'POST', headers,
                    body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email })
                });
                if (!r.ok) {
                    const err = await r.json();
                    console.warn(`Permission for ${email} failed:`, err.error?.message);
                }
            } catch (e) {
                console.warn('Share error:', e);
            }
        }
    },

    // ─── Register with Backend ────────────────────────────────────
    async registerWithServer(user, folderId) {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                google_id: user.sub,
                email: user.email,
                name: user.name,
                picture: user.picture,
                drive_folder_id: folderId
            })
        });
        if (!res.ok) throw new Error('Server registration failed: ' + await res.text());
        return res.json();
    },

    // ─── Load Files (from admin's server-side API) for dashboard ─
    async loadFiles() {
        const container = document.getElementById('files-container');
        if (!this.folderId) {
            container.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><h3>No folder linked</h3><p>Please log in again.</p></div>`;
            return;
        }

        container.innerHTML = `<div class="status-bar info"><div class="spinner"></div><span>Loading files…</span></div>`;

        try {
            // We call the server-side list route (needs admin session) as a fallback,
            // but for client we actually list directly from Drive using their token
            const headers = { Authorization: `Bearer ${this.accessToken}` };
            const q = encodeURIComponent(`'${this.folderId}' in parents and trashed=false`);
            const res = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,thumbnailLink,webViewLink,createdTime)&orderBy=createdTime%20desc`,
                { headers }
            );

            if (!res.ok) throw new Error('Failed to list files');
            const data = await res.json();
            const files = data.files || [];

            document.getElementById('files-count').textContent = files.length === 0 ? 'No files yet' : `${files.length} file${files.length !== 1 ? 's' : ''}`;

            if (files.length === 0) {
                container.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><h3>No files yet</h3><p>Files uploaded by the admin will appear here.</p></div>`;
                return;
            }

            container.innerHTML = `<div class="file-list">${files.map(f => fileItemHTML(f)).join('')}</div>`;
        } catch (err) {
            container.innerHTML = `<div class="alert alert-warning">⚠️ ${err.message}. Your token may have expired — please refresh the page and sign in again.</div>`;
        }
    }
};

// ─── UI Utility Functions ─────────────────────────────────────────
function switchView(id) {
    ['login-view','setup-view','dashboard-view'].forEach(v => {
        const el = document.getElementById(v);
        if (el) el.classList.toggle('hidden', v !== id);
    });
}

function updateStatus(msg, type = 'info') {
    const el = document.getElementById('setup-status');
    el.className = `status-bar ${type}`;
    const isLoading = type === 'info' && msg !== 'All set! Redirecting to your dashboard…';
    el.innerHTML = (isLoading ? '<div class="spinner"></div>' : (type === 'success' ? '✅' : '❌')) + `<span>${msg}</span>`;
}

function setProgress(pct) {
    document.getElementById('setup-progress').style.width = pct + '%';
}

function setStep(num, state) {
    const el = document.getElementById(`step-${num}`);
    if (!el) return;
    const labels = ['','Authenticating with Google Drive…','Creating your personal folder…','Setting up access permissions…','Syncing with server…'];
    el.textContent = (state === 'done' ? '✅ ' : state === 'active' ? '🔄 ' : '⬜ ') + labels[num];
}

function fileItemHTML(f) {
    const icon = getFileIcon(f.mimeType);
    const size = f.size ? formatSize(parseInt(f.size)) : '—';
    const date = f.createdTime ? new Date(f.createdTime).toLocaleDateString() : '';
    return `
    <div class="file-item">
      <div class="file-icon">${icon}</div>
      <div class="file-info">
        <div class="file-name">${escHtml(f.name)}</div>
        <div class="file-meta">${size}${date ? ' · ' + date : ''}</div>
      </div>
      <div class="file-actions">
        <a href="${f.webViewLink}" target="_blank" class="btn btn-ghost btn-sm">↗ Open</a>
      </div>
    </div>`;
}

function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
    if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '🗜️';
    if (mimeType.includes('folder')) return '📁';
    return '📄';
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
    return (bytes/1024/1024/1024).toFixed(2) + ' GB';
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 4000);
}

function logout() {
    localStorage.removeItem('ds_client');
    App.user = null; App.folderId = null; App.accessToken = null;
    App.showLogin();
}

// ─── Expose globals called by HTML ───────────────────────────────
window.startGoogleLogin = () => App.startLogin();
window.loadFiles = () => App.loadFiles();
window.logout = logout;

// ─── Boot ─────────────────────────────────────────────────────────
App.init();
