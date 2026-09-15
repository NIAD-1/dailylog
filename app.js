import { db, doc, getDoc, setDoc, serverTimestamp, collection, writeBatch } from "./db.js";
import { initAuth, signIn, logOut, currentUser, currentUserRole } from "./auth.js";
import { navigate, clearRoot } from "./ui.js";
import { startReportWizard, setWizardUser } from "./wizard.js";
import { bindDashboard, setDashboardUserRole } from "./dashboard.js";
import { renderSchedulerPage, setSchedulerUser } from "./scheduler.js";
import { renderMapPage } from "./map.js";
import { renderWeeklySummaryPage } from "./weekly.js";
import { renderFacilityProfilePage, setFacilityProfileUser } from "./facility-profile.js";
import { renderComplaintLoggerPage, renderSanctionLoggerPage } from "./smart-loggers.js";
import { renderWorkflowPage } from "./workflow.js";

// Activity Hub Engine and Domain Configs
import { renderActivityHub } from "./activity-hub.js";
import {
  ALERTS_CONFIG,
  COMPLAINTS_CONFIG,
  GSDP_CONFIG,
  SURVEILLANCE_CONFIG,
  GLSI_CONFIG
} from "./activity-configs.js";

const root = document.getElementById('app');
const sidebar = document.getElementById('sidebar');
const sidebarNav = document.getElementById('sidebarNav');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const btnHamburger = document.getElementById('btnHamburger');
const btnSignIn = document.getElementById('btnSignIn');
const btnSignOut = document.getElementById('btnSignOut');
const userInfo = document.getElementById('userInfo');

let authReady = false;
let currentPage = 'report';

// ─── Settings HTML Template ──────────────────────────────────────────────────
const pageKpiSettings = `
<section class="card" style="max-width: 680px; margin: auto;">
  <h2>Directorate & Integration Settings</h2>
  <p class="muted">Configure SharePoint / Teams connections, webhooks, and regulatory KPI targets.</p>
  
  <div id="kpiSettingsForm">
    <h3 style="margin-top: 20px;">Teams & SharePoint Integration</h3>
    <div class="row">
        <div class="col">
            <label>SharePoint / Teams Base Documents URL</label>
            <input type="text" id="sharepointBaseUrl" placeholder="https://nafdacgovng.sharepoint.com/sites/PMSLagos/Shared Documents">
            <p class="muted small">Base root URL used to generate direct links to facility folders in activity ledgers.</p>
        </div>
    </div>
    <div class="row">
        <div class="col">
            <label>Teams Webhook URL (Power Automate Folder Creator)</label>
            <input type="text" id="webhookUrl" placeholder="https://prod-...">
            <p class="muted small">Fired on report submission to generate SharePoint activity folders.</p>
        </div>
    </div>
    <div class="row">
        <div class="col">
            <label>Weekly Summary Webhook URL</label>
            <input type="text" id="weeklyWebhookUrl" placeholder="https://prod-... (Teams channel)">
            <p class="muted small">Webhook for dispatching weekly activity summaries to Teams.</p>
        </div>
    </div>
    <div class="row">
        <div class="col">
            <label>Consultative Meeting Webhook URL</label>
            <input type="text" id="consultativeMeetingWebhookUrl" placeholder="https://prod-... (PA flow for meeting approval chain)">
            <p class="muted small">Updates SharePoint list with meeting inspectors for approval workflows.</p>
        </div>
    </div>
    <div class="row">
        <div class="col">
            <label>Scheduler Webhook URL</label>
            <input type="text" id="schedulerWebhookUrl" placeholder="https://prod-... (PA flow)">
            <p class="muted small">Routes proposed inspection schedules for Directorate review.</p>
        </div>
    </div>

    <h3 style="margin-top: 24px;">KPI Annual Targets</h3>
    <div class="row">
      <div class="col">
        <label>Routine Surveillance Target</label>
        <input type="number" id="targetSurveillance" placeholder="e.g., 70">
      </div>
      <div class="col">
        <label>GSDP Target</label>
        <input type="number" id="targetGsdp" placeholder="e.g., 15">
      </div>
    </div>
    <div class="row" style="margin-top: 16px; border-top: 1px solid #eee; padding-top: 16px;">
      <div class="col">
        <label>GLSI Cases Target</label>
        <input type="number" id="receivedGlsi" placeholder="e.g., 6">
      </div>
      <div class="col">
        <label>Consumer Complaints Expected</label>
        <input type="number" id="receivedComplaints" placeholder="e.g., 20">
      </div>
    </div>
    <div class="controls" style="margin-top:24px; display:flex; justify-content:space-between;">
        <button id="backToDashboard" class="secondary">Back to Dashboard</button>
        <button id="saveKpiSettings" class="success">Save Settings</button>
    </div>
  </div>
</section>
`;

const pageSuccess = `
<section class="card" style="text-align:center;padding:60px 20px;max-width:550px;margin:auto;">
  <div style="font-size:44px;color:var(--accent);margin-bottom:12px;">✓</div>
  <h2>Reports Submitted Successfully</h2>
  <p class="muted">Your inspection submissions have been securely saved to the database and Teams folder generation has been triggered.</p>
  <div class="controls" style="margin-top:30px;">
    <button id="backToNewLog">Start Another Log</button>
  </div>
</section>`;

// ─── Sidebar Navigation Renderer ─────────────────────────────────────────────
function renderSidebar(user, role, activePage) {
  const isAdmin = role === 'admin';
  const isActivityPage = ['alerts', 'complaints', 'gsdp', 'surveillance', 'glsi'].includes(activePage);

  sidebarNav.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-header-title">Directorate Portal</div>
      <button id="sidebarCloseBtn" class="sidebar-close-btn" title="Close Sidebar">✕</button>
    </div>

    <div style="padding-top: 8px;">
      <!-- 1. Start New Log (Landing) -->
      <a class="sidebar-nav-item ${activePage === 'report' ? 'active' : ''}" data-nav="report">
        <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span>Start New Log</span>
      </a>

      <div class="sidebar-divider"></div>

      <!-- 2. Directorate Activities Accordion -->
      <div class="sidebar-accordion-header ${isActivityPage ? 'expanded' : ''}" id="activitiesAccordionHeader">
        <div class="sidebar-accordion-left">
          <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span>Directorate Activities</span>
        </div>
        <svg class="sidebar-accordion-chevron" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
      </div>

      <div class="sidebar-accordion-body ${isActivityPage ? 'expanded' : ''}" id="activitiesAccordionBody">
        <a class="sidebar-nav-item ${activePage === 'alerts' ? 'active' : ''}" data-nav="alerts">
          <span>Alerts</span>
        </a>
        <a class="sidebar-nav-item ${activePage === 'complaints' ? 'active' : ''}" data-nav="complaints">
          <span>Consumer Complaints</span>
        </a>
        <a class="sidebar-nav-item ${activePage === 'gsdp' ? 'active' : ''}" data-nav="gsdp">
          <span>GSDP</span>
        </a>
        <a class="sidebar-nav-item ${activePage === 'surveillance' ? 'active' : ''}" data-nav="surveillance">
          <span>Routine Surveillance</span>
        </a>
        <a class="sidebar-nav-item ${activePage === 'glsi' ? 'active' : ''}" data-nav="glsi">
          <span>GLSI</span>
        </a>
      </div>

      <div class="sidebar-divider"></div>

      <!-- 3. Facility Dossiers -->
      <a class="sidebar-nav-item ${activePage === 'facilities' ? 'active' : ''}" data-nav="facilities">
        <svg viewBox="0 0 24 24"><path d="M3 21h18M3 7v14M21 7v14M6 7V3h12v4M9 11h2M13 11h2M9 15h2M13 15h2"/></svg>
        <span>Facility Dossiers</span>
      </a>

      <!-- 4. Inspection Map -->
      <a class="sidebar-nav-item ${activePage === 'map' ? 'active' : ''}" data-nav="map">
        <svg viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
        <span>Inspection Map</span>
      </a>

      <!-- 5. Dashboard -->
      ${isAdmin ? `
      <a class="sidebar-nav-item ${activePage === 'dashboard' ? 'active' : ''}" data-nav="dashboard">
        <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        <span>Dashboard</span>
      </a>` : ''}

      <!-- Additional Tools -->
      <a class="sidebar-nav-item ${activePage === 'scheduler' ? 'active' : ''}" data-nav="scheduler">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>Inspection Scheduler</span>
      </a>

      <a class="sidebar-nav-item ${activePage === 'weekly' ? 'active' : ''}" data-nav="weekly">
        <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <span>Weekly Summary</span>
      </a>

      <a class="sidebar-nav-item ${activePage === 'live-movement' ? 'active' : ''}" data-nav="live-movement">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Live Movement</span>
      </a>
    </div>

    <!-- Bottom Settings (Admin Only) -->
    ${isAdmin ? `
    <div class="sidebar-bottom">
      <a class="sidebar-nav-item ${activePage === 'kpi-settings' ? 'active' : ''}" data-nav="kpi-settings">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>Directorate Settings</span>
      </a>
    </div>` : ''}
  `;

  // Bind Accordion Toggle
  const accHdr = document.getElementById('activitiesAccordionHeader');
  const accBody = document.getElementById('activitiesAccordionBody');
  if (accHdr && accBody) {
    accHdr.onclick = () => {
      const isExp = accHdr.classList.contains('expanded');
      accHdr.classList.toggle('expanded', !isExp);
      accBody.classList.toggle('expanded', !isExp);
    };
  }

  // Bind Close Button
  const closeBtn = document.getElementById('sidebarCloseBtn');
  if (closeBtn) closeBtn.onclick = closeSidebar;

  // Bind Nav Links
  sidebarNav.querySelectorAll('[data-nav]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.dataset.nav;
      closeSidebar();
      navigate(target);
    });
  });
}

// ─── Sidebar Toggle Handlers ──────────────────────────────────────────────────
function toggleSidebar() {
  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function openSidebar() {
  sidebar.classList.add('open');
  sidebarBackdrop.classList.add('visible');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('visible');
}

btnHamburger.addEventListener('click', toggleSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);

// ─── Authentication Setup ────────────────────────────────────────────────────
btnSignIn.addEventListener('click', signIn);
btnSignOut.addEventListener('click', logOut);

initAuth(db, (user, role) => {
  updateAuthUI(user, role);
  setWizardUser(user);
  setSchedulerUser(user);
  setDashboardUserRole(role);
  setFacilityProfileUser(user, role);

  if (!authReady) {
    authReady = true;
    const page = window.location.hash.substring(1);
    const validPages = [
      'report', 'alerts', 'complaints', 'gsdp', 'surveillance', 'glsi',
      'facilities', 'map', 'dashboard', 'kpi-settings', 'scheduler',
      'weekly', 'live-movement', 'import', 'success'
    ];

    if (validPages.includes(page)) {
      navigate(page, false);
    } else {
      // Landing page is "Start New Log" (report) as requested
      navigate('report', false);
    }
  }
});

function updateAuthUI(user, role) {
  if (user) {
    userInfo.textContent = user.displayName || user.email;
    btnSignIn.classList.add('hidden');
    btnSignOut.classList.remove('hidden');
  } else {
    userInfo.textContent = 'Not signed in';
    btnSignIn.classList.remove('hidden');
    btnSignOut.classList.add('hidden');
  }
  renderSidebar(user, role, currentPage);
}

// ─── Page Router ─────────────────────────────────────────────────────────────
window.addEventListener('popstate', (event) => {
  if (event.state && event.state.page) {
    renderPage(event.state.page);
  } else {
    renderPage('report');
  }
});

window.addEventListener('navigate', (event) => {
  renderPage(event.detail.page);
});

function renderPage(page) {
  currentPage = page;
  renderSidebar(currentUser, currentUserRole, page);
  clearRoot(root);

  // 1. Landing / Start New Log
  if (page === 'report' || page === 'welcome') {
    startReportWizard(root);
    return;
  }

  // 2. Activity Hubs
  if (page === 'alerts') {
    renderActivityHub(root, ALERTS_CONFIG);
    return;
  }
  if (page === 'complaints') {
    renderActivityHub(root, COMPLAINTS_CONFIG);
    return;
  }
  if (page === 'gsdp') {
    renderActivityHub(root, GSDP_CONFIG);
    return;
  }
  if (page === 'surveillance') {
    renderActivityHub(root, SURVEILLANCE_CONFIG);
    return;
  }
  if (page === 'glsi') {
    renderActivityHub(root, GLSI_CONFIG);
    return;
  }

  // 3. Facility Dossiers
  if (page === 'facilities') {
    renderFacilityProfilePage(root);
    return;
  }

  // 4. Map
  if (page === 'map') {
    renderMapPage(root);
    return;
  }

  // 5. Dashboard
  if (page === 'dashboard') {
    if (currentUserRole === 'admin') {
      bindDashboard(root);
    } else {
      alert('Access restricted to Director / Administrator.');
      navigate('report');
    }
    return;
  }

  // 6. Settings
  if (page === 'kpi-settings') {
    if (currentUserRole === 'admin') {
      root.innerHTML = pageKpiSettings;
      bindKpiSettings();
    } else {
      alert('Access restricted to Administrator.');
      navigate('report');
    }
    return;
  }

  // 7. Success
  if (page === 'success') {
    root.innerHTML = pageSuccess;
    document.getElementById('backToNewLog').onclick = () => navigate('report');
    return;
  }

  // 8. Other modules
  if (page === 'scheduler') {
    renderSchedulerPage(root);
    return;
  }
  if (page === 'weekly') {
    renderWeeklySummaryPage(root);
    return;
  }
  if (page === 'live-movement') {
    renderWorkflowPage(root);
    return;
  }
  if (page === 'log-complaint') {
    navigate('complaints');
    return;
  }
  if (page === 'log-sanction') {
    if (currentUserRole === 'admin') {
      renderSanctionLoggerPage(root);
    } else {
      alert('Access denied.');
      navigate('report');
    }
    return;
  }
  if (page === 'import') {
    if (currentUserRole === 'admin') {
      renderImportPage(root);
    } else {
      alert('Access denied.');
      navigate('report');
    }
    return;
  }

  // Fallback
  navigate('report');
}

// ─── Bind Settings Form ───────────────────────────────────────────────────────
async function bindKpiSettings() {
  document.getElementById('backToDashboard').onclick = () => navigate('dashboard');
  const kpiDocRef = doc(db, 'settings', 'kpiTargets');
  const kpiSnap = await getDoc(kpiDocRef);

  if (kpiSnap.exists()) {
    const data = kpiSnap.data();
    document.getElementById('targetSurveillance').value = data.targetSurveillance || '';
    document.getElementById('targetGsdp').value = data.targetGsdp || '';
    document.getElementById('receivedGlsi').value = data.receivedGlsi || '';
    document.getElementById('receivedComplaints').value = data.receivedComplaints || '';
    document.getElementById('sharepointBaseUrl').value = data.sharepointBaseUrl || '';
    document.getElementById('webhookUrl').value = data.webhookUrl || '';
    document.getElementById('weeklyWebhookUrl').value = data.weeklyWebhookUrl || '';
    document.getElementById('consultativeMeetingWebhookUrl').value = data.consultativeMeetingWebhookUrl || '';
    document.getElementById('schedulerWebhookUrl').value = data.schedulerWebhookUrl || '';
  }

  document.getElementById('saveKpiSettings').onclick = async () => {
    const settings = {
      targetSurveillance: parseInt(document.getElementById('targetSurveillance').value) || 0,
      targetGsdp: parseInt(document.getElementById('targetGsdp').value) || 0,
      receivedGlsi: parseInt(document.getElementById('receivedGlsi').value) || 0,
      receivedComplaints: parseInt(document.getElementById('receivedComplaints').value) || 0,
      sharepointBaseUrl: document.getElementById('sharepointBaseUrl').value.trim(),
      webhookUrl: document.getElementById('webhookUrl').value.trim(),
      weeklyWebhookUrl: document.getElementById('weeklyWebhookUrl').value.trim(),
      consultativeMeetingWebhookUrl: document.getElementById('consultativeMeetingWebhookUrl').value.trim(),
      schedulerWebhookUrl: document.getElementById('schedulerWebhookUrl').value.trim(),
      updatedAt: serverTimestamp()
    };

    try {
      await setDoc(kpiDocRef, settings, { merge: true });
      alert('Settings saved successfully!');
      navigate('dashboard');
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Could not save settings: " + error.message);
    }
  };
}

// ─── Bulk Import Page (Extended for Unified Directorate Hub) ─────────────────
async function renderImportPage(root) {
  const COLLECTIONS = [
    { key: 'facilities', file: 'etl_output/master_facilities.json', label: 'Facilities' },
    { key: 'inspections', file: 'etl_output/inspections.json', label: 'Inspections' },
    { key: 'sanctions', file: 'etl_output/sanctions.json', label: 'Sanctions' },
    { key: 'complaints', file: 'etl_output/complaints.json', label: 'Complaints' },
    { key: 'alerts', file: 'etl_output/alerts.json', label: 'Alerts' },
    { key: 'gsdp_inspections', file: 'etl_output/gsdp_inspections.json', label: 'GSDP Inspections' },
    { key: 'glsi_records', file: 'etl_output/glsi_records.json', label: 'GLSI Records' }
  ];

  root.innerHTML = `
  <section class="card" style="max-width:720px;margin:auto">
    <h2 style="color:var(--accent)">Import Directorate Data (ETL)</h2>
    <p class="muted">Upload pre-processed JSON datasets from <code>etl_output/</code> directly into Firestore collections.</p>
    <div id="impStats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0">
      ${COLLECTIONS.map(c => `
        <div style="background:#f8faf8;padding:12px 16px;border-radius:4px;text-align:center;border:1px solid #e2e8f0">
          <strong id="imp_${c.key}" style="display:block;font-size:20px;color:var(--accent)">—</strong>
          <span style="font-size:12px;color:#718096">${c.label}</span>
        </div>`).join("")}
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <button id="importAllBtn" disabled style="padding:12px 24px;font-size:16px;flex:1">Loading data files...</button>
      <button id="backFromImport" class="secondary" style="padding:12px 24px">← Back</button>
    </div>
    <div id="importLog" style="background:#f5f5f5;padding:16px;border-radius:4px;margin-top:16px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:12px;white-space:pre-wrap"></div>
  </section>`;

  document.getElementById('backFromImport').onclick = () => navigate('report');

  const logEl = document.getElementById('importLog');
  const btn = document.getElementById('importAllBtn');
  const log = (msg) => { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; };

  const datasets = {};
  let totalRecords = 0;
  for (const c of COLLECTIONS) {
    try {
      const resp = await fetch(`./${c.file}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      datasets[c.key] = data;
      document.getElementById(`imp_${c.key}`).textContent = data.length;
      totalRecords += data.length;
      log(`Ready: ${c.label} (${data.length} records)`);
    } catch (e) {
      datasets[c.key] = [];
      document.getElementById(`imp_${c.key}`).textContent = '0';
      log(`Pending/Not found: ${c.label} (${c.file})`);
    }
  }

  btn.textContent = `Import Ready Datasets (${totalRecords} records)`;
  btn.disabled = totalRecords === 0;

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Importing to Firestore...';
    log('\n─── Starting Batch Writes ───');

    try {
      const BATCH_SIZE = 400;

      for (const c of COLLECTIONS) {
        const data = datasets[c.key];
        if (!data || data.length === 0) continue;

        let imported = 0;
        for (let i = 0; i < data.length; i += BATCH_SIZE) {
          const batch = writeBatch(db);
          const chunk = data.slice(i, i + BATCH_SIZE);
          for (const record of chunk) {
            const docRef = doc(collection(db, c.key));
            batch.set(docRef, record);
          }
          await batch.commit();
          imported += chunk.length;
        }
        log(`✓ ${c.label}: ${imported} records successfully imported`);
      }

      log('\nAll available datasets imported!');
      btn.textContent = 'Import Complete';
    } catch (e) {
      log(`\nImport error: ${e.message}`);
      btn.textContent = 'Retry Import';
      btn.disabled = false;
    }
  };
}