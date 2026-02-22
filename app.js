import { db, doc, getDoc, setDoc, serverTimestamp, collection, writeBatch } from "./db.js";
import { initAuth, signIn, logOut, currentUser, currentUserRole } from "./auth.js";
import { navigate, clearRoot } from "./ui.js";
import { startReportWizard, setWizardUser } from "./wizard.js";
import { bindDashboard, setDashboardUserRole } from "./dashboard.js";
import { renderSchedulerPage, setSchedulerUser } from "./scheduler.js";
import { renderMapPage } from "./map.js";

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
    <button id="openMap" class="secondary" style="padding: 16px 40px; font-size: 18px; display: none;">🗺️ Inspection Map</button>
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

  if (!authReady) {
    authReady = true;
    const page = window.location.hash.substring(1);

    if (['dashboard', 'kpi-settings', 'scheduler', 'map', 'import'].includes(page) && (role === 'admin' || page === 'scheduler' || page === 'map')) {
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
  const mapBtn = document.getElementById('openMap');
  if (mapBtn) {
    mapBtn.style.display = user ? 'block' : 'none';
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
  const mapBtn = document.getElementById('openMap');
  if (mapBtn) {
    mapBtn.style.display = currentUser ? 'block' : 'none';
    mapBtn.onclick = () => navigate('map');
  }
  const dashboardBtn = document.getElementById('openDashboard');
  if (dashboardBtn) {
    dashboardBtn.style.display = currentUserRole === 'admin' ? 'block' : 'none';
  }
  dashboardBtn.onclick = () => navigate('dashboard');
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
  }

  document.getElementById('saveKpiSettings').onclick = async () => {
    const settings = {
      targetSurveillance: parseInt(document.getElementById('targetSurveillance').value) || 0,
      targetGsdp: parseInt(document.getElementById('targetGsdp').value) || 0,
      receivedGlsi: parseInt(document.getElementById('receivedGlsi').value) || 0,
      receivedComplaints: parseInt(document.getElementById('receivedComplaints').value) || 0,
      webhookUrl: document.getElementById('webhookUrl').value.trim(),
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
  root.innerHTML = `
  <section class="card" style="max-width:600px;margin:auto">
    <h2 style="color:var(--accent)">📦 Import Facilities</h2>
    <p class="muted">Import facility data from <code>facilities-data.json</code> into Firestore.</p>
    <div style="display:flex;gap:16px;margin:16px 0">
      <div style="background:#e8f5e9;padding:12px 20px;border-radius:8px;text-align:center;flex:1">
        <strong id="impTotal" style="display:block;font-size:24px;color:var(--accent)">—</strong>Total
      </div>
      <div style="background:#e8f5e9;padding:12px 20px;border-radius:8px;text-align:center;flex:1">
        <strong id="impGlsi" style="display:block;font-size:24px;color:var(--accent)">—</strong>GLSI
      </div>
      <div style="background:#e8f5e9;padding:12px 20px;border-radius:8px;text-align:center;flex:1">
        <strong id="impGsdp" style="display:block;font-size:24px;color:var(--accent)">—</strong>GSDP
      </div>
      <div style="background:#e8f5e9;padding:12px 20px;border-radius:8px;text-align:center;flex:1">
        <strong id="impRs" style="display:block;font-size:24px;color:var(--accent)">—</strong>RS
      </div>
    </div>
    <button id="importBtn" disabled style="padding:12px 24px;font-size:16px">Loading data...</button>
    <button id="backFromImport" class="secondary" style="padding:12px 24px;margin-left:12px">← Back</button>
    <div id="importLog" style="background:#f5f5f5;padding:16px;border-radius:8px;margin-top:16px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:13px;white-space:pre-wrap"></div>
  </section>`;

  document.getElementById('backFromImport').onclick = () => navigate('welcome');

  const logEl = document.getElementById('importLog');
  const btn = document.getElementById('importBtn');
  const log = (msg) => { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; };

  let facilities = [];
  try {
    const resp = await fetch('./facilities-data.json');
    facilities = await resp.json();
    document.getElementById('impTotal').textContent = facilities.length;
    document.getElementById('impGlsi').textContent = facilities.filter(f => f.activityType === 'GLSI').length;
    document.getElementById('impGsdp').textContent = facilities.filter(f => f.activityType === 'GSDP').length;
    document.getElementById('impRs').textContent = facilities.filter(f => f.activityType === 'Routine Surveillance').length;
    btn.textContent = `Import ${facilities.length} Facilities`;
    btn.disabled = false;
    log(`✅ Loaded ${facilities.length} facilities from JSON`);
  } catch (e) {
    log(`❌ Error loading JSON: ${e.message}`);
  }

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Importing...';
    try {
      const BATCH_SIZE = 450;
      let imported = 0;
      for (let i = 0; i < facilities.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = facilities.slice(i, i + BATCH_SIZE);
        for (const f of chunk) {
          const docRef = doc(collection(db, 'facilities'));
          batch.set(docRef, {
            name: f.name || '', address: f.address || '', activityType: f.activityType || '',
            contactPerson: f.contactPerson || '', email: f.email || '', fileNumber: f.fileNumber || '',
            lastVisitDate: f.lastVisitDate || '', lastObservation: f.lastObservation || '',
            status: f.status || 'Active', visitCount: 0
          });
        }
        await batch.commit();
        imported += chunk.length;
        log(`📦 Batch ${Math.ceil((i + 1) / BATCH_SIZE)}: imported ${imported}/${facilities.length}`);
      }
      log(`\n🎉 Done! ${imported} facilities imported to Firestore.`);
      btn.textContent = '✅ Import Complete';
    } catch (e) {
      log(`\n❌ Error: ${e.message}`);
      btn.textContent = 'Retry Import';
      btn.disabled = false;
    }
  };
}