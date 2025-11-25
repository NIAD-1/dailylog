import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, serverTimestamp, query, where, orderBy, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDKtEkK9rY7NLFLRjqexRjeUL2jj7tC6tY",
    authDomain: "enilama-system-app.firebaseapp.com",
    projectId: "enilama-system-app",
    storageBucket: "enilama-system-app.firebasestorage.app",
    messagingSenderId: "180395774893",
    appId: "1:180395774893:web:7bd017f2b1478f22264724",
    measurementId: "G-SJ306DRWY9"
};
const CLOUDINARY_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/d1mla94c/upload';
const CLOUDINARY_UPLOAD_PRESET = 'Daily-Activity';
const LAGOS_LGAs = [ "Agege","Ajeromi-Ifelodun","Alimosho","Amuwo-Odofin","Apapa","Badagry","Epe","Eti-Osa","Ibeju-Lekki","Ifako-Ijaiye", "Ikeja","Ikorodu","Kosofe","Lagos Island","Lagos Mainland","Mushin","Ojo","Oshodi-Isolo","Shomolu","Surulere" ];
const INSPECTORS_LIST = [ "Dr Regina K. Garba", "Pharm. Mmamel Victor", "Pharm. Adesanya Oluwaseun", "Mr Omotuwa Adebayo", "Mrs Bisola Robert", "Mr Ifeanyi Okeke", "Dr Saad Abubakar", "Mr Enilama Emmanuel", "Mr Solomon Emeje Ileanwa", "Ms Mary Adegbite", "Others" ];
const PRODUCT_TYPES = [ "Drugs", "Food", "Medical Devices", "Cosmetics", "Vaccines & Biologics", "Herbals" ];

let wizardState = {};
let activeChoicesInstances = [];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const root = document.getElementById('app');
const modalContainer = document.getElementById('modalContainer');

const pageWelcome = `
<section class="card">
  <h2>Welcome</h2>
  <p class="muted">Start a new inspection report or go to the dashboard.</p>
  <div class="controls" style="margin-top:12px">
    <button id="startReport">Start Report</button>
    <button id="openDashboard" style="display:none;">Open Dashboard</button>
  </div>
</section>`;

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
  <h2>KPI Targets & Received Cases</h2>
  <p class="muted">Set the goals for the current period. This data is used to calculate performance on the dashboard.</p>
  <div id="kpiSettingsForm">
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

const kpiOverviewSection = `
<div class="card">
    <h2>KPI Overview</h2>
    <p class="muted small">Performance based on the date range selected below.</p>
    <div class="kpi-grid" id="kpiGridContainer">
    </div>
</div>
`;

const pageDashboard = `
<section>
    <div class="controls" style="margin-bottom: 16px;">
        <button id="backToWelcome" class="secondary">&larr; Back to Home</button>
    </div>
    ${kpiOverviewSection}
    <div class="stat-cards" id="statCardsContainer"></div>
    <div class="card">
        <h2>Report Details</h2>
        <div class="muted small">Filters</div>
        <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap; align-items: flex-end;">
            <div style="flex:1;min-width:150px"><label class="small">From</label><input type="date" id="filterFrom" /></div>
            <div style="flex:1;min-width:150px"><label class="small">To</label><input type="date" id="filterTo" /></div>
            <div style="flex:1;min-width:150px"><label class="small">Area</label><select id="filterArea"><option value="">All Areas</option>${LAGOS_LGAs.map(a=>`<option>${a}</option>`).join('')}</select></div>
            <div style="flex:1;min-width:150px"><label class="small">Submitter</label><select id="filterInspector"><option value="">All Submitters</option></select></div>
            <div style="flex:2;min-width:200px"><label class="small">Activity</label><select id="filterActivity"><option value="">All Activities</option><option>Consultative Meeting</option><option>GLSI</option><option>Routine Surveillance</option><option>GSDP</option><option>Consumer Complaint</option><option>RASFF</option><option>Survey</option><option>Laboratory Analysis</option><option>COLD CHAIN Monitoring</option></select></div>
            <div style="flex:2;min-width:200px"><label class="small">Product Type</label><select id="filterProductType" multiple></select></div>
            <button id="applyFilters">Apply</button>
            <button id="exportCsvBtn" class="secondary">Export to CSV</button>
        </div>
        <div class="charts" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px">
            <div class="card"><canvas id="chartActivities"></canvas></div>
            <div class="card"><canvas id="chartMopHold"></canvas></div>
            <div class="card"><canvas id="chartGsdv"></canvas></div>
            <div class="card"><canvas id="chartSanctions"></canvas></div>
        </div>
        <div class="card" style="margin-top:12px"><h3>Submissions</h3><div id="tableContainer"></div></div>
    </div>
</section>`;

let currentUser = null;
let currentUserRole = 'inspector';
let authReady = false;

const btnSignIn = document.getElementById('btnSignIn');
const btnSignOut = document.getElementById('btnSignOut');
const userInfo = document.getElementById('userInfo');
const btnKpiSettings = document.getElementById('btnKpiSettings');

btnSignIn.addEventListener('click', async ()=>{ const provider = new GoogleAuthProvider(); try{ await signInWithPopup(auth, provider); }catch(e){alert(e.message)} });
btnSignOut.addEventListener('click', async ()=>{ await signOut(auth); });
btnKpiSettings.addEventListener('click', () => navigate('kpi-settings'));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userDocRef);
        currentUser = user;
        currentUserRole = snap.exists() ? snap.data().role || 'inspector' : 'inspector';
        if (!snap.exists()) {
            await setDoc(userDocRef, { name: user.displayName || user.email, email: user.email, role: 'inspector', createdAt: serverTimestamp() });
        }
    } else {
        currentUser = null;
        currentUserRole = 'inspector';
    }

    if (!authReady) {
        authReady = true;
        const page = window.location.hash.substring(1);
        
        if ((page === 'dashboard' || page === 'kpi-settings') && currentUserRole === 'admin') {
            navigate(page, false);
        } else if (['report', 'success'].includes(page) && currentUser) {
            navigate(page, false);
        } else {
            navigate('welcome', false);
        }
    }

    updateAuthUI();
});

function updateAuthUI() {
    if (currentUser) {
        userInfo.textContent = currentUser.displayName || currentUser.email;
        btnSignIn.classList.add('hidden');
        btnSignOut.classList.remove('hidden');
        btnKpiSettings.classList.toggle('hidden', currentUserRole !== 'admin');
    } else {
        userInfo.textContent = 'Not signed in';
        btnSignIn.classList.remove('hidden');
        btnSignOut.classList.add('hidden');
        btnKpiSettings.classList.add('hidden');
    }
    const dashboardBtn = document.getElementById('openDashboard');
    if (dashboardBtn) {
        dashboardBtn.style.display = currentUserRole === 'admin' ? 'block' : 'none';
    }
}

function navigate(page, pushState = true) {
  const currentHash = window.location.hash.substring(1);
  if (pushState && page !== currentHash) {
    history.pushState({ page: page }, '', `#${page}`);
  }
  
  activeChoicesInstances.forEach(item => {
    if(item && item.instance && typeof item.instance.destroy === 'function'){
        item.instance.destroy();
    }
  });
  activeChoicesInstances = [];
  root.innerHTML = '';

  if(page==='welcome'){ root.innerHTML = pageWelcome; bindWelcome(); }
  if(page==='report'){ startReportWizard(); }
  if(page==='success'){ root.innerHTML = pageSuccess; bindSuccess(); }
  if(page==='kpi-settings'){
      if(currentUserRole === 'admin'){
        root.innerHTML = pageKpiSettings; bindKpiSettings();
      } else {
        alert('Access denied.');
        navigate('welcome');
      }
  }
  if(page==='dashboard'){
      if(currentUserRole === 'admin'){
        root.innerHTML = pageDashboard; bindDashboard();
      } else {
        alert('Access denied. Only admins can view the dashboard.');
        navigate('welcome');
      }
  }
}

window.addEventListener('popstate', (event) => {
    if (event.state && event.state.page) {
        navigate(event.state.page, false);
    } else {
        navigate('welcome', false);
    }
});

function bindWelcome(){
  document.getElementById('startReport').onclick = ()=> navigate('report');
  const dashboardBtn = document.getElementById('openDashboard');
  if (dashboardBtn) {
    dashboardBtn.style.display = currentUserRole === 'admin' ? 'block' : 'none';
  }
  dashboardBtn.onclick = ()=> navigate('dashboard');
}

function startReportWizard() {
  wizardState = {
    facilityCount: 0,
    sameInspectorsForAll: null,
    sharedInspectorNames: [],
    facilities: [],
    currentFacilityIndex: -1
  };
  renderWizardStep();
}

function renderWizardStep() {
    activeChoicesInstances.forEach(item => {
        if(item && item.instance && typeof item.instance.destroy === 'function'){
            item.instance.destroy();
        }
    });
    activeChoicesInstances = [];
    root.innerHTML = '';

    if (wizardState.facilityCount === 0) {
        root.innerHTML = renderStep_SelectCount();
        bindStep_SelectCount();
    } else if (wizardState.sameInspectorsForAll === null) {
        root.innerHTML = renderStep_AskConsistency();
        bindStep_AskConsistency();
    } else if (wizardState.sameInspectorsForAll === true && wizardState.sharedInspectorNames.length === 0) {
        root.innerHTML = renderStep_SharedInspectors();
        bindStep_SharedInspectors();
    } else {
        if (wizardState.currentFacilityIndex === -1) wizardState.currentFacilityIndex = 0;
        root.innerHTML = renderStep_FacilityForm();
        bindStep_FacilityForm();
    }
}

function renderStep_SelectCount() {
  return `
    <section class="card">
      <h2>Step 1: How many facilities did you visit?</h2>
      <div style="margin-top:12px;display:flex;gap:12px;align-items:center">
        <select id="facilityCountSelect" style="width:100px">
          ${Array.from({length:8}).map((_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}
        </select>
      </div>
      <div class="controls" style="margin-top:24px; display:flex; justify-content:space-between;">
        <button id="cancelWizard" class="danger">Cancel</button>
        <button id="nextBtn">Next</button>
      </div>
    </section>`;
}

function renderStep_AskConsistency() {
  return `
    <section class="card">
      <h2>Step 2: Inspector Details</h2>
      <p>Was the same inspection team present at all facilities?</p>
      <div class="controls" style="margin-top:24px; display:flex; justify-content:space-between;">
        <button id="backBtn">Back</button>
        <div>
            <button id="inspectorsNo" class="secondary" style="margin-right: 12px;">No, I'll specify for each</button>
            <button id="inspectorsYes">Yes, they were the same</button>
        </div>
      </div>
    </section>`;
}

function renderStep_SharedInspectors() {
  return `
    <section class="card">
        <h2>Step 3: Define the Inspection Team</h2>
        <p>This team will be assigned to all facility reports in this submission.</p>
        <div class="row" style="margin-top:8px">
          <div class="col">
            <label>Inspector(s)</label>
            <select id="sharedInspectorSelect" multiple></select>
            <textarea id="sharedInspectorOther" placeholder="For 'Others', specify names here..." style="display:none; margin-top:8px; width: 100%;" rows="3"></textarea>
          </div>
        </div>
        <div class="controls" style="margin-top:24px; display:flex; justify-content:space-between;">
            <button id="backBtn">Back</button>
            <button id="nextBtn">Next</button>
        </div>
    </section>`;
}

function renderStep_FacilityForm() {
  const index = wizardState.currentFacilityIndex;
  const total = wizardState.facilityCount;
  const showInspectorField = wizardState.sameInspectorsForAll === false;
  
  return `
    <section class="card">
      <h2>Facility ${index + 1} of ${total}</h2>
      <div id="facilityFormContainer">
        ${showInspectorField ? `
          <div class="col" style="margin-bottom:12px;">
            <label>Inspector(s) for this Facility</label>
            <select name="inspectorNameSelect" multiple></select>
            <textarea name="inspectorNameOther" placeholder="For 'Others', specify names here..." style="display:none; margin-top:8px; width: 100%;" rows="3"></textarea>
          </div>` : ''}
        <div class="row"><div class="col"><label>Date</label><input type="date" name="inspectionDate" required></div><div class="col"><label>Area</label><select name="area">${LAGOS_LGAs.map(a=>`<option>${a}</option>`).join('')}</select></div></div>
        <div class="row"><div class="col"><label>Facility Name</label><input name="facilityName" required></div><div class="col"><label>Facility Address</label><input name="facilityAddress" required></div></div>
        <div style="margin-top:8px"><label>Activity Type</label><select name="activityType" required><option value=""></option><option>Consultative Meeting</option><option>GLSI</option><option>Routine Surveillance</option><option>GSDP</option><option>Consumer Complaint</option><option>RASFF</option><option>Survey</option><option>Laboratory Analysis</option><option>COLD CHAIN Monitoring</option></select></div>
        <div name="conditional" style="margin-top:8px"></div>
        <div style="margin-top:8px"><label>Action Taken / Remarks</label><textarea name="actionTaken" rows="4"></textarea></div>
      </div>
      <div class="controls" style="margin-top:24px; display:flex; justify-content:space-between;">
        <button id="backBtn">Back</button>
        <button id="nextBtn">${index + 1 < total ? 'Next Facility' : 'Submit All Reports'}</button>
      </div>
    </section>`;
}

function bindStep_SelectCount() {
  document.getElementById('cancelWizard').onclick = () => navigate('welcome');
  document.getElementById('nextBtn').onclick = () => {
    wizardState.facilityCount = parseInt(document.getElementById('facilityCountSelect').value);
    wizardState.facilities = Array.from({ length: wizardState.facilityCount }, () => ({}));
    renderWizardStep();
  };
}

function bindStep_AskConsistency() {
  document.getElementById('backBtn').onclick = () => {
    wizardState.facilityCount = 0;
    renderWizardStep();
  };
  document.getElementById('inspectorsYes').onclick = () => {
    wizardState.sameInspectorsForAll = true;
    renderWizardStep();
  };
  document.getElementById('inspectorsNo').onclick = () => {
    wizardState.sameInspectorsForAll = false;
    renderWizardStep();
  };
}

function bindStep_SharedInspectors() {
    const inspectorSelect = document.getElementById('sharedInspectorSelect');
    inspectorSelect.innerHTML = INSPECTORS_LIST.map(name => `<option value="${name}">${name}</option>`).join('');
    const otherInput = document.getElementById('sharedInspectorOther');
    const choices = new Choices(inspectorSelect, { removeItemButton: true, placeholder: true, placeholderValue: 'Select Inspector(s)...' });
    activeChoicesInstances.push({key: 'sharedInspectorSelect', instance: choices});

    inspectorSelect.addEventListener('change', () => {
        const selected = choices.getValue(true);
        otherInput.style.display = selected.includes('Others') ? 'block' : 'none';
        if (!selected.includes('Others')) otherInput.value = '';
    });
    
    document.getElementById('backBtn').onclick = () => {
        wizardState.sameInspectorsForAll = null;
        renderWizardStep();
    };
    document.getElementById('nextBtn').onclick = () => {
        const selected = choices.getValue(true).filter(name => name !== 'Others');
        const otherText = otherInput.value.trim();
        const fromOther = otherText ? otherText.split(',').map(n => n.trim()).filter(Boolean) : [];
        const finalNames = [...selected, ...fromOther];

        if (finalNames.length === 0) { alert('Please select at least one inspector.'); return; }
        
        wizardState.sharedInspectorNames = finalNames;
        renderWizardStep();
    };
}

function bindStep_FacilityForm() {
    const container = document.getElementById('facilityFormContainer');
    const currentIndex = wizardState.currentFacilityIndex;
    const currentData = wizardState.facilities[currentIndex] || {};

    Object.keys(currentData).forEach(key => {
        if (key === 'inspectorNames' || key === 'productTypes') return;
        const el = container.querySelector(`[name="${key}"]`);
        if(el) el.value = currentData[key];
    });

    if(wizardState.sameInspectorsForAll === false) {
        const inspectorSelect = container.querySelector('select[name="inspectorNameSelect"]');
        inspectorSelect.innerHTML = INSPECTORS_LIST.map(name => `<option value="${name}">${name}</option>`).join('');
        const choices = new Choices(inspectorSelect, { removeItemButton: true, placeholder: true, placeholderValue: 'Select Inspector(s)...' });
        activeChoicesInstances.push({ key: 'inspectorNameSelect', instance: choices });

        const otherInspectorInput = container.querySelector('textarea[name="inspectorNameOther"]');
        inspectorSelect.addEventListener('change', () => {
            const selected = choices.getValue(true);
            otherInspectorInput.style.display = selected.includes('Others') ? 'block' : 'none';
            if (!selected.includes('Others')) otherInspectorInput.value = '';
        });
        if (currentData.inspectorNames) choices.setValue(currentData.inspectorNames);
    }

    const activitySelect = container.querySelector('select[name="activityType"]');
    const conditional = container.querySelector('[name="conditional"]');

    function updateConditionalFields() {
        const oldChoices = activeChoicesInstances.filter(item => item.key === 'productTypeSelect');
        oldChoices.forEach(item => item.instance.destroy());
        activeChoicesInstances = activeChoicesInstances.filter(item => item.key !== 'productTypeSelect');
        
        let conditionalHTML = '';
        const val = activitySelect.value;

        const mopUpHTML = `
            <div class="row" style="margin-top:8px">
                <div class="col">
                    <label>Did you mop up?</label>
                    <select name="mopUp"><option value="false">No</option><option value="true">Yes</option></select>
                </div>
            </div>
            <div name="mopUpDetailsContainer" style="display: none; background: #f8f9fa; padding: 12px; border-radius: 8px; margin-top: 8px;">
                <label style="font-size: 14px; margin-bottom: 12px;">Enter mopped up counts by category:</label>
                <div class="row">
                    <div class="col"><label class="small">Drugs</label><input name="mopUpDrugs" type="number" min="0" value="0"></div>
                    <div class="col"><label class="small">Cosmetics</label><input name="mopUpCosmetics" type="number" min="0" value="0"></div>
                </div>
                <div class="row" style="margin-top: 8px;">
                    <div class="col"><label class="small">Medical Devices</label><input name="mopUpMedicalDevices" type="number" min="0" value="0"></div>
                    <div class="col"><label class="small">Food</label><input name="mopUpFood" type="number" min="0" value="0"></div>
                </div>
            </div>`;

        const holdHTML = `
            <div class="row" style="margin-top:8px">
                <div class="col">
                    <label>Did you place product on hold?</label>
                    <select name="hold"><option value="false">No</option><option value="true">Yes</option></select>
                </div>
            </div>
            <div name="holdDetailsContainer" style="display: none; background: #f8f9fa; padding: 12px; border-radius: 8px; margin-top: 8px;">
                <label style="font-size: 14px; margin-bottom: 12px;">Enter counts on hold by category:</label>
                <div class="row">
                    <div class="col"><label class="small">Drugs</label><input name="holdDrugs" type="number" min="0" value="0"></div>
                    <div class="col"><label class="small">Cosmetics</label><input name="holdCosmetics" type="number" min="0" value="0"></div>
                </div>
                <div class="row" style="margin-top: 8px;">
                    <div class="col"><label class="small">Medical Devices</label><input name="holdMedicalDevices" type="number" min="0" value="0"></div>
                    <div class="col"><label class="small">Food</label><input name="holdFood" type="number" min="0" value="0"></div>
                </div>
            </div>`;

        if (['Routine Surveillance', 'Consumer Complaint'].includes(val)) {
            conditionalHTML = `
                <div style="margin-top:8px">
                    <label>Product Type(s)</label>
                    <select name="productTypeSelect" multiple></select>
                </div>
                ${mopUpHTML}
                ${holdHTML}
            `;
        } else if (['GLSI', 'RASFF', 'COLD CHAIN Monitoring'].includes(val)) {
            conditionalHTML = `${mopUpHTML}${holdHTML}`;
        } else if (val === 'Consultative Meeting') {
             conditionalHTML = `
                <div class="row">
                    <div class="col"><label>Meeting Category</label><select name="consultativeMeetingCategory"><option value="">Select a category...</option><option value="Surveillance">Surveillance</option><option value="Consumer Complaint">Consumer Complaint</option></select></div>
                    <div class="col" id="consultativeSubCategoryContainer" style="display: none;"><label>Product Type</label><select name="consultativeProductType"></select></div>
                </div>
                <div class="row" style="margin-top:12px">
                    <div class="col"><label>Sanction given?</label><select name="sanctionGiven"><option value="false">No</option><option value="true">Yes</option></select></div>
                    <div class="col" id="sanctionDocContainer" style="display: none;"><label>Sanction doc (if any)</label><div><input type="file" name="sanctionDoc" accept="application/pdf,image/*"></div></div>
                </div>
            `;
        } else if (val === 'GSDP') {
            conditionalHTML = `<div style="margin-top:8px"><label>GSDP Sub-Activity</label><select name="gsdpSubActivity"><option>GDP</option><option>CEVI</option></select></div>`;
        } else if (val === 'Laboratory Analysis') {
            conditionalHTML = `<div style="margin-top:8px"><label>How many samples taken?</label><input name="Samplescount" type="number" min="0" value="0"></div>`;
        }

        conditional.innerHTML = conditionalHTML;

        const productSelect = conditional.querySelector('select[name="productTypeSelect"]');
        if (productSelect) {
            productSelect.innerHTML = PRODUCT_TYPES.map(pt => `<option value="${pt}">${pt}</option>`).join('');
            const choices = new Choices(productSelect, { removeItemButton: true, placeholder: true, placeholderValue: 'Select Product Type(s)...' });
            activeChoicesInstances.push({ key: 'productTypeSelect', instance: choices });
            if (currentData.productTypes) {
                choices.setValue(currentData.productTypes);
            }
        }
        
        const categorySelect = conditional.querySelector('[name="consultativeMeetingCategory"]');
        if (categorySelect) {
            const subCategoryContainer = conditional.querySelector('#consultativeSubCategoryContainer');
            const subCategorySelect = conditional.querySelector('[name="consultativeProductType"]');
            const surveillanceProducts = ["Drugs", "Food", "Medical Devices", "Cosmetics", "Vaccines & Biologics", "Herbals"];
            const complaintProducts = ["Food", "Drugs", "Medical Devices", "Herbals"];

            categorySelect.addEventListener('change', () => {
                const selectedCategory = categorySelect.value;
                if (selectedCategory) {
                    const options = selectedCategory === 'Surveillance' ? surveillanceProducts : complaintProducts;
                    subCategorySelect.innerHTML = options.map(p => `<option value="${p}">${p}</option>`).join('');
                    subCategoryContainer.style.display = 'block';
                } else {
                    subCategoryContainer.style.display = 'none';
                }
            });
        }

        const sanctionSelect = conditional.querySelector('select[name="sanctionGiven"]');
        if(sanctionSelect) {
            const sanctionDocContainer = conditional.querySelector('#sanctionDocContainer');
            sanctionSelect.addEventListener('change', () => {
                sanctionDocContainer.style.display = sanctionSelect.value === 'true' ? 'block' : 'none';
            });
        }
        
        const mopUpSelect = conditional.querySelector('select[name="mopUp"]');
        if(mopUpSelect) {
            const mopUpDetails = conditional.querySelector('[name="mopUpDetailsContainer"]');
            mopUpSelect.addEventListener('change', () => {
                mopUpDetails.style.display = mopUpSelect.value === 'true' ? 'block' : 'none';
            });
        }

        const holdSelect = conditional.querySelector('select[name="hold"]');
        if(holdSelect) {
            const holdDetails = conditional.querySelector('[name="holdDetailsContainer"]');
            holdSelect.addEventListener('change', () => {
                holdDetails.style.display = holdSelect.value === 'true' ? 'block' : 'none';
            });
        }
        
        Object.keys(currentData).forEach(key => {
            const el = conditional.querySelector(`[name="${key}"]`);
            if(el) {
                el.value = currentData[key];
                el.dispatchEvent(new Event('change'));
            }
        });
    }

    activitySelect.addEventListener('change', updateConditionalFields);
    updateConditionalFields();
    
    document.getElementById('backBtn').onclick = () => {
        saveCurrentFacilityData();
        if (currentIndex > 0) {
            wizardState.currentFacilityIndex--;
        } else {
            if (wizardState.sameInspectorsForAll === true) {
                wizardState.sharedInspectorNames = [];
            } else {
                wizardState.sameInspectorsForAll = null;
            }
        }
        renderWizardStep();
    };
    
    document.getElementById('nextBtn').onclick = () => {
        if (!saveCurrentFacilityData()) return; 

        if (currentIndex + 1 < wizardState.facilityCount) {
            wizardState.currentFacilityIndex++;
            renderWizardStep();
        } else {
            handleSubmitWizard();
        }
    };
}

function saveCurrentFacilityData() {
    const container = document.getElementById('facilityFormContainer');
    const data = {};
    
    const facilityNameInput = container.querySelector('input[name="facilityName"]');
    if (!facilityNameInput.value.trim()) {
        alert('Facility Name is required.');
        facilityNameInput.focus();
        return false;
    }

    if (wizardState.sameInspectorsForAll === false) {
        const choicesItem = activeChoicesInstances.find(item => item.key === 'inspectorNameSelect');
        const selected = choicesItem ? choicesItem.instance.getValue(true).filter(name => name !== 'Others') : [];
        const otherText = container.querySelector('textarea[name="inspectorNameOther"]').value.trim();
        const fromOther = otherText ? otherText.split(',').map(n => n.trim()).filter(Boolean) : [];
        data.inspectorNames = [...selected, ...fromOther];
        if (data.inspectorNames.length === 0) { alert('Please select at least one inspector for this facility.'); return false; }
    }

    const productChoicesItem = activeChoicesInstances.find(item => item.key === 'productTypeSelect');
    data.productTypes = productChoicesItem ? productChoicesItem.instance.getValue(true) : [];
    
    const fields = [
        'inspectionDate', 'area', 'facilityName', 'facilityAddress', 'activityType', 'actionTaken', 
        'sanctionGiven', 'gsdpSubActivity', 'Samplescount', 'consultativeMeetingCategory', 'consultativeProductType',
        'mopUp', 'mopUpDrugs', 'mopUpCosmetics', 'mopUpMedicalDevices', 'mopUpFood',
        'hold', 'holdDrugs', 'holdCosmetics', 'holdMedicalDevices', 'holdFood'
    ];
    fields.forEach(fieldName => {
        const el = container.querySelector(`[name="${fieldName}"]`);
        if(el) {
            data[fieldName] = el.value;
        }
    });
    
    data.mopUpCount = (parseInt(data.mopUpDrugs) || 0) + (parseInt(data.mopUpCosmetics) || 0) + (parseInt(data.mopUpMedicalDevices) || 0) + (parseInt(data.mopUpFood) || 0);
    data.holdCount = (parseInt(data.holdDrugs) || 0) + (parseInt(data.holdCosmetics) || 0) + (parseInt(data.holdMedicalDevices) || 0) + (parseInt(data.holdFood) || 0);

    wizardState.facilities[wizardState.currentFacilityIndex] = data;
    return true;
}

async function handleSubmitWizard() {
    const submitButton = document.querySelector('#nextBtn');
    submitButton.textContent = "Submitting...";
    submitButton.disabled = true;
    const submissionId = 'sub_' + Date.now();

    try {
        for (const facilityData of wizardState.facilities) {
            const finalInspectorNames = wizardState.sameInspectorsForAll ? wizardState.sharedInspectorNames : facilityData.inspectorNames;
            
            const sanctionFileEl = document.querySelector(`input[name="sanctionDoc"]`);
            let sanctionDocUrl = '';
            if (facilityData.sanctionGiven === 'true' && sanctionFileEl && sanctionFileEl.files[0]) {
                const uploaded = await uploadToCloudinary(sanctionFileEl.files[0]);
                sanctionDocUrl = uploaded.secure_url || '';
            }
            
            await addDoc(collection(db, 'facilityReports'), {
                submissionId,
                inspectorNames: finalInspectorNames,
                productTypes: facilityData.productTypes || [],
                inspectionDate: facilityData.inspectionDate ? new Date(facilityData.inspectionDate) : new Date(),
                area: facilityData.area,
                facilityName: facilityData.facilityName,
                facilityAddress: facilityData.facilityAddress,
                activityType: facilityData.activityType,
                actionTaken: facilityData.actionTaken,
                sanctionGiven: facilityData.sanctionGiven === 'true',
                sanctionDocUrl: sanctionDocUrl,
                mopUp: facilityData.mopUp === 'true',
                mopUpCount: parseInt(facilityData.mopUpCount || 0),
                mopUpCounts: {
                    drugs: parseInt(facilityData.mopUpDrugs || 0),
                    cosmetics: parseInt(facilityData.mopUpCosmetics || 0),
                    medicalDevices: parseInt(facilityData.mopUpMedicalDevices || 0),
                    food: parseInt(facilityData.mopUpFood || 0)
                },
                hold: facilityData.hold === 'true',
                holdCount: parseInt(facilityData.holdCount || 0),
                holdCounts: {
                    drugs: parseInt(facilityData.holdDrugs || 0),
                    cosmetics: parseInt(facilityData.holdCosmetics || 0),
                    medicalDevices: parseInt(facilityData.holdMedicalDevices || 0),
                    food: parseInt(facilityData.holdFood || 0)
                },
                gsdpSubActivity: facilityData.gsdpSubActivity || '',
                Samples: parseInt(facilityData.Samplescount || 0) > 0,
                Samplescount: parseInt(facilityData.Samplescount || 0),
                consultativeMeetingCategory: facilityData.consultativeMeetingCategory || '',
                consultativeProductType: facilityData.consultativeProductType || '',
                createdBy: currentUser.uid,
                createdAt: serverTimestamp()
            });
        }
        await addDoc(collection(db, 'submissions'), { id: submissionId, createdBy: currentUser.uid, createdAt: serverTimestamp(), count: wizardState.facilityCount });
        navigate('success');
    } catch(err) {
        console.error("Final Submission Error:", err);
        alert("An error occurred during submission: " + err.message);
        submitButton.textContent = "Submit All Reports";
        submitButton.disabled = false;
    }
}

async function uploadToCloudinary(file){
  if(CLOUDINARY_UPLOAD_PRESET === 'YOUR_UNSIGNED_UPLOAD_PRESET' || !CLOUDINARY_UPLOAD_PRESET){
    throw new Error('Set CLOUDINARY_UPLOAD_PRESET in app.js to your unsigned upload preset name');
  }
  const fd = new FormData(); fd.append('file', file); fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(CLOUDINARY_UPLOAD_URL, {method:'POST',body:fd}); return await res.json();
}

let chartActivities, chartMopHold, chartGsdv, chartSanctions;
let dashboardChoices = [];
let lastLoadedReports = [];
let lastLoadedInspectors = [];

function bindSuccess(){ document.getElementById('backToWelcome').onclick = ()=> navigate('welcome'); }

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
    }

    document.getElementById('saveKpiSettings').onclick = async () => {
        const settings = {
            targetSurveillance: parseInt(document.getElementById('targetSurveillance').value) || 0,
            targetGsdp: parseInt(document.getElementById('targetGsdp').value) || 0,
            receivedGlsi: parseInt(document.getElementById('receivedGlsi').value) || 0,
            receivedComplaints: parseInt(document.getElementById('receivedComplaints').value) || 0,
            updatedAt: serverTimestamp()
        };

        try {
            await setDoc(kpiDocRef, settings, { merge: true });
            alert('KPI settings saved successfully!');
            navigate('dashboard');
        } catch (error) {
            console.error("Error saving KPI settings:", error);
            alert("An error occurred. Could not save settings.");
        }
    };
}

function bindDashboard(){
    document.getElementById('backToWelcome').onclick = () => navigate('welcome');
    
    dashboardChoices.forEach(c => c.destroy());
    dashboardChoices = [];
    
    const productTypeFilter = document.getElementById('filterProductType');
    productTypeFilter.innerHTML = PRODUCT_TYPES.map(pt => `<option value="${pt}">${pt}</option>`).join('');
    const productChoices = new Choices(productTypeFilter, {
        removeItemButton: true, placeholder: true, placeholderValue: 'Filter by Product...'
    });
    dashboardChoices.push(productChoices);

    document.getElementById('applyFilters').onclick = loadDashboard;
    document.getElementById('exportCsvBtn').onclick = () => {
        if (lastLoadedReports.length === 0) {
            alert("There is no data to export. Please apply a filter first.");
            return;
        }
        exportToCSV(lastLoadedReports, lastLoadedInspectors);
    };

    loadDashboard();
}

async function loadDashboard() {
  if (currentUserRole !== 'admin') {
    return;
  }

  const kpiDocRef = doc(db, 'settings', 'kpiTargets');
  const kpiSnap = await getDoc(kpiDocRef);
  const kpiTargets = kpiSnap.exists() ? kpiSnap.data() : {
      targetSurveillance: 70, targetGsdp: 15, receivedGlsi: 6, receivedComplaints: 20
  };

  let q = query(collection(db, 'facilityReports'));

  const filterActivity = document.getElementById('filterActivity').value;
  const filterArea = document.getElementById('filterArea').value;
  const filterInspector = document.getElementById('filterInspector').value;
  const filterFrom = document.getElementById('filterFrom').value;
  const filterTo = document.getElementById('filterTo').value;
  
  const productTypeFilterEl = dashboardChoices[0].passedElement.element;
  const selectedProductTypes = Array.from(productTypeFilterEl.selectedOptions).map(option => option.value);

  if (filterActivity) q = query(q, where('activityType', '==', filterActivity));
  if (filterArea) q = query(q, where('area', '==', filterArea));
  if (filterInspector) q = query(q, where('createdBy', '==', filterInspector));
  if (selectedProductTypes.length > 0) {
      q = query(q, where('productTypes', 'array-contains-any', selectedProductTypes));
  }
  
  if (filterFrom) {
    const fromDate = new Date(filterFrom); fromDate.setHours(0,0,0,0);
    q = query(q, where('inspectionDate', '>=', fromDate));
  }
  if (filterTo) {
    const toDate = new Date(filterTo); toDate.setHours(23,59,59,999);
    q = query(q, where('inspectionDate', '<=', toDate));
  }

  if (filterFrom || filterTo) {
      q = query(q, orderBy('inspectionDate', 'desc'));
  }
  q = query(q, orderBy('createdAt', 'desc'));
  
  try {
    const snap = await getDocs(q);
    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allUsersSnap = await getDocs(query(collection(db, 'users')));
    const inspectors = allUsersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    lastLoadedReports = reports;
    lastLoadedInspectors = inspectors;

    const inspectorSelect = document.getElementById('filterInspector');
    if (inspectorSelect.options.length <= 1) {
        inspectorSelect.innerHTML = '<option value="">All Submitters</option>' + inspectors.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    }
    
    renderKpiOverview(reports, kpiTargets);
    renderStatCards(reports);
    renderTable(reports, inspectors);
    buildActivityChart(reports);
    buildMopHoldChart(reports);
    buildGsdvChart(reports);
    buildSanctionsChart(reports);
  } catch (error) {
      console.error("Error fetching dashboard data:", error);
      if (error.code === 'failed-precondition') {
          document.getElementById('tableContainer').innerHTML = `<div class="muted" style="color: red; padding: 20px;">
              <b>Action Required:</b> A database index is missing. 
              <br>1. Open the developer console (F12).
              <br>2. Find the error message from Firebase.
              <br>3. Click the link in the error message to create the index in your Firebase project.
              <br>It may take a few minutes to build.
          </div>`;
      }
  }
}

function renderKpiOverview(reports, targets) {
    const container = document.getElementById('kpiGridContainer');
    if (!container) return;
    
    const currentSurveillance = reports.filter(r => r.activityType === 'Routine Surveillance').length;
    const currentGsdp = reports.filter(r => r.activityType === 'GSDP').length;
    const treatedComplaints = reports.filter(r => r.activityType === 'Consumer Complaint').length;
    const treatedGlsi = reports.filter(r => r.activityType === 'GLSI').length;

    const kpis = [
        { title: 'Routine Surveillance', current: currentSurveillance, target: targets.targetSurveillance || 0 },
        { title: 'GSDP', current: currentGsdp, target: targets.targetGsdp || 0 },
        { title: 'Consumer Complaints Treated', current: treatedComplaints, target: targets.receivedComplaints || 0 },
        { title: 'GLSI Handled', current: treatedGlsi, target: targets.receivedGlsi || 0 }
    ];

    container.innerHTML = kpis.map(kpi => {
        const target = kpi.target || 1;
        const percentage = Math.round((kpi.current / target) * 100);
        const displayPercentage = isFinite(percentage) ? percentage : 0;
        const progressWidth = Math.min(displayPercentage, 100);
        const isComplete = displayPercentage >= 100;

        return `
        <div class="kpi-card">
          <div class="kpi-title">${kpi.title}</div>
          <div class="kpi-progress-bar">
            <div class="kpi-progress ${isComplete ? 'complete' : ''}" style="width: ${progressWidth}%;"></div>
          </div>
          <span class="kpi-values">${kpi.current} / ${kpi.target || 'N/A'}</span>
          <span class="kpi-percentage">(${kpi.target > 0 ? displayPercentage : 'N/A'}%)</span>
        </div>`;
    }).join('');
}

function renderStatCards(data) {
    const totalReports = data.length;
    const totalSanctions = data.filter(r => r.sanctionGiven).length;
    const totalMopUps = data.reduce((sum, r) => sum + (r.mopUpCount || 0), 0);
    const uniqueFacilities = new Set(data.map(r => r.facilityName)).size;
    const container = document.getElementById('statCardsContainer');
    container.innerHTML = `
        <div class="stat-card"><div class="stat-card-title">Total Reports</div><div class="stat-card-value">${totalReports}</div></div>
        <div class="stat-card"><div class="stat-card-title">Facilities Visited</div><div class="stat-card-value">${uniqueFacilities}</div></div>
        <div class="stat-card"><div class="stat-card-title">Total Sanctions</div><div class="stat-card-value">${totalSanctions}</div></div>
        <div class="stat-card"><div class="stat-card-title">Products Mopped Up</div><div class="stat-card-value">${totalMopUps.toLocaleString()}</div></div>`;
}

function renderTable(data, inspectors) {
  const container = document.getElementById('tableContainer');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="muted" style="text-align:center; padding: 20px;">No records match the current filters.</div>';
    return;
  }
  const html = ['<table><thead><tr><th>Date</th><th>Area</th><th>Facility</th><th>Activity</th><th>Inspector(s)</th><th>Submitted By</th></tr></thead><tbody>'];
  data.forEach(report => {
    const inspectionDate = report.inspectionDate && report.inspectionDate.toDate ? report.inspectionDate.toDate().toLocaleDateString() : 'N/A';
    const inspectorsDisplay = Array.isArray(report.inspectorNames) ? report.inspectorNames.join(', ') : (report.inspectorName || 'N/A');
    const submitter = inspectors.find(i => i.id === report.createdBy);
    const submitterName = submitter ? submitter.name : (report.createdBy ? report.createdBy.substring(0, 8) + '...' : 'Unknown');
    html.push(
     `<tr data-id="${report.id}">
        <td>${inspectionDate}</td>
        <td>${report.area || ''}</td>
        <td>${report.facilityName || ''}</td>
        <td>${report.activityType || ''}</td>
        <td>${inspectorsDisplay}</td>
        <td>${submitterName}</td>
      </tr>`);
  });
  html.push('</tbody></table>');
  container.innerHTML = html.join('');
  container.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const reportId = tr.getAttribute('data-id');
      const reportData = data.find(r => r.id === reportId);
      if (reportData) {
        showReportModal(reportData, inspectors);
      }
    });
  });
}

function showReportModal(d, inspectors) {
  const inspectionDate = d.inspectionDate && d.inspectionDate.toDate ? d.inspectionDate.toDate().toLocaleString() : 'N/A';
  const createdAt = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toLocaleString() : 'N/A';
  const inspectorsDisplay = Array.isArray(d.inspectorNames) ? d.inspectorNames.join(', ') : (d.inspectorName || 'N/A');
  const productTypesDisplay = Array.isArray(d.productTypes) && d.productTypes.length > 0 ? d.productTypes.join(', ') : 'N/A';
  const submitter = inspectors.find(i => i.id === d.createdBy);
  const submitterName = submitter ? submitter.name : d.createdBy;

  let mopUpDetailsHTML = '';
  if (d.mopUp && d.mopUpCounts) {
    mopUpDetailsHTML = `
    <div style="margin-left: 20px; font-size: 14px; background: #f8f9fa; padding: 8px; border-radius: 4px; margin-top: 4px;">
        <strong>Details:</strong><br>
        - Drugs: ${d.mopUpCounts.drugs || 0}<br>
        - Cosmetics: ${d.mopUpCounts.cosmetics || 0}<br>
        - Medical Devices: ${d.mopUpCounts.medicalDevices || 0}<br>
        - Food: ${d.mopUpCounts.food || 0}
    </div>`;
  }
  let holdDetailsHTML = '';
  if (d.hold && d.holdCounts) {
    holdDetailsHTML = `
    <div style="margin-left: 20px; font-size: 14px; background: #f8f9fa; padding: 8px; border-radius: 4px; margin-top: 4px;">
        <strong>Details:</strong><br>
        - Drugs: ${d.holdCounts.drugs || 0}<br>
        - Cosmetics: ${d.holdCounts.cosmetics || 0}<br>
        - Medical Devices: ${d.holdCounts.medicalDevices || 0}<br>
        - Food: ${d.holdCounts.food || 0}
    </div>`;
  }

  const modalHTML = `
    <div class="modal-backdrop">
      <div class="modal-content">
        <div class="modal-header"><h3>Report Details</h3><button id="closeModalBtn" style="background:transparent;color:var(--primary-text);font-size:24px;">&times;</button></div>
        <div>
          <p><strong>Facility:</strong> ${d.facilityName || 'N/A'}</p><p><strong>Address:</strong> ${d.facilityAddress || 'N/A'}</p><p><strong>Area:</strong> ${d.area || 'N/A'}</p><p><strong>Inspection Date:</strong> ${inspectionDate}</p><hr>
          <p><strong>Inspector(s):</strong> ${inspectorsDisplay}</p><hr>
          <p><strong>Activity Type:</strong> ${d.activityType || 'N/A'}</p>
          ${d.consultativeMeetingCategory ? `<p><strong>Meeting Category:</strong> ${d.consultativeMeetingCategory}</p>` : ''}
          ${d.consultativeProductType ? `<p><strong>Consultative Product Type:</strong> ${d.consultativeProductType}</p>` : ''}
          ${d.productTypes && d.productTypes.length > 0 ? `<p><strong>Product Type(s):</strong> ${productTypesDisplay}</p>` : ''}
          ${d.gsdpSubActivity ? `<p><strong>GSDP Sub-Activity:</strong> ${d.gsdpSubActivity}</p>` : ''}
          <p><strong>Sanction Given:</strong> ${d.sanctionGiven ? 'Yes' : 'No'}</p>
          ${d.sanctionDocUrl ? `<p><strong>Sanction Document:</strong> <a href="${d.sanctionDocUrl}" target="_blank">View Document</a></p>` : ''}
          <p><strong>Product Mopped Up:</strong> ${d.mopUp ? `Yes (${d.mopUpCount || 0})` : 'No'}</p>
          ${mopUpDetailsHTML}
          <p><strong>Product on Hold:</strong> ${d.hold ? `Yes (${d.holdCount || 0})` : 'No'}</p>
          ${holdDetailsHTML}
          <p><strong>Samples Taken:</strong> ${d.Samples ? `Yes (${d.Samplescount || 0})` : 'No'}</p><hr>
          <p><strong>Action Taken / Remarks:</strong></p><p style="white-space: pre-wrap; background: #f8f9fa; padding: 8px; border-radius: 4px;">${d.actionTaken || 'No remarks provided.'}</p><hr>
          <p class="muted small">Report ID: ${d.id}</p><p class="muted small">Submitted By: ${submitterName}</p><p class="muted small">Submitted At: ${createdAt}</p>
        </div>
      </div>
    </div>`;
  modalContainer.innerHTML = modalHTML;
  document.getElementById('closeModalBtn').onclick = () => modalContainer.innerHTML = '';
  document.querySelector('.modal-backdrop').onclick = (e) => { if (e.target === e.currentTarget) modalContainer.innerHTML = ''; };
}

function sanitizeCSVField(field) {
    if (field === null || field === undefined) {
        return '';
    }
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        const escapedStr = str.replace(/"/g, '""');
        return `"${escapedStr}"`;
    }
    return str;
}

function exportToCSV(reports, inspectors) {
    const headers = [
        'Report ID', 'Inspection Date', 'Area', 'Facility Name', 'Facility Address', 
        'Activity Type', 'Meeting Category', 'Consultative Product Type', 
        'Product Types (Multi)', 'GSDP Sub-Activity', 'Action/Remarks', 
        'Inspector(s)', 'Sanction Given', 
        'Mop Up', 'Mop Up Count (Total)', 'Mop Up Count (Drugs)', 'Mop Up Count (Cosmetics)', 'Mop Up Count (Medical Devices)', 'Mop Up Count (Food)',
        'Product on Hold', 'Hold Count (Total)', 'Hold Count (Drugs)', 'Hold Count (Cosmetics)', 'Hold Count (Medical Devices)', 'Hold Count (Food)',
        'Samples Taken', 'Samples Count', 
        'Submitted By', 'Submission Date'
    ];

    const rows = reports.map(report => {
        const submitter = inspectors.find(i => i.id === report.createdBy);
        const submitterName = submitter ? submitter.name : 'Unknown';
        
        const rowData = {
            'Report ID': report.id,
            'Inspection Date': report.inspectionDate?.toDate().toLocaleDateString() || 'N/A',
            'Area': report.area || '',
            'Facility Name': report.facilityName || '',
            'Facility Address': report.facilityAddress || '',
            'Activity Type': report.activityType || '',
            'Meeting Category': report.consultativeMeetingCategory || '',
            'Consultative Product Type': report.consultativeProductType || '',
            'Product Types (Multi)': (report.productTypes || []).join('; '),
            'GSDP Sub-Activity': report.gsdpSubActivity || '',
            'Action/Remarks': report.actionTaken || '',
            'Inspector(s)': (report.inspectorNames || []).join('; '),
            'Sanction Given': report.sanctionGiven ? 'Yes' : 'No',
            'Mop Up': report.mopUp ? 'Yes' : 'No',
            'Mop Up Count (Total)': report.mopUpCount || 0,
            'Mop Up Count (Drugs)': report.mopUpCounts?.drugs || 0,
            'Mop Up Count (Cosmetics)': report.mopUpCounts?.cosmetics || 0,
            'Mop Up Count (Medical Devices)': report.mopUpCounts?.medicalDevices || 0,
            'Mop Up Count (Food)': report.mopUpCounts?.food || 0,
            'Product on Hold': report.hold ? 'Yes' : 'No',
            'Hold Count (Total)': report.holdCount || 0,
            'Hold Count (Drugs)': report.holdCounts?.drugs || 0,
            'Hold Count (Cosmetics)': report.holdCounts?.cosmetics || 0,
            'Hold Count (Medical Devices)': report.holdCounts?.medicalDevices || 0,
            'Hold Count (Food)': report.holdCounts?.food || 0,
            'Samples Taken': report.Samples ? 'Yes' : 'No',
            'Samples Count': report.Samplescount || 0,
            'Submitted By': submitterName,
            'Submission Date': report.createdAt?.toDate().toLocaleString() || 'N/A'
        };
        return headers.map(header => sanitizeCSVField(rowData[header]));
    });

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        const today = new Date().toISOString().slice(0, 10);
        link.setAttribute('href', url);
        link.setAttribute('download', `pms_reports_${today}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function buildActivityChart(data){ const counts = {}; data.forEach(d=> counts[d.activityType] = (counts[d.activityType]||0)+1); const labels = Object.keys(counts); const vals = labels.map(l=>counts[l]); if(chartActivities) chartActivities.destroy(); const ctx = document.getElementById('chartActivities').getContext('2d'); chartActivities = new Chart(ctx, {type:'pie',data:{labels, datasets:[{data:vals, backgroundColor: ['#007bff', '#6c757d', '#28a745', '#dc3545', '#ffc107', '#17a2b8', '#343a40']}]}, options:{responsive:true, plugins: { legend: { position: 'right'}}}}); }
function buildMopHoldChart(data){ const grouped = {}; data.forEach(d=>{ if(!d.inspectionDate || !d.inspectionDate.toDate) return; const day = d.inspectionDate.toDate().toISOString().slice(0,10); grouped[day] = grouped[day] || {mop:0,hold:0}; grouped[day].mop += (d.mopUpCount||0); grouped[day].hold += (d.holdCount||0); }); const labels = Object.keys(grouped).sort(); const mop = labels.map(l=>grouped[l].mop); const hold = labels.map(l=>grouped[l].hold); if(chartMopHold) chartMopHold.destroy(); const ctx = document.getElementById('chartMopHold').getContext('2d'); chartMopHold = new Chart(ctx, {type:'bar',data:{labels,datasets:[{label:'Mop-ups',data:mop, backgroundColor: '#ffc107'},{label:'Holds',data:hold, backgroundColor: '#dc3545'}]}, options:{scales:{x:{stacked:true},y:{stacked:true, beginAtZero: true}}}}); }
function buildGsdvChart(data){ const counts = {GDP:0,CEVI:0}; data.forEach(d=>{ if(d.gsdpSubActivity && counts.hasOwnProperty(d.gsdpSubActivity)) counts[d.gsdpSubActivity]++; }); const labels = Object.keys(counts); const vals = labels.map(l=>counts[l]); if(chartGsdv) chartGsdv.destroy(); const ctx = document.getElementById('chartGsdv').getContext('2d'); chartGsdv = new Chart(ctx, {type:'doughnut',data:{labels,datasets:[{data:vals, backgroundColor: ['#17a2b8', '#28a745']}]}, options:{responsive:true, plugins: { legend: { position: 'right'}}}}); }
function buildSanctionsChart(data){ const grouped = {}; data.forEach(d=>{ if(!d.inspectionDate || !d.inspectionDate.toDate) return; const day = d.inspectionDate.toDate().toISOString().slice(0,10); grouped[day] = grouped[day] || 0; if(d.sanctionGiven) grouped[day]++; }); const labels = Object.keys(grouped).sort(); const vals = labels.map(l=>grouped[l]); if(chartSanctions) chartSanctions.destroy(); const ctx = document.getElementById('chartSanctions').getContext('2d'); chartSanctions = new Chart(ctx, {type:'line',data:{labels,datasets:[{label:'Sanctions',data:vals,fill:true, borderColor: '#007bff', tension: 0.1}]}, options: {scales: {y: { beginAtZero: true }}}}); }