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

const root = document.getElementById('app');
const modalContainer = document.getElementById('modalContainer');

const pageWelcome = `
<section class="card" style="text-align: center; padding: 80px 20px; border: 2px solid var(--accent);">
  <div style="margin-bottom: 32px;">
    <img src="logo.png" alt="NAFDAC Logo" style="height: 100px; margin-bottom: 24px;">
    <h1 style="font-size: 36px; font-weight: 900; color: var(--accent); margin-bottom: 16px; text-transform: uppercase;">PMS Inspector Portal</h1>
    <p style="font-size: 20px; color: var(--primary-text); max-width: 700px; margin: 0 auto; font-weight: 500;">
      National Agency for Food and Drug Administration and Control<br>
      <span style="font-size: 16px; color: #666;">Post Marketing Surveillance Directorate</span>
    </p>
  </div>
  
  <div class="controls" style="display: flex; gap: 16px; justify-content: center; margin-top: 48px; flex-wrap: wrap;">
    <button id="startReport" style="padding: 16px 40px; font-size: 18px;">Start New Report</button>
    <button id="openScheduler" class="secondary" style="padding: 16px 40px; font-size: 18px; display: none;">Schedule Inspections</button>
    <button id="openFacilities" class="secondary" style="padding: 16px 40px; font-size: 18px; display: none;">🏢 Facility Database</button>
    <button id="openLogComplaint" class="secondary" style="padding: 16px 40px; font-size: 18px; display: none;">📋 Log Complaint</button>
    <button id="openLogSanction" class="secondary" style="padding: 16px 40px; font-size: 18px; display: none;">💰 Log Sanction</button>
    <button id="openWorkflow" class="success" style="padding: 16px 40px; font-size: 18px; display: none;">🚦 Live Movement</button>
    <button id="openMap" class="secondary" style="padding: 16px 40px; font-size: 18px; display: none;">🗺️ Inspection Map</button>
    <button id="openWeekly" class="secondary" style="padding: 16px 40px; font-size: 18px; display: none;">📊 Weekly Summary</button>
    <button id="openDashboard" class="secondary" style="padding: 16px 40px; font-size: 18px; display: none;">View Dashboard</button>
  </div>
</section>
`;

const pageSuccess = `
<section class="card">
  <h2>Success</h2>
  <p>Your reports were submitted successfully.</p>
  <div class="controls">
    <button id="backToWelcome">Back to Home</button>
  </div>
</section>`;

const pageKpiSettings = `
<section class="card" style="max-width: 600px; margin: auto;">
  <h2>Settings</h2>
  <p class="muted">Configure application settings and KPI targets.</p>
  
  <div id="kpiSettingsForm">
    <h3>Teams Integration</h3>
    <div class="row">
        <div class="col">
            <label>Teams Webhook URL (Power Automate)</label>
            <input type="text" id="webhookUrl" placeholder="https://prod-...">
            <p class="muted small">Used to create folders in Teams for Routine Surveillance reports.</p>
        </div>
    </div>
    <div class="row">
        <div class="col">
            <label>Weekly Summary Webhook URL</label>
            <input type="text" id="weeklyWebhookUrl" placeholder="https://prod-... (Teams channel for weekly summaries)">
            <p class="muted small">Webhook for posting weekly activity summaries to Teams.</p>
        </div>
    </div>
    <div class="row">
        <div class="col">
            <label>Consultative Meeting Webhook URL</label>
            <input type="text" id="consultativeMeetingWebhookUrl" placeholder="https://prod-... (PA flow for consultative meeting approval chain)">
            <p class="muted small">When a Consultative Meeting is logged, this updates the SharePoint list with meeting-specific inspectors for the approval chain.</p>
        </div>
    </div>
    <div class="row">
        <div class="col">
            <label>Scheduler Webhook URL</label>
            <input type="text" id="schedulerWebhookUrl" placeholder="https://prod-... (PA flow for routing inspections to Dr. Regina)">
            <p class="muted small">Fires when an inspector submits a schedule for approval.</p>
        </div>
    </div>

    <h3 style="margin-top: 24px;">KPI Targets</h3>
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
        <label>GLSI Cases Received</label>
        <input type="number" id="receivedGlsi" placeholder="e.g., 6">
      </div>
      <div class="col">
        <label>Consumer Complaints Received</label>
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

let authReady = false;

const btnSignIn = document.getElementById('btnSignIn');
const btnSignOut = document.getElementById('btnSignOut');
const userInfo = document.getElementById('userInfo');
const btnKpiSettings = document.getElementById('btnKpiSettings');

btnSignIn.addEventListener('click', signIn);
btnSignOut.addEventListener('click', logOut);
btnKpiSettings.addEventListener('click', () => navigate('kpi-settings'));

initAuth(db, (user, role) => {
  updateAuthUI(user, role);
  setWizardUser(user);
  setSchedulerUser(user);
  setDashboardUserRole(role);
  setFacilityProfileUser(user, role);

  if (!authReady) {
    authReady = true;
    const page = window.location.hash.substring(1);

    if (['dashboard', 'kpi-settings', 'scheduler', 'map', 'import', 'weekly', 'facilities', 'log-complaint', 'log-sanction', 'live-movement'].includes(page) && (role === 'admin' || page === 'scheduler' || page === 'map' || page === 'weekly' || page === 'facilities' || page === 'log-complaint' || page === 'log-sanction' || page === 'live-movement')) {
      navigate(page, false);
    } else if (['report', 'success'].includes(page) && user) {
      navigate(page, false);
    } else {
      navigate('welcome', false);
    }
  }
});

function updateAuthUI(user, role) {
  if (user) {
    userInfo.textContent = user.displayName || user.email;
    btnSignIn.classList.add('hidden');
    btnSignOut.classList.remove('hidden');
    btnKpiSettings.classList.toggle('hidden', role !== 'admin');
    if (role === 'admin') btnKpiSettings.textContent = 'Settings';
  } else {
    userInfo.textContent = 'Not signed in';
    btnSignIn.classList.remove('hidden');
    btnSignOut.classList.add('hidden');
    btnKpiSettings.classList.add('hidden');
  }
  const dashboardBtn = document.getElementById('openDashboard');
  if (dashboardBtn) {
    dashboardBtn.style.display = role === 'admin' ? 'block' : 'none';
  }
  const schedulerBtn = document.getElementById('openScheduler');
  if (schedulerBtn) {
    schedulerBtn.style.display = user ? 'block' : 'none';
  }
  const facilityBtn = document.getElementById('openFacilities');
  if (facilityBtn) {
    facilityBtn.style.display = user ? 'block' : 'none';
  }
  const complaintBtn = document.getElementById('openLogComplaint');
  if (complaintBtn) {
    complaintBtn.style.display = user ? 'block' : 'none';
  }
  const sanctionBtn = document.getElementById('openLogSanction');
  if (sanctionBtn) {
    sanctionBtn.style.display = role === 'admin' ? 'block' : 'none';
  }
  const workflowBtn = document.getElementById('openWorkflow');
  if (workflowBtn) {
    workflowBtn.style.display = user ? 'block' : 'none';
  }
  const mapBtn = document.getElementById('openMap');
  if (mapBtn) {
    mapBtn.style.display = user ? 'block' : 'none';
  }
  const weeklyBtn = document.getElementById('openWeekly');
  if (weeklyBtn) {
    weeklyBtn.style.display = user ? 'block' : 'none';
  }
}

window.addEventListener('popstate', (event) => {
  if (event.state && event.state.page) {
    renderPage(event.state.page);
  } else {
    renderPage('welcome');
  }
});

window.addEventListener('navigate', (event) => {
  renderPage(event.detail.page);
});

function renderPage(page) {
  clearRoot(root);

  if (page === 'welcome') { root.innerHTML = pageWelcome; bindWelcome(); }
  if (page === 'report') { startReportWizard(root); }
  if (page === 'success') { root.innerHTML = pageSuccess; bindSuccess(); }
  if (page === 'kpi-settings') {
    if (currentUserRole === 'admin') {
      root.innerHTML = pageKpiSettings; bindKpiSettings();
    } else {
      alert('Access denied.');
      navigate('welcome');
    }
  }
  if (page === 'scheduler') {
    renderSchedulerPage(root);
  }
  if (page === 'map') {
    renderMapPage(root);
  }
  if (page === 'facilities') {
    renderFacilityProfilePage(root);
  }
  if (page === 'weekly') {
    renderWeeklySummaryPage(root);
  }
  if (page === 'log-complaint') {
    renderComplaintLoggerPage(root);
  }
  if (page === 'log-sanction') {
    if (currentUserRole === 'admin') {
      renderSanctionLoggerPage(root);
    } else {
      alert('Access denied. Only admins can log sanctions.');
      navigate('welcome');
    }
  }
  if (page === 'live-movement') {
    renderWorkflowPage(root);
  }
  if (page === 'import') {
    if (currentUserRole === 'admin') {
      renderImportPage(root);
    } else {
      alert('Access denied. Only admins can import facilities.');
      navigate('welcome');
    }
  }
  if (page === 'dashboard') {
    if (currentUserRole === 'admin') {
      bindDashboard(root);
    } else {
      alert('Access denied. Only admins can view the dashboard.');
      navigate('welcome');
    }
  }
}

function bindWelcome() {
  document.getElementById('startReport').onclick = () => navigate('report');
  const schedulerBtn = document.getElementById('openScheduler');
  if (schedulerBtn) {
    schedulerBtn.style.display = currentUser ? 'block' : 'none';
    schedulerBtn.onclick = () => navigate('scheduler');
  }
  const facilityBtn = document.getElementById('openFacilities');
  if (facilityBtn) {
    facilityBtn.style.display = currentUser ? 'block' : 'none';
    facilityBtn.onclick = () => navigate('facilities');
  }
  const complaintBtn = document.getElementById('openLogComplaint');
  if (complaintBtn) {
    complaintBtn.style.display = currentUser ? 'block' : 'none';
    complaintBtn.onclick = () => navigate('log-complaint');
  }
  const sanctionBtn = document.getElementById('openLogSanction');
  if (sanctionBtn) {
    sanctionBtn.style.display = currentUserRole === 'admin' ? 'block' : 'none';
    sanctionBtn.onclick = () => navigate('log-sanction');
  }
  const workflowBtn = document.getElementById('openWorkflow');
  if (workflowBtn) {
    workflowBtn.style.display = currentUser ? 'block' : 'none';
    workflowBtn.onclick = () => navigate('live-movement');
  }
  const mapBtn = document.getElementById('openMap');
  if (mapBtn) {
    mapBtn.style.display = currentUser ? 'block' : 'none';
    mapBtn.onclick = () => navigate('map');
  }
  const weeklyBtn = document.getElementById('openWeekly');
  if (weeklyBtn) {
    weeklyBtn.style.display = currentUser ? 'block' : 'none';
    weeklyBtn.onclick = () => navigate('weekly');
  }
  const dashboardBtn = document.getElementById('openDashboard');
  if (dashboardBtn) {
    dashboardBtn.style.display = currentUserRole === 'admin' ? 'block' : 'none';
    dashboardBtn.onclick = () => navigate('dashboard');
  }
}

function bindSuccess() { document.getElementById('backToWelcome').onclick = () => navigate('welcome'); }

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
      alert("An error occurred. Could not save settings.");
    }
  };
}

async function renderImportPage(root) {
  const COLLECTIONS = [
    { key: 'facilities', file: 'etl_output/master_facilities.json', label: 'Facilities', icon: '🏢' },
    { key: 'inspections', file: 'etl_output/inspections.json', label: 'Inspections', icon: '📋' },
    { key: 'sanctions', file: 'etl_output/sanctions.json', label: 'Sanctions', icon: '💰' },
    { key: 'complaints', file: 'etl_output/complaints.json', label: 'Complaints', icon: '📞' },
    { key: 'documents', file: 'etl_output/documents.json', label: 'Documents', icon: '📄' },
    { key: 'file_registry', file: 'etl_output/file_registry.json', label: 'File Registry', icon: '📁' },
  ];

  root.innerHTML = `
  <section class="card" style="max-width:700px;margin:auto">
    <h2 style="color:var(--accent)">📦 Import Unified Facility Database</h2>
    <p class="muted">Import all ETL output data from <code>etl_output/</code> into Firestore.</p>
    <div id="impStats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0">
      ${COLLECTIONS.map(c => `
        <div style="background:#f8faf8;padding:12px 16px;border-radius:8px;text-align:center;border:1px solid #e2e8f0">
          <div style="font-size:20px;margin-bottom:4px">${c.icon}</div>
          <strong id="imp_${c.key}" style="display:block;font-size:22px;color:var(--accent)">—</strong>
          <span style="font-size:12px;color:#718096">${c.label}</span>
        </div>`).join("")}
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <button id="importAllBtn" disabled style="padding:12px 24px;font-size:16px;flex:1">Loading data...</button>
      <button id="backFromImport" class="secondary" style="padding:12px 24px">← Back</button>
    </div>
    <div id="importLog" style="background:#f5f5f5;padding:16px;border-radius:8px;margin-top:16px;max-height:350px;overflow-y:auto;font-family:monospace;font-size:13px;white-space:pre-wrap"></div>
  </section>`;

  document.getElementById('backFromImport').onclick = () => navigate('welcome');

  const logEl = document.getElementById('importLog');
  const btn = document.getElementById('importAllBtn');
  const log = (msg) => { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; };

  // Load all JSON files
  const datasets = {};
  let totalRecords = 0;
  for (const c of COLLECTIONS) {
    try {
      const resp = await fetch(`./${c.file}`);
      const data = await resp.json();
      datasets[c.key] = data;
      document.getElementById(`imp_${c.key}`).textContent = data.length;
      totalRecords += data.length;
      log(`✅ ${c.label}: ${data.length} records loaded`);
    } catch (e) {
      log(`⚠️  ${c.label}: ${e.message}`);
      datasets[c.key] = [];
    }
  }

  btn.textContent = `Import All (${totalRecords} records)`;
  btn.disabled = false;

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Importing...';
    log('\n─── Starting Import ───');

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
        log(`${c.icon} ${c.label}: ${imported} records imported`);
      }

      log('\n🎉 All collections imported successfully!');
      btn.textContent = '✅ Import Complete';
    } catch (e) {
      log(`\n❌ Error: ${e.message}`);
      btn.textContent = 'Retry Import';
      btn.disabled = false;
    }
  };
}