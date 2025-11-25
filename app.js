import { db, doc, getDoc, setDoc, serverTimestamp } from "./db.js";
import { initAuth, signIn, logOut, currentUser, currentUserRole } from "./auth.js";
import { navigate, clearRoot } from "./ui.js";
import { startReportWizard, setWizardUser } from "./wizard.js";
import { bindDashboard, setDashboardUserRole } from "./dashboard.js";

const root = document.getElementById('app');
const modalContainer = document.getElementById('modalContainer');

const pageWelcome = `
<section class="card" style="text-align: center; padding: 60px 20px; border: none; box-shadow: none; background: transparent;">
  <div style="margin-bottom: 32px;">
    <img src="https://upload.wikimedia.org/wikipedia/commons/4/4a/NAFDAC_Logo.png" alt="NAFDAC Logo" style="height: 80px; margin-bottom: 16px;">
    <h1 style="font-size: 32px; font-weight: 800; color: var(--accent); margin-bottom: 12px;">PMS Inspector Portal</h1>
    <p style="font-size: 18px; color: var(--secondary-text); max-width: 600px; margin: 0 auto;">
      Welcome to the Post Marketing Surveillance Daily Log system. 
      Please sign in to submit your daily inspection reports.
    </p>
  </div>
  
  <div class="controls" style="display: flex; gap: 16px; justify-content: center; margin-top: 32px;">
    <button id="startReport" style="padding: 16px 32px; font-size: 16px;">Start New Report</button>
    <button id="openDashboard" class="secondary" style="padding: 16px 32px; font-size: 16px; display: none;">View Dashboard</button>
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
  setDashboardUserRole(role);

  if (!authReady) {
    authReady = true;
    const page = window.location.hash.substring(1);

    if ((page === 'dashboard' || page === 'kpi-settings') && role === 'admin') {
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