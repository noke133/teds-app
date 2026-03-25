/**
 * Invoice Administration Script for Photographer SaaS
 * Handles Settings, Listing, Creating, Deleting, and Sharing Invoices.
 */

// Global Variables
let currentInvoices = [];
let invoiceItems = [];

// Navigation & Initialization
function showInvoices() {
    hideAllViews();
    document.getElementById('invoicesView').classList.remove('hidden');
    const dNav = document.getElementById('navInvoices'); 
    if(dNav) dNav.classList.add('active');
    loadInvoices();
}

// Load Invoices List
async function loadInvoices() {
    try {
        const res = await fetch('/api/admin/invoices');
        currentInvoices = await res.json();
        
        const tbody = document.getElementById('invoicesListBody');
        tbody.innerHTML = '';
        
        if(currentInvoices.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-muted);">No invoices found. Click "New Invoice" to create one.</td></tr>';
            return;
        }

        currentInvoices.forEach(inv => {
            const statusColor = inv.status.toLowerCase() === 'paid' ? 'var(--accent-green)' : 'var(--accent-red)';
            const d = new Date(inv.date).toLocaleDateString();
            
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 12px; font-weight:600; color: var(--text-base);">${inv.invoice_number}</td>
                    <td style="padding: 12px; font-weight:500;">${inv.client_name}</td>
                    <td style="padding: 12px; color: var(--text-muted);">${d}</td>
                    <td style="padding: 12px; font-weight:700;">₹${inv.total}</td>
                    <td style="padding: 12px;">
                       <select onchange="updateInvoiceStatus(${inv.id}, this.value)" style="padding:4px 8px; border-radius:4px; font-weight:600; background:${statusColor}22; color:${statusColor}; border:none;">
                          <option value="Unpaid" ${inv.status.toLowerCase()==='unpaid'?'selected':''}>Unpaid</option>
                          <option value="Paid" ${inv.status.toLowerCase()==='paid'?'selected':''}>Paid</option>
                       </select>
                    </td>
                    <td style="padding: 12px; text-align: right; display:flex; gap:8px; justify-content:flex-end;">
                       <button class="btn btn-ghost" style="padding:6px 10px;" onclick="window.open('/invoice?token=${inv.public_token}', '_blank')" title="View Public Invoice"><i class="bi bi-eye"></i></button>
                       <button class="btn btn-ghost" style="padding:6px 10px; color:var(--primary);" onclick="editInvoice(${inv.id})" title="Edit Invoice"><i class="bi bi-pencil"></i></button>
                       <button class="btn btn-ghost" style="padding:6px 10px; color:var(--accent-green);" onclick="shareWhatsApp('${inv.public_token}', '${inv.client_name}', '${inv.total}')" title="Send WhatsApp"><i class="bi bi-whatsapp"></i></button>
                       <button class="btn btn-ghost" style="padding:6px 10px; color:var(--accent-red);" onclick="deleteInvoice(${inv.id})" title="Delete"><i class="bi bi-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch(err) {
        showToast('Failed to load invoices', 'error');
        console.error(err);
    }
}

// Ensure old navigation functions properly toggle this view
function hideAllViews() {
    ['mainDashboard', 'createClientView', 'folderSection', 'invoicesView'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });
    ['navDashboard', 'navCreate', 'navInvoices'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.remove('active');
    });
}

// ----------------------------------------------------
// SETTINGS
// ----------------------------------------------------
async function openInvoiceSettings() {
    document.getElementById('invoiceSettingsModal').classList.remove('hidden');
    try {
        const res = await fetch('/api/admin/settings');
        const settings = await res.json();
        if(settings) {
            document.getElementById('setCompany').value = settings.company_name || '';
            document.getElementById('setLogo').value = settings.logo_url || '';
            document.getElementById('setAddress').value = settings.address || '';
            document.getElementById('setEmail').value = settings.email || '';
            document.getElementById('setPhone').value = settings.phone || '';
            document.getElementById('setBank').value = settings.bank_details || '';
        }
    } catch(err) { showToast('Warning: Unable to fetch settings', 'error'); }
}

function closeInvoiceSettings() {
    document.getElementById('invoiceSettingsModal').classList.add('hidden');
}

document.getElementById('invoiceSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        company_name: document.getElementById('setCompany').value,
        logo_url: document.getElementById('setLogo').value,
        address: document.getElementById('setAddress').value,
        email: document.getElementById('setEmail').value,
        phone: document.getElementById('setPhone').value,
        bank_details: document.getElementById('setBank').value
    };
    try {
        const res = await fetch('/api/admin/settings', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        if(res.ok) {
            showToast('Settings Saved!', 'success');
            closeInvoiceSettings();
        } else throw new Error("Server rejected settings");
    } catch(err) { showToast('Failed to save settings: ' + err.message, 'error'); }
});

// ----------------------------------------------------
// COMPOSER
// ----------------------------------------------------
let editingInvoiceId = null;

function openInvoiceComposer() {
    editingInvoiceId = null;
    document.getElementById('composerTitle').innerText = 'New Invoice';
    document.getElementById('invoiceComposerModal').classList.remove('hidden');
    document.getElementById('invoiceComposerForm').reset();
    document.getElementById('invDate').valueAsDate = new Date();
    
    let d = new Date(); d.setDate(d.getDate() + 7); // Default due is +7 days
    document.getElementById('invDueDate').valueAsDate = d;
    
    document.getElementById('invNumber').value = 'INV-' + Math.floor(Math.random()*90000 + 10000);
    
    invoiceItems = [{ id: Date.now(), description: 'Photography Services', quantity: 1, unit_price: 15000 }];
    renderInvoiceItems();
}

async function editInvoice(id) {
    try {
        const res = await fetch('/api/invoice/' + currentInvoices.find(i=>i.id===id).public_token);
        const { invoice, items } = await res.json();
        
        editingInvoiceId = id;
        document.getElementById('composerTitle').innerText = 'Edit Invoice ' + invoice.invoice_number;
        document.getElementById('invoiceComposerModal').classList.remove('hidden');
        
        document.getElementById('invClientName').value = invoice.client_name;
        document.getElementById('invClientAddr').value = invoice.client_address || '';
        document.getElementById('invEventDetails').value = invoice.event_details || '';
        document.getElementById('invNumber').value = invoice.invoice_number;
        document.getElementById('invDate').value = invoice.date.split('T')[0];
        document.getElementById('invDueDate').value = invoice.due_date.split('T')[0];
        document.getElementById('invStatus').value = invoice.status;
        document.getElementById('invDiscount').value = invoice.discount || 0;
        document.getElementById('invTaxRate').value = invoice.tax_rate;
        document.getElementById('invShipping').value = invoice.shipping || 0;
        document.getElementById('invNotes').value = invoice.notes || '';
        
        invoiceItems = items.map(it => ({ id: it.id, description: it.description, quantity: it.quantity, unit_price: it.unit_price }));
        renderInvoiceItems();
    } catch(err) { showToast('Unable to open invoice for editing', 'error'); }
}

function closeInvoiceComposer() {
    document.getElementById('invoiceComposerModal').classList.add('hidden');
}

function renderInvoiceItems() {
    const container = document.getElementById('invItemsList');
    container.innerHTML = '';
    invoiceItems.forEach((item, index) => {
        container.innerHTML += `
            <div style="display:flex; gap:8px; align-items:center; background:var(--bg-app); padding:8px; border-radius:4px;">
                <input type="text" class="form-input" style="flex:1;" value="${item.description}" 
                       onchange="updateItem(${index}, 'description', this.value)" placeholder="Item Description">
                <input type="number" class="form-input" style="width:70px;" value="${item.quantity}" min="1" 
                       onchange="updateItem(${index}, 'quantity', this.value)">
                <input type="number" class="form-input" style="width:120px;" value="${item.unit_price}" step="0.01" 
                       onchange="updateItem(${index}, 'unit_price', this.value)" placeholder="Price">
                <button type="button" class="btn btn-ghost" style="color:var(--accent-red); padding:4px 8px;" onclick="removeInvoiceItem(${index})"><i class="bi bi-x-lg"></i></button>
            </div>
        `;
    });
    calculateInvoiceTotal();
}

function addInvoiceItem() {
    invoiceItems.push({ id: Date.now(), description: '', quantity: 1, unit_price: 0 });
    renderInvoiceItems();
}

function removeInvoiceItem(index) {
    invoiceItems.splice(index, 1);
    renderInvoiceItems();
}

function updateItem(index, field, value) {
    invoiceItems[index][field] = field==='description' ? value : parseFloat(value) || 0;
    calculateInvoiceTotal();
}

function calculateInvoiceTotal() {
    let subtotal = invoiceItems.reduce((acc, item) => acc + (item.quantity * item.unit_price), 0);
    let discount = parseFloat(document.getElementById('invDiscount').value) || 0;
    let subLessDiscount = Math.max(0, subtotal - discount);
    
    let taxRate = parseFloat(document.getElementById('invTaxRate').value) || 0;
    let taxAmt = subLessDiscount * (taxRate / 100);
    let shipping = parseFloat(document.getElementById('invShipping').value) || 0;
    
    let total = subLessDiscount + taxAmt + shipping;
    
    document.getElementById('invCalcSub').innerText = subtotal.toFixed(2);
    document.getElementById('invCalcTot').innerText = total.toFixed(2);
    
    document.getElementById('invCalcSub').dataset.val = subtotal;
    document.getElementById('invCalcTot').dataset.val = total;
}

document.getElementById('invoiceComposerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(invoiceItems.length === 0) return showToast('Please add at least one item.', 'error');
    
    const payload = {
        client_name: document.getElementById('invClientName').value,
        client_address: document.getElementById('invClientAddr').value,
        event_details: document.getElementById('invEventDetails').value,
        invoice_number: document.getElementById('invNumber').value,
        date: document.getElementById('invDate').value,
        due_date: document.getElementById('invDueDate').value,
        status: document.getElementById('invStatus').value,
        subtotal: parseFloat(document.getElementById('invCalcSub').dataset.val) || 0,
        discount: parseFloat(document.getElementById('invDiscount').value) || 0,
        tax_rate: parseFloat(document.getElementById('invTaxRate').value) || 0,
        shipping: parseFloat(document.getElementById('invShipping').value) || 0,
        total: parseFloat(document.getElementById('invCalcTot').dataset.val) || 0,
        notes: document.getElementById('invNotes').value,
        items: invoiceItems
    };
    
    try {
        const url = editingInvoiceId ? `/api/admin/invoices/${editingInvoiceId}` : '/api/admin/invoices';
        const method = editingInvoiceId ? 'PUT' : 'POST';
        
        const res = await fetch(url, {
            method: method, headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        if(res.ok) {
            showToast('Invoice Saved!', 'success');
            closeInvoiceComposer();
            loadInvoices();
        } else throw new Error("Server rejected invoice");
    } catch(err) { showToast('Failed to save invoice: ' + err.message, 'error'); }
});

// ----------------------------------------------------
// ACTIONS
// ----------------------------------------------------
async function updateInvoiceStatus(id, status) {
    try {
        await fetch('/api/admin/invoices/' + id + '/status', {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({status})
        });
        showToast('Status updated to ' + status, 'success');
        loadInvoices();
    } catch(err) { showToast('Failed to update status', 'error'); }
}

async function deleteInvoice(id) {
    if(!confirm("Are you sure you want to completely delete this invoice?")) return;
    try {
        await fetch('/api/admin/invoices/' + id, { method: 'DELETE' });
        showToast('Invoice deleted', 'success');
        loadInvoices();
    } catch(err) { showToast('Failed to delete invoice', 'error'); }
}

function shareWhatsApp(token, clientName, totalAmount) {
    const link = window.location.origin + '/invoice?token=' + token;
    const msg = `Hello ${clientName},\n\nYour invoice for ₹${totalAmount} has been generated.\n\nYou can view it here:\n${link}\n\nThank you for choosing our services!`;
    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
}
