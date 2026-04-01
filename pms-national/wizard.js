import { db, collection, addDoc, serverTimestamp, getDocs, query, where, orderBy } from "./db.js";
import { clearRoot, addChoicesInstance, getChoicesInstance, navigate, showLoading } from "./ui.js";

// -- National Constants --
const ZONES = {
    "North Central": ["Benue", "Kogi", "Kwara", "Nasarawa", "Niger", "Plateau", "FCT Abuja"],
    "North East": ["Adamawa", "Bauchi", "Borno", "Gombe", "Taraba", "Yobe"],
    "North West": ["Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Sokoto", "Zamfara"],
    "South East": ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"],
    "South South": ["Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Rivers"],
    "South West": ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"]
};

const PRODUCT_TYPES = ["Drugs", "Food", "Medical Devices", "Cosmetics", "Vaccines & Biologics", "Herbals", "Service Drugs", "Donated Items/Drugs", "Orphan Drugs", "Chemicals", "Water Packaging"];

const ACTIVITY_TYPES = [
    "Routine Surveillance", 
    "GSDP", 
    "GLSI", 
    "Consumer Complaint", 
    "RASFF", 
    "Survey", 
    "Laboratory Analysis", 
    "COLD CHAIN Monitoring",
    "Consultative Meeting",
    "Adverts Monitoring"
];

const CLOUDINARY_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/d1mla94c/upload';
const CLOUDINARY_UPLOAD_PRESET = 'Daily-Activity';

let wizardState = {};
let currentUser = null;
let currentUserData = null;
let inspectorsCache = [];

export const initWizard = (user, userData) => {
    currentUser = user;
    currentUserData = userData;
};

/**
 * Main entry point for the Multi-Step Report Wizard
 */
export const startReportWizard = async (root) => {
    wizardState = {
        facilityCount: 0,
        sameInspectorsForAll: null,
        sharedInspectorNames: [],
        facilities: [],
        currentFacilityIndex: -1
    };

    // Prefetch all active users as potential inspectors
    if (inspectorsCache.length === 0) {
        try {
            const q = query(collection(db, 'users'), where('status', '==', 'approved'));
            const snap = await getDocs(q);
            inspectorsCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (err) {
            console.error("Error fetching inspectors:", err);
        }
    }

    renderWizardStep(root);
};

function renderWizardStep(root) {
    clearRoot(root);

    if (wizardState.facilityCount === 0) {
        root.innerHTML = renderStep_SelectCount();
        bindStep_SelectCount(root);
    } else if (wizardState.sameInspectorsForAll === null) {
        root.innerHTML = renderStep_AskConsistency();
        bindStep_AskConsistency(root);
    } else if (wizardState.sameInspectorsForAll === true && wizardState.sharedInspectorNames.length === 0) {
        root.innerHTML = renderStep_SharedInspectors();
        bindStep_SharedInspectors(root);
    } else {
        if (wizardState.currentFacilityIndex === -1) wizardState.currentFacilityIndex = 0;
        root.innerHTML = renderStep_FacilityForm();
        bindStep_FacilityForm(root);
    }
}

// ─── STEP 1: SELECT COUNT ───────────────────────────────────────────────────

function renderStep_SelectCount() {
    return `
    <section class="card animate-fade-in" style="max-width: 600px; margin: 40px auto;">
      <h2 style="text-transform: uppercase; letter-spacing: 1px;">Step 1: Activity Volume</h2>
      <p class="muted small">How many facilities did you visit or meetings did you hold? Each will generate a separate report.</p>
      
      <div style="margin-top:24px; display:flex; flex-direction:column; gap:8px;">
        <label>Number of Entries</label>
        <select id="facilityCountSelect">
          ${Array.from({ length: 15 }).map((_, i) => `<option value="${i + 1}">${i + 1} Entry/Facility</option>`).join('')}
        </select>
      </div>

      <div class="controls" style="margin-top:32px; justify-content: space-between;">
        <button id="cancelWizard" class="secondary">Cancel</button>
        <button id="nextBtn">Next &rarr;</button>
      </div>
    </section>`;
}

function bindStep_SelectCount(root) {
    document.getElementById('cancelWizard').onclick = () => navigate('welcome');
    document.getElementById('nextBtn').onclick = () => {
        wizardState.facilityCount = parseInt(document.getElementById('facilityCountSelect').value);
        wizardState.facilities = Array.from({ length: wizardState.facilityCount }, () => ({}));
        renderWizardStep(root);
    };
}

// ─── STEP 2: ASK CONSISTENCY ────────────────────────────────────────────────

function renderStep_AskConsistency() {
    return `
    <section class="card animate-fade-in" style="max-width: 600px; margin: 40px auto;">
      <h2 style="text-transform: uppercase;">Step 2: Team Identity</h2>
      <p>Was the same inspection/monitoring team present at ALL ${wizardState.facilityCount} locations?</p>
      
      <div class="controls" style="margin-top:32px; justify-content: space-between;">
        <button id="backBtn" class="secondary">&larr; Back</button>
        <div class="flex">
            <button id="inspectorsNo" class="secondary">No, specify per entry</button>
            <button id="inspectorsYes">Yes, same team</button>
        </div>
      </div>
    </section>`;
}

function bindStep_AskConsistency(root) {
    document.getElementById('backBtn').onclick = () => {
        wizardState.facilityCount = 0;
        renderWizardStep(root);
    };
    document.getElementById('inspectorsYes').onclick = () => {
        wizardState.sameInspectorsForAll = true;
        renderWizardStep(root);
    };
    document.getElementById('inspectorsNo').onclick = () => {
        wizardState.sameInspectorsForAll = false;
        renderWizardStep(root);
    };
}

// ─── STEP 3: SHARED INSPECTORS ──────────────────────────────────────────────

function renderStep_SharedInspectors() {
    return `
    <section class="card animate-fade-in" style="max-width: 600px; margin: 40px auto;">
        <h2 style="text-transform: uppercase;">Step 3: Define the Team</h2>
        <p class="muted small">This team will be assigned to all entries in this batch.</p>
        
        <div style="margin-top:24px;">
            <label>Participating Officers</label>
            <select id="sharedInspectorSelect" multiple></select>
            <textarea id="sharedInspectorOther" placeholder="For 'Others', specify names here..." style="display:none; margin-top:12px;" rows="3"></textarea>
        </div>

        <div class="controls" style="margin-top:32px; justify-content: space-between;">
            <button id="backBtn" class="secondary">&larr; Back</button>
            <button id="nextBtn">Next Entry &rarr;</button>
        </div>
    </section>`;
}

function bindStep_SharedInspectors(root) {
    const inspectorSelect = document.getElementById('sharedInspectorSelect');
    
    // Add default options + "Others"
    const options = [
        ...inspectorsCache.map(i => `<option value="${i.displayName || i.email}">${i.displayName || i.email}</option>`),
        `<option value="Others">-- Others --</option>`
    ];
    inspectorSelect.innerHTML = options.join('');

    const choices = new Choices(inspectorSelect, { 
        removeItemButton: true, 
        placeholder: true, 
        placeholderValue: 'Select Officers...' 
    });
    addChoicesInstance('sharedInspectorSelect', choices);

    const otherInput = document.getElementById('sharedInspectorOther');
    inspectorSelect.addEventListener('change', () => {
        const selected = choices.getValue(true);
        otherInput.style.display = selected.includes('Others') ? 'block' : 'none';
    });

    document.getElementById('backBtn').onclick = () => {
        wizardState.sameInspectorsForAll = null;
        renderWizardStep(root);
    };
    
    document.getElementById('nextBtn').onclick = () => {
        const selected = choices.getValue(true).filter(name => name !== 'Others');
        const otherText = otherInput.value.trim();
        const fromOther = otherText ? otherText.split(',').map(n => n.trim()).filter(Boolean) : [];
        const finalNames = [...selected, ...fromOther];

        if (finalNames.length === 0) { alert('Please select at least one officer.'); return; }

        wizardState.sharedInspectorNames = finalNames;
        renderWizardStep(root);
    };
}

// ─── STEP 4: FACILITY FORM (THE BIG ONE) ────────────────────────────────────

function renderStep_FacilityForm() {
    const index = wizardState.currentFacilityIndex;
    const total = wizardState.facilityCount;
    const showInspectorField = wizardState.sameInspectorsForAll === false;

    return `
    <section class="card animate-fade-in" style="max-width: 900px; margin: 20px auto;">
      <div style="display:flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 24px;">
        <h2 style="text-transform: uppercase; margin: 0;">Entry ${index + 1} of ${total}</h2>
        <span class="muted font-bold">${index + 1}/${total} Reports</span>
      </div>

      <div id="facilityForm">
        ${showInspectorField ? `
          <div style="margin-bottom:24px;">
            <label>Officers for this Entry</label>
            <select name="inspectorNameSelect" multiple></select>
            <textarea name="inspectorNameOther" placeholder="For 'Others', specify names here..." style="display:none; margin-top:12px;" rows="3"></textarea>
          </div>` : ''}

        <div class="row">
            <div class="col"><label>Inspection/Meeting Date</label><input type="date" name="inspectionDate" required></div>
            <div class="col"><label>Zone</label><select name="zone" required><option value=""></option>${Object.keys(ZONES).map(z => `<option>${z}</option>`).join('')}</select></div>
            <div class="col"><label>State</label><select name="state" required><option value="">Select Zone first</option></select></div>
        </div>

        <div style="margin-top:16px;">
            <label>Activity Category</label>
            <select name="activityType" required><option value=""></option>${ACTIVITY_TYPES.map(a => `<option>${a}</option>`).join('')}</select>
        </div>

        <div class="row" id="facilityIdentityRow" style="margin-top:16px;">
            <div class="col"><label>Facility/Institution Name</label><input name="facilityName" placeholder="e.g. Dana Pharmaceuticals" required></div>
            <div class="col"><label>Address</label><input name="facilityAddress" placeholder="Street, LGA/Area" required></div>
        </div>

        <!-- Conditional Fields Placeholder -->
        <div id="conditionalFields" style="margin-top:16px;"></div>

        <div style="margin-top:16px;">
            <label>Action Taken / Remarks</label>
            <textarea name="actionTaken" rows="4" placeholder="Briefly summarize findings or meeting minutes..."></textarea>
        </div>

        <div style="margin-top:16px;">
            <label>Upload Document/Sanction (Optional)</label>
            <input type="file" id="documentUpload" accept="image/*,application/pdf">
            <div id="uploadStatus" class="small muted" style="margin-top:4px;">Supports JPG, PNG and PDF</div>
        </div>
      </div>

      <div class="controls" style="margin-top:40px; justify-content: space-between;">
        <button id="backBtn" class="secondary">&larr; Back</button>
        <button id="nextBtn" class="success">${index + 1 < total ? 'Next Entry' : 'Submit National Reports'}</button>
      </div>
    </section>`;
}

function bindStep_FacilityForm(root) {
    const form = document.querySelector('#facilityForm');
    const index = wizardState.currentFacilityIndex;
    const currentData = wizardState.facilities[index] || {};

    // Restore saved values if backtracking
    Object.keys(currentData).forEach(key => {
        if (['inspectorNames', 'productTypes', 'docUrl'].includes(key)) return;
        const input = form.querySelector(`[name="${key}"]`);
        if (input) input.value = currentData[key];
    });

    // Cascading Dropdowns: Zone -> State
    const zoneSelect = form.querySelector('[name="zone"]');
    const stateSelect = form.querySelector('[name="state"]');
    zoneSelect.onchange = () => {
        const zone = zoneSelect.value;
        stateSelect.innerHTML = '<option value="">Select State...</option>';
        if (ZONES[zone]) {
            ZONES[zone].forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                stateSelect.appendChild(opt);
            });
        }
        if (currentData.state) stateSelect.value = currentData.state;
    };
    if (currentData.zone) zoneSelect.dispatchEvent(new Event('change'));

    // Handle Per-Entry Inspectors (if enabled)
    let inspectorChoices = null;
    if (wizardState.sameInspectorsForAll === false) {
        const iSelect = form.querySelector('[name="inspectorNameSelect"]');
        const options = [...inspectorsCache.map(i => `<option value="${i.displayName || i.email}">${i.displayName || i.email}</option>`), `<option value="Others">-- Others --</option>`];
        iSelect.innerHTML = options.join('');
        inspectorChoices = new Choices(iSelect, { removeItemButton: true, placeholder: true });
        addChoicesInstance('inspectorNameSelect', inspectorChoices);
        
        const otherText = form.querySelector('[name="inspectorNameOther"]');
        iSelect.addEventListener('change', () => {
            otherText.style.display = inspectorChoices.getValue(true).includes('Others') ? 'block' : 'none';
        });
        if (currentData.inspectorNames) inspectorChoices.setValue(currentData.inspectorNames);
    }

    // Conditional Fields Logic
    const activitySelect = form.querySelector('[name="activityType"]');
    const conditionalPanel = form.querySelector('#conditionalFields');
    
    activitySelect.onchange = () => {
        // Destroy old instances
        const oldPtChoices = getChoicesInstance(`ptSelect_${index}`);
        if (oldPtChoices) oldPtChoices.destroy();

        let html = '';
        const act = activitySelect.value;

        // Common Product Types Multiselect
        if (act && act !== 'Consultative Meeting') {
            html += `
                <div style="margin-bottom:16px;">
                    <label>Product Type(s)</label>
                    <select name="productTypes" multiple>
                        ${PRODUCT_TYPES.map(pt => `<option>${pt}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        if (act === 'Routine Surveillance' || act === 'GSDP') {
            html += `
                <div class="row">
                    <div class="col"><label>Mop Up?</label><select name="mopUp"><option value="false">No</option><option value="true">Yes</option></select></div>
                    <div class="col"><label>GSDV Done?</label><select name="gsdv"><option value="false">No</option><option value="true">Yes</option></select></div>
                </div>
            `;
        } else if (act === 'Consultative Meeting') {
            html += `
                <div class="row">
                    <div class="col"><label>Meeting Scope</label><select name="scope"><option>Company Specific</option><option>Technical Committee</option><option>Stakeholder Engagement</option></select></div>
                    <div class="col"><label>Primary Concern</label><input name="concern" placeholder="e.g. Price Hikes, Shortages"></div>
                </div>
            `;
        }

        conditionalPanel.innerHTML = html;

        // Initialize dynamic choices
        const ptSelect = conditionalPanel.querySelector('select[name="productTypes"]');
        if (ptSelect) {
            const choices = new Choices(ptSelect, { 
                removeItemButton: true,
                placeholder: true,
                placeholderValue: 'Select one or more products...'
            });
            addChoicesInstance(`ptSelect_${index}`, choices);
            if (currentData.productTypes) choices.setValue(currentData.productTypes);
        }
    };
    if (currentData.activityType) activitySelect.dispatchEvent(new Event('change'));

    // Navigation Buttons
    document.getElementById('backBtn').onclick = () => {
        if (index > 0) {
            wizardState.currentFacilityIndex--;
            renderWizardStep(root);
        } else {
            wizardState.sameInspectorsForAll = null;
            wizardState.sharedInspectorNames = [];
            renderWizardStep(root);
        }
    };

    document.getElementById('nextBtn').onclick = async () => {
        // Save form data to state
        const data = { ...currentData };
        form.querySelectorAll('input, select, textarea').forEach(el => {
            if (['file', 'button'].includes(el.type)) return;
            if (el.multiple) return;
            data[el.name] = el.value;
        });

        // Save multi-selects
        const ptChoices = getChoicesInstance(`ptSelect_${index}`);
        if (ptChoices) data.productTypes = ptChoices.getValue(true);

        if (wizardState.sameInspectorsForAll === false) {
            const iNames = inspectorChoices.getValue(true).filter(n => n !== 'Others');
            const iOtherText = form.querySelector('[name="inspectorNameOther"]').value.trim();
            const fromOther = iOtherText ? iOtherText.split(',').map(n => n.trim()).filter(Boolean) : [];
            data.inspectorNames = [...iNames, ...fromOther];
        } else {
            data.inspectorNames = wizardState.sharedInspectorNames;
        }

        // Handle File Upload to Cloudinary
        const fileInput = document.getElementById('documentUpload');
        if (fileInput.files.length > 0) {
            const uploadStatus = document.getElementById('uploadStatus');
            uploadStatus.innerHTML = '<span class="spinner" style="border-top-color:var(--accent); width:12px; height:12px;"></span> Uploading to Cloudinary...';
            
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

            try {
                const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: 'POST', body: formData });
                const resData = await res.json();
                data.docUrl = resData.secure_url;
                uploadStatus.innerHTML = '<span style="color:var(--success)">✅ Upload Complete</span>';
            } catch (err) {
                console.error("Cloudinary error:", err);
                alert("Upload failed. Continuing without document.");
            }
        }

        wizardState.facilities[index] = data;

        if (index + 1 < wizardState.facilityCount) {
            wizardState.currentFacilityIndex++;
            renderWizardStep(root);
        } else {
            submitAllReports(root);
        }
    };
}

async function submitAllReports(root) {
    showLoading(root, "Syncing National Reports to Database...");

    try {
        const batch = [];
        for (const f of wizardState.facilities) {
            const report = {
                ...f,
                createdBy: currentUser.uid,
                createdByEmail: currentUser.email,
                createdByName: currentUserData?.displayName || currentUser.displayName || currentUser.email,
                createdAt: serverTimestamp(),
                // Normalize dates for querying
                inspectionDate: f.inspectionDate ? new Date(f.inspectionDate) : null,
                year: f.inspectionDate ? new Date(f.inspectionDate).getFullYear() : null,
                month: f.inspectionDate ? new Date(f.inspectionDate).getMonth() + 1 : null
            };
            batch.push(addDoc(collection(db, 'facilityReports'), report));
        }

        await Promise.all(batch);
        
        // Final Success Screen
        renderSuccess(root);
    } catch (err) {
        console.error("Submission error:", err);
        alert("Database Error: " + err.message);
        renderWizardStep(root); // Bounce back
    }
}

function renderSuccess(root) {
    clearRoot(root);
    root.innerHTML = `
    <div class="card animate-fade-in" style="text-align:center; padding: 60px 40px; max-width: 700px; margin: 40px auto; border-width: 4px; border-style: double;">
        <div style="font-size: 80px; margin-bottom: 20px;">📜</div>
        <h1 style="color: var(--accent); font-weight: 900; font-size: 36px; text-transform: uppercase;">Submission Successful</h1>
        <p class="muted" style="font-size: 18px; margin-bottom: 32px;">${wizardState.facilityCount} reports have been globally synced to the National Intelligence Portal.</p>
        
        <div style="display:flex; gap:16px; justify-content: center;">
            <button onclick="window.history.replaceState({}, '', '#'); location.reload();" class="secondary">Log Out</button>
            <button onclick="window.dispatchEvent(new CustomEvent('navigate', { detail: 'welcome' }))" style="background:var(--accent-dark);">Return Home</button>
        </div>
    </div>
    `;
}
