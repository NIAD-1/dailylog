import { db, collection, addDoc, serverTimestamp, doc, getDoc, getDocs, query, where, setDoc } from "./db.js";
import { resolveFacility } from "./facility-utils.js";
import { clearRoot, addChoicesInstance, getChoicesInstance, removeChoicesInstance, navigate } from "./ui.js";

const LAGOS_LGAs = ["Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa", "Badagry", "Epe", "Eti-Osa", "Ibeju-Lekki", "Ifako-Ijaiye", "Ikeja", "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo", "Oshodi-Isolo", "Shomolu", "Surulere"];
const INSPECTORS_LIST = ["Dr Regina K. Garba", "Pharm. Mmamel Victor", "Pharm. Adesanya Oluwaseun", "Mr Omotuwa Adebayo", "Mrs Bisola Robert", "Mr Ifeanyi Okeke", "Dr Saad Abubakar", "Mr Enilama Emmanuel", "Mr Solomon Emeje Ileanwa", "Ms Mary Adegbite", "Mr Adekunle Adeniran", "Dr. Lawal Saheed", "Pharm. Chime Helen", "Pharm. Murtala Abdulkadir", "Pharm. Nazeef Umar", "Pharm. Anas Haruna Rugahh", "Pharm. Chiamaka Adibo", "Pharm. Ismail Suraj", "Others"];
const PRODUCT_TYPES = ["Drugs", "Food", "Medical Devices", "Cosmetics", "Vaccines & Biologics", "Herbals", "Service Drugs", "Donated Items/Drugs", "Orphan Drugs"];
const MAIN_PRODUCT_TYPES = ["Drugs", "Food", "Cosmetics", "Medical Devices", "Service Drugs", "Donated Items/Drugs", "Orphan Drugs"];
const CLOUDINARY_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/d1mla94c/upload';
const CLOUDINARY_UPLOAD_PRESET = 'Daily-Activity';

let wizardState = {};
let currentUser = null;
let facilityCategoryCache = {}; // Cache: { 'Routine Surveillance': ['Facility A', ...], ... }
let facilityDetailCache = {};   // Cache: { 'Routine Surveillance': [{ name, address }, ...], ... }

// ─── Load unique facility names for a given activity category ────────────────
// Queries both 'facilities' (imported database) and 'facilityReports' (logged activities)
// Merges, deduplicates, and returns a sorted array of facility names.
async function loadFacilitiesForCategory(category, forceRefresh = false) {
    // Return cached result if available and not forced to refresh
    if (!forceRefresh && facilityCategoryCache[category]) return facilityCategoryCache[category];

    const nameSet = new Set();
    const detailMap = {};  // { facilityName: address }

    // Determine which activityType to query
    const isMonitoring = category === 'Monitoring';
    const queryType = isMonitoring ? 'Routine Surveillance' : category;

    // 1. Query imported facilities database
    try {
        const facQ = query(collection(db, 'facilities'), where('activityType', '==', queryType));
        const facSnap = await getDocs(facQ);
        facSnap.forEach(d => {
            const data = d.data();
            const name = (data.facilityName || data.name || '').trim();
            if (name) {
                nameSet.add(name);
                if (!detailMap[name]) detailMap[name] = (data.address || data.facilityAddress || '').trim();
            }
        });
    } catch (error) {
        console.error('Error loading from facilities collection:', error);
        alert('Warning: Could not load master facilities list (likely a permissions issue for non-admins).');
    }

    // 2. Query logged facility reports
    try {
        const repQ = query(collection(db, 'facilityReports'), where('activityType', '==', queryType));
        const repSnap = await getDocs(repQ);
        repSnap.forEach(d => {
            const data = d.data();
            const name = (data.facilityName || '').trim();
            if (!name) return;

            if (isMonitoring) {
                const pts = data.productTypes || [];
                const monitoringTypes = ['Service Drugs', 'Orphan Drugs', 'Donated Items/Drugs'];
                if (pts.some(pt => monitoringTypes.includes(pt))) {
                    nameSet.add(name);
                    if (!detailMap[name]) detailMap[name] = (data.facilityAddress || '').trim();
                }
            } else {
                nameSet.add(name);
                if (!detailMap[name]) detailMap[name] = (data.facilityAddress || '').trim();
            }
        });
    } catch (error) {
        console.error('Error loading from facilityReports collection:', error);
        alert('Warning: Could not load past logged facilities (likely a permissions issue for non-admins).');
    }

    const sorted = [...nameSet].sort((a, b) => a.localeCompare(b));
    const details = sorted.map(name => ({ name, address: detailMap[name] || '' }));
    facilityCategoryCache[category] = sorted;
    facilityDetailCache[category] = details;
    return sorted;
}

export const setWizardUser = (user) => {
    currentUser = user;
};

export const startReportWizard = (root) => {
    wizardState = {
        facilityCount: 0,
        sameInspectorsForAll: null,
        sharedInspectorNames: [],
        facilities: [],
        currentFacilityIndex: -1
    };
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

function renderStep_SelectCount() {
    return `
    <section class="card">
      <h2>Step 1: How many facilities did you visit?</h2>
      <div style="margin-top:12px;display:flex;gap:12px;align-items:center">
        <select id="facilityCountSelect" style="width:100px">
          ${Array.from({ length: 8 }).map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
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
        <div class="row"><div class="col"><label>Date</label><input type="date" name="inspectionDate" required></div><div class="col"><label>Area</label><select name="area">${LAGOS_LGAs.map(a => `<option>${a}</option>`).join('')}</select></div></div>
        <div style="margin-top:8px"><label>Activity Type</label><select name="activityType" required><option value=""></option><option>Consultative Meeting</option><option>GLSI</option><option>Routine Surveillance</option><option>Special Surveillance</option><option>Advert</option><option>GSDP</option><option>Consumer Complaint</option><option>RASFF</option><option>Survey</option><option>Laboratory Analysis</option><option>COLD CHAIN Monitoring</option></select></div>
        <div class="row" id="regularFacilityRow"><div class="col"><label>Facility Name</label><input name="facilityName" required></div><div class="col"><label>Facility Address</label><input name="facilityAddress" required></div></div>
        <div name="conditional" style="margin-top:8px"></div>
        <div style="margin-top:8px"><label>Action Taken / Remarks</label><textarea name="actionTaken" rows="4"></textarea></div>
      </div>
      <div class="controls" style="margin-top:24px; display:flex; justify-content:space-between;">
        <button id="backBtn">Back</button>
        <button id="nextBtn">${index + 1 < total ? 'Next Facility' : 'Submit All Reports'}</button>
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

function bindStep_SharedInspectors(root) {
    const inspectorSelect = document.getElementById('sharedInspectorSelect');
    inspectorSelect.innerHTML = INSPECTORS_LIST.map(name => `<option value="${name}">${name}</option>`).join('');
    const otherInput = document.getElementById('sharedInspectorOther');
    const choices = new Choices(inspectorSelect, { removeItemButton: true, placeholder: true, placeholderValue: 'Select Inspector(s)...' });
    addChoicesInstance('sharedInspectorSelect', choices);

    inspectorSelect.addEventListener('change', () => {
        const selected = choices.getValue(true);
        otherInput.style.display = selected.includes('Others') ? 'block' : 'none';
        if (!selected.includes('Others')) otherInput.value = '';
    });

    document.getElementById('backBtn').onclick = () => {
        wizardState.sameInspectorsForAll = null;
        renderWizardStep(root);
    };
    document.getElementById('nextBtn').onclick = () => {
        const selected = choices.getValue(true).filter(name => name !== 'Others');
        const otherText = otherInput.value.trim();
        const fromOther = otherText ? otherText.split(',').map(n => n.trim()).filter(Boolean) : [];
        // Use Set to deduplicate names
        const finalNames = [...new Set([...selected, ...fromOther])];

        if (finalNames.length === 0) { alert('Please select at least one inspector.'); return; }

        wizardState.sharedInspectorNames = finalNames;
        renderWizardStep(root);
    };
}

function bindStep_FacilityForm(root) {
    const container = document.getElementById('facilityFormContainer');
    const currentIndex = wizardState.currentFacilityIndex;
    const currentData = wizardState.facilities[currentIndex] || {};

    Object.keys(currentData).forEach(key => {
        if (key === 'inspectorNames' || key === 'productTypes') return;
        const el = container.querySelector(`[name="${key}"]`);
        if (el) el.value = currentData[key];
    });

    if (wizardState.sameInspectorsForAll === false) {
        const inspectorSelect = container.querySelector('select[name="inspectorNameSelect"]');
        inspectorSelect.innerHTML = INSPECTORS_LIST.map(name => `<option value="${name}">${name}</option>`).join('');
        const choices = new Choices(inspectorSelect, { removeItemButton: true, placeholder: true, placeholderValue: 'Select Inspector(s)...' });
        addChoicesInstance('inspectorNameSelect', choices);

        const otherInspectorInput = container.querySelector('textarea[name="inspectorNameOther"]');
        if (currentData.inspectorNames) {
            choices.setValue(currentData.inspectorNames);

            // Restore "Others" textarea if some names were manual entries
            const officialNames = INSPECTORS_LIST.filter(n => n !== 'Others');
            const manualNames = currentData.inspectorNames.filter(n => !officialNames.includes(n));
            if (manualNames.length > 0) {
                choices.setChoiceByValue('Others');
                otherInspectorInput.value = manualNames.join(', ');
                otherInspectorInput.style.display = 'block';
            }
        }
    }

    const activitySelect = container.querySelector('select[name="activityType"]');
    const conditional = container.querySelector('[name="conditional"]');

    function updateConditionalFields() {
        // Remove old choices instances if they exist
        const oldChoices = getChoicesInstance('productTypeSelect');
        if (oldChoices) {
            oldChoices.instance.destroy();
        }
        removeChoicesInstance('consultativeFacilityName');
        removeChoicesInstance('gsdpFacilityName');
        removeChoicesInstance('linkedComplaintId');
        removeChoicesInstance('linkedAlertId');
        removeChoicesInstance('advertCompanySelect');
        removeChoicesInstance('companyProductSelect');
        removeChoicesInstance('existingUnexpectedAdvertSelect');
        removeChoicesInstance('scheduledAdvertSelect');

        let conditionalHTML = '';
        const val = activitySelect.value;

        // Hide the regular Facility Name & Address row when Consultative Meeting or Advert is chosen
        // (both have their own specialized facility inputs)
        const facilityRow = container.querySelector('#regularFacilityRow');
        if (facilityRow) {
            facilityRow.style.display = (val === 'Consultative Meeting' || val === 'Advert') ? 'none' : '';
        }

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

        if (['Routine Surveillance', 'Consumer Complaint', 'Special Surveillance'].includes(val)) {
            conditionalHTML = `
                <div style="margin-top:8px">
                    <label>Main Product Type <span style="color:red">*</span></label>
                    <select name="mainProductType" required>
                        <option value="">Select Main Product Type...</option>
                        <option value="Drugs">Drugs</option>
                        <option value="Food">Food</option>
                        <option value="Cosmetics">Cosmetics</option>
                        <option value="Medical Devices">Medical Devices</option>
                        <option value="Service Drugs">Service Drugs</option>
                        <option value="Donated Items/Drugs">Donated Items/Drugs</option>
                        <option value="Orphan Drugs">Orphan Drugs</option>
                    </select>
                </div>
                <div style="margin-top:8px">
                    <label>Product Type(s) (Subtypes)</label>
                    <select name="productTypeSelect" multiple></select>
                </div>
                ${val === 'Consumer Complaint' ? `
                <div style="margin-top:12px; padding:12px; background:#f0f7ff; border:1px solid #bfdbfe; border-radius:4px;">
                    <label style="color:#1e40af; font-weight:700;">Linked Consumer Complaint Case</label>
                    <select name="linkedComplaintId">
                        <option value="">Loading complaint cases...</option>
                    </select>
                    <p class="muted small" style="margin-top:4px;">Selecting an open complaint docket links this inspection visit and advances the case to "Under Investigation".</p>
                </div>` : ''}
                ${['Routine Surveillance', 'Special Surveillance'].includes(val) ? `
                <div style="margin-top:12px; padding:12px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px;">
                    <label style="color:#065f46; font-weight:700;">Was any product on Regulatory Alert encountered?</label>
                    <select name="regulatoryAlertEncountered">
                        <option value="false">No</option>
                        <option value="true">Yes, Alerted Product Intercepted</option>
                    </select>
                    <div id="alertDropdownContainer" style="display:none; margin-top:8px;">
                        <label class="small" style="font-weight:700; color:#065f46;">Select Regulatory Alert</label>
                        <select name="linkedAlertId">
                            <option value="">Loading alerts...</option>
                        </select>
                        <div style="margin-top:6px;">
                            <label class="small" style="font-weight:700; color:#065f46;">Alert Mop-up Action / Remarks</label>
                            <input name="alertAction" placeholder="Specific action taken regarding alerted product...">
                        </div>
                    </div>
                </div>` : ''}
                ${mopUpHTML}
                ${holdHTML}
            `;
        } else if (val === 'Advert') {
            conditionalHTML = `
                <div class="card" style="background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:16px; margin-top:12px;">
                    <h4 style="margin:0 0 6px; color:#166534; font-size:15px; display:flex; align-items:center; gap:8px;">
                        <span>📢</span> Advert Monitoring & Campaign Details
                    </h4>
                    <p class="muted small" style="margin-bottom:12px; color:#14532d;">
                        Track product adverts structured by <strong>Company / Advertiser</strong> (parent) and <strong>Product Name</strong> (child), with tailored sighting details per medium.
                    </p>

                    <!-- Category & Product Line -->
                    <div class="row">
                        <div class="col">
                            <label style="font-weight:700;">Advert Category <span style="color:red">*</span></label>
                            <select name="advertCategory" id="advertCategorySelect" required>
                                <option value="Unexpected Advert" selected>Unexpected Advert (Identified during field monitoring)</option>
                                <option value="Scheduled Advert">Scheduled Advert (Pre-registered Campaign)</option>
                            </select>
                        </div>
                        <div class="col">
                            <label style="font-weight:700;">Main Product Line <span style="color:red">*</span></label>
                            <select name="mainProductType" required>
                                <option value="Drugs">Drugs</option>
                                <option value="Food">Food</option>
                                <option value="Cosmetics">Cosmetics</option>
                                <option value="Medical Devices">Medical Devices</option>
                                <option value="Herbals" selected>Herbals / Traditional</option>
                                <option value="Vaccines & Biologics">Vaccines & Biologics</option>
                                <option value="Chemicals">Chemicals</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                    </div>

                    <!-- Company (Parent) & Product (Child) Section -->
                    <div style="margin-top:14px; padding:14px; background:#ffffff; border:1px solid #bbf7d0; border-radius:6px;">
                        <h5 style="margin:0 0 8px; color:#15803d; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">
                            🏢 1. Company / Advertiser (Parent Folder)
                        </h5>
                        <div class="row">
                            <div class="col">
                                <label style="font-weight:600;">Select or Enter Company / Advertiser <span style="color:red">*</span></label>
                                <select name="advertCompanySelect" id="advertCompanySelect">
                                    <option value="__NEW_COMPANY__">➕ Enter New Company / Advertiser</option>
                                </select>
                            </div>
                        </div>
                        <div class="row" id="newCompanyRow" style="margin-top:8px;">
                            <div class="col">
                                <label class="small" style="font-weight:600; color:#166534;">New Company Name <span style="color:red">*</span></label>
                                <input name="newAdvertCompanyName" id="newAdvertCompanyNameInput" placeholder="e.g. Unilever Nigeria Plc, Emzor Pharma, Dr Wonder Enterprises">
                            </div>
                        </div>

                        <h5 style="margin:16px 0 8px; color:#15803d; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; border-top:1px dashed #dcfce7; padding-top:12px;">
                            📦 2. Product Name (Child Folder)
                        </h5>
                        <div class="row" id="existingCompanyProductRow" style="display:none;">
                            <div class="col">
                                <label style="font-weight:600;">Select Existing Product for this Company <span style="color:red">*</span></label>
                                <select name="companyProductSelect" id="companyProductSelect">
                                    <option value="__NEW_PRODUCT__">➕ Enter New Product for this Company</option>
                                </select>
                            </div>
                        </div>
                        <div class="row" id="newProductRow" style="margin-top:8px;">
                            <div class="col">
                                <label class="small" style="font-weight:600; color:#166534;">Product / Advert Name <span style="color:red">*</span></label>
                                <input name="advertName" id="advertNameInput" placeholder="e.g. Joy Beauty Bar with Honey, Dr Wonder Miracle Herbal Cure" required>
                            </div>
                        </div>
                        <div id="advertFolderHierarchyStatus" style="font-size:12px; margin-top:10px; min-height:18px;"></div>
                    </div>

                    <!-- Medium & Sighting Section -->
                    <div style="margin-top:14px; padding:14px; background:#ffffff; border:1px solid #bbf7d0; border-radius:6px;">
                        <h5 style="margin:0 0 8px; color:#15803d; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">
                            📡 3. Sighting Medium & Sighting Folder
                        </h5>
                        <div class="row">
                            <div class="col">
                                <label style="font-weight:600;">Advert Medium / Channel <span style="color:red">*</span></label>
                                <select name="advertMedium" id="advertMediumSelect" required>
                                    <option value="Social Media / Online" selected>Social Media / Online (Instagram, TikTok, FB, Web)</option>
                                    <option value="Television / Broadcast">Television / Broadcast (TV Channel)</option>
                                    <option value="Radio">Radio (Radio Station)</option>
                                    <option value="Billboard / Poster / Outdoor">Billboard / Poster / Outdoor (Location / Landmark)</option>
                                    <option value="Print / Flyer / Handbill">Print / Flyer / Handbill (Publication / Handbill)</option>
                                    <option value="In-Store / Point of Sale Display">Physical Facility / In-Store Display (Pharmacy, Supermarket, PPMV, Shop)</option>
                                    <option value="Other">Other Media / Mobile PA</option>
                                </select>
                            </div>
                        </div>

                        <!-- Dynamic Sighting Fields based on Medium -->
                        <div id="mediumSightingContainer" style="margin-top:12px;">
                            <!-- Social Media Fields -->
                            <div id="socialMediaFields" style="display:block;">
                                <div class="row">
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Platform <span style="color:red">*</span></label>
                                        <select name="advertSocialPlatform" id="advertSocialPlatform">
                                            <option value="Instagram" selected>Instagram</option>
                                            <option value="TikTok">TikTok</option>
                                            <option value="Facebook">Facebook</option>
                                            <option value="X (Twitter)">X (Twitter)</option>
                                            <option value="YouTube">YouTube</option>
                                            <option value="Website / Blog">Website / Online Store</option>
                                            <option value="LinkedIn">LinkedIn</option>
                                            <option value="Other Online">Other Online Platform</option>
                                        </select>
                                    </div>
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Handle / Account / Profile URL <span style="color:red">*</span></label>
                                        <input name="advertSocialHandle" id="advertSocialHandle" placeholder="e.g. @drwonder_cure or instagram.com/joybeauty">
                                    </div>
                                </div>
                            </div>

                            <!-- TV Fields -->
                            <div id="tvFields" style="display:none;">
                                <div class="row">
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">TV Channel / Station <span style="color:red">*</span></label>
                                        <select name="advertTvChannelSelect" id="advertTvChannelSelect">
                                            <option value="Channels TV" selected>Channels TV</option>
                                            <option value="TVC News">TVC News / TVC Entertainment</option>
                                            <option value="NTA">NTA (National / Lagos)</option>
                                            <option value="Arise News">Arise News</option>
                                            <option value="Silverbird TV">Silverbird TV (STV)</option>
                                            <option value="AIT">AIT (Africa Independent Television)</option>
                                            <option value="Soundcity TV">Soundcity TV</option>
                                            <option value="Galaxy TV">Galaxy TV</option>
                                            <option value="LTV">LTV (Lagos Television)</option>
                                            <option value="__CUSTOM_TV__">➕ Other TV Channel...</option>
                                        </select>
                                        <input name="advertCustomTvChannel" id="advertCustomTvChannel" placeholder="Specify TV Channel Name" style="display:none; margin-top:6px;">
                                    </div>
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Program / Air Time Window (Optional)</label>
                                        <input name="advertTvProgram" id="advertTvProgram" placeholder="e.g. 8:00 PM Prime News, Morning Show">
                                    </div>
                                </div>
                            </div>

                            <!-- Radio Fields -->
                            <div id="radioFields" style="display:none;">
                                <div class="row">
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Radio Station <span style="color:red">*</span></label>
                                        <select name="advertRadioStationSelect" id="advertRadioStationSelect">
                                            <option value="Wazobia 95.1 FM" selected>Wazobia 95.1 FM</option>
                                            <option value="Cool 96.9 FM">Cool 96.9 FM</option>
                                            <option value="Nigeria Info 99.3 FM">Nigeria Info 99.3 FM</option>
                                            <option value="Raypower 100.5 FM">Raypower 100.5 FM</option>
                                            <option value="The Beat 99.9 FM">The Beat 99.9 FM</option>
                                            <option value="Brila 88.9 FM">Brila 88.9 FM</option>
                                            <option value="Bond 92.9 FM">Bond 92.9 FM</option>
                                            <option value="Radio Lagos 107.5 FM">Radio Lagos 107.5 FM</option>
                                            <option value="Classic 97.3 FM">Classic 97.3 FM</option>
                                            <option value="Smooth 98.1 FM">Smooth 98.1 FM</option>
                                            <option value="Soundcity 98.5 FM">Soundcity 98.5 FM</option>
                                            <option value="__CUSTOM_RADIO__">➕ Other Radio Station...</option>
                                        </select>
                                        <input name="advertCustomRadioStation" id="advertCustomRadioStation" placeholder="Specify Radio Station Name / Frequency" style="display:none; margin-top:6px;">
                                    </div>
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Program / Time Slot (Optional)</label>
                                        <input name="advertRadioProgram" id="advertRadioProgram" placeholder="e.g. Morning Rush, Evening Drive">
                                    </div>
                                </div>
                            </div>

                            <!-- Billboard / Outdoor Fields -->
                            <div id="billboardFields" style="display:none;">
                                <div class="row">
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Billboard / Outdoor Location & Landmark <span style="color:red">*</span></label>
                                        <input name="advertBillboardLocation" id="advertBillboardLocation" placeholder="e.g. Third Mainland Bridge Inbound Gantry, Oshodi Terminal Billboard">
                                    </div>
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Signage Agency / Board ID (Optional)</label>
                                        <input name="advertBillboardAgency" id="advertBillboardAgency" placeholder="e.g. Nimbus Media, Board #LAG-042">
                                    </div>
                                </div>
                            </div>

                            <!-- Print / Flyer Fields -->
                            <div id="printFields" style="display:none;">
                                <div class="row">
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Publication Name or Flyer Distribution Point <span style="color:red">*</span></label>
                                        <input name="advertPrintPublication" id="advertPrintPublication" placeholder="e.g. The Punch Newspaper, Handbills distributed at Oshodi Market">
                                    </div>
                                </div>
                            </div>

                            <!-- In-Store Fields -->
                            <div id="inStoreFields" style="display:none;">
                                <div class="row">
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Physical Store / Outlet Name <span style="color:red">*</span></label>
                                        <input name="advertFacilityName" id="advertFacilityName" placeholder="e.g. Medplus Pharmacy, Ebeano Supermarket">
                                    </div>
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Outlet Address / Location</label>
                                        <input name="advertFacilityAddress" id="advertFacilityAddress" placeholder="e.g. 43 Shasha Rd, Akowonjo, Lagos">
                                    </div>
                                </div>
                            </div>

                            <!-- Other Media Fields -->
                            <div id="otherMediaFields" style="display:none;">
                                <div class="row">
                                    <div class="col">
                                        <label class="small" style="font-weight:600;">Medium Description / Sighting Details <span style="color:red">*</span></label>
                                        <input name="advertOtherMediumDetails" id="advertOtherMediumDetails" placeholder="e.g. Mobile Public Address Van at Agege Market, WhatsApp Broadcast">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Sighting Folder Indicator -->
                        <div id="sightingFolderIndicator" style="margin-top:12px; font-size:12px; color:#0369a1; font-weight:600; padding:8px 12px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:4px; display:flex; align-items:center; gap:6px;">
                            <span>📁</span> Sighting folder created in SharePoint: <span id="sightingFolderDisplay" style="color:#0c4a6e; font-family:monospace; font-weight:700;">Instagram_@handle</span>
                        </div>
                    </div>
                </div>
            `;
        } else if (['GLSI', 'RASFF', 'COLD CHAIN Monitoring'].includes(val)) {
            conditionalHTML = `${mopUpHTML}${holdHTML}`;
        } else if (val === 'Consultative Meeting') {
            conditionalHTML = `
                <div class="row">
                    <div class="col">
                        <label>Activity Category</label>
                        <select name="consultativeMeetingCategory">
                            <option value="">Select activity category...</option>
                            <option value="Routine Surveillance">Routine Surveillance</option>
                            <option value="GLSI">GLSI</option>
                            <option value="Consumer Complaint">Consumer Complaint</option>
                            <option value="Advert">Advert</option>
                            <option value="GSDP">GSDP</option>
                            <option value="Monitoring">Monitoring of Service Drugs, Orphan Drugs & Donated Items</option>
                        </select>
                    </div>
                    <div class="col" id="consultativeSubCategoryContainer" style="display: none;">
                        <label>Main Product Type</label>
                        <select name="consultativeProductType"></select>
                    </div>
                </div>
                <div class="row" style="margin-top:12px">
                    <div class="col">
                        <label>Facility Name</label>
                        <select name="consultativeFacilityName"><option value="">Select category first...</option></select>
                        <p class="muted small" id="facilityLoadingMsg" style="display:none;">Loading facilities...</p>
                    </div>
                    <div class="col">
                        <label>Facility Address</label>
                        <input name="consultativeFacilityAddress" placeholder="Auto-filled when facility is selected..." readonly style="background:#f0f0f0;">
                    </div>
                </div>
                <div id="addNewFacilitySection" style="display:none; background: #f8f9fa; padding: 12px; border-radius: 8px; margin-top: 8px;">
                    <label style="font-size: 14px; font-weight: 600; margin-bottom: 8px; display:block;">Add New Facility</label>
                    <div class="row">
                        <div class="col"><label class="small">Facility Name</label><input name="newConsultativeFacilityName" placeholder="Enter facility name..."></div>
                        <div class="col"><label class="small">Facility Address</label><input name="newConsultativeFacilityAddress" placeholder="Enter facility address..."></div>
                    </div>
                </div>
                <div class="row" style="margin-top:12px">
                    <div class="col"><label>Sanction given?</label><select name="sanctionGiven"><option value="false">No</option><option value="true">Yes</option></select></div>
                    <div class="col" id="sanctionDocContainer" style="display: none;"><label>Sanction doc (if any)</label><div><input type="file" name="sanctionDoc" accept="application/pdf,image/*"></div></div>
                </div>
            `;
        } else if (val === 'GSDP') {
            conditionalHTML = `
                <div class="row" style="margin-top:8px">
                    <div class="col">
                        <label>GSDP Sub-Activity</label>
                        <select name="gsdpSubActivity">
                            <option value="GDP">GDP (Initial Inspection)</option>
                            <option value="CEVI">CEVI (Compliance Evaluation)</option>
                        </select>
                    </div>
                    <div class="col">
                        <label>Risk Categorization</label>
                        <select name="riskCategory" id="gsdpRiskCategory">
                            <option value="Category A (Low)">Category A (Low Risk)</option>
                            <option value="Category B (Medium)" selected>Category B (Medium Risk)</option>
                            <option value="Category C (High)">Category C (High Risk)</option>
                            <option value="Pending Classification">Pending / Under Evaluation</option>
                        </select>
                    </div>
                </div>
                <div id="ceviFacilitySection" style="display:none;">
                    <div class="row" style="margin-top:12px">
                        <div class="col">
                            <label>Facility Name</label>
                            <select name="gsdpFacilityName"><option value="">Select facility...</option></select>
                            <p class="muted small" id="gsdpFacilityLoadingMsg" style="display:none;">Loading facilities...</p>
                        </div>
                        <div class="col">
                            <label>Facility Address</label>
                            <input name="gsdpFacilityAddress" placeholder="Auto-filled when facility is selected..." readonly style="background:#f0f0f0;">
                        </div>
                    </div>
                </div>
                <div id="addNewGsdpFacilitySection" style="display:none; background: #f8f9fa; padding: 12px; border-radius: 8px; margin-top: 8px;">
                    <label style="font-size: 14px; font-weight: 600; margin-bottom: 8px; display:block;">Add New Facility</label>
                    <div class="row">
                        <div class="col"><label class="small">Facility Name</label><input name="newGsdpFacilityName" placeholder="Enter exact facility name..."></div>
                        <div class="col"><label class="small">Facility Address</label><input name="newGsdpFacilityAddress" placeholder="Enter facility address..."></div>
                    </div>
                </div>
                <div style="margin-top:8px"><label>Company Email (M.D / Superintendent Pharmacist)</label><input name="companyEmail" type="email" placeholder="Must be M.D or Superintendent Pharmacist email" required></div>`;
        } else if (val === 'Laboratory Analysis') {
            conditionalHTML = `<div style="margin-top:8px"><label>How many samples taken?</label><input name="Samplescount" type="number" min="0" value="0"></div>`;
        }

        conditional.innerHTML = conditionalHTML;

        const productSelect = conditional.querySelector('select[name="productTypeSelect"]');
        if (productSelect) {
            productSelect.innerHTML = PRODUCT_TYPES.map(pt => `<option value="${pt}">${pt}</option>`).join('');
            const choices = new Choices(productSelect, { removeItemButton: true, placeholder: true, placeholderValue: 'Select Subtypes...' });
            addChoicesInstance('productTypeSelect', choices);
            if (currentData.productTypes) {
                choices.setValue(currentData.productTypes);
            }
        }

        const mainProductSelect = conditional.querySelector('select[name="mainProductType"]');
        if (mainProductSelect && currentData.mainProductType) {
            mainProductSelect.value = currentData.mainProductType;
        }

        // ─── Field Linking: Consumer Complaint Dropdown ───────────────────
        const complaintSelect = conditional.querySelector('select[name="linkedComplaintId"]');
        if (complaintSelect) {
            getDocs(query(collection(db, 'complaints'))).then(snap => {
                const oldChoices = getChoicesInstance('linkedComplaintId');
                if (oldChoices) oldChoices.instance.destroy();

                const cases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                cases.sort((a, b) => (a.status === 'Open' ? -1 : 1));
                complaintSelect.innerHTML = '<option value="">-- Standalone / Unlinked Complaint --</option>' +
                    cases.map(c => {
                        const ref = c.referenceCode || 'REF';
                        const prod = (c.product || c.caseInfo || 'Unspecified').substring(0, 45);
                        const comp = c.complainantName ? ` (${c.complainantName})` : '';
                        const st = c.status || 'Open';
                        return `<option value="${escapeHTML(c.id)}">[${escapeHTML(ref)}] ${escapeHTML(prod)}${escapeHTML(comp)} [${escapeHTML(st)}]</option>`;
                    }).join('');

                const choices = new Choices(complaintSelect, {
                    removeItemButton: false,
                    placeholder: true,
                    placeholderValue: 'Search complaints by code, product, complainant...',
                    searchEnabled: true,
                    itemSelectText: '',
                    shouldSort: false
                });
                addChoicesInstance('linkedComplaintId', choices);

                if (currentData.linkedComplaintId) {
                    choices.setChoiceByValue(currentData.linkedComplaintId);
                }
            }).catch(e => {
                console.warn("Could not load complaints:", e);
                complaintSelect.innerHTML = '<option value="">-- Standalone Complaint --</option>';
            });
        }

        // ─── Field Linking: Regulatory Alerts in Routine / Special Surveillance ─────
        const alertEncounteredSelect = conditional.querySelector('select[name="regulatoryAlertEncountered"]');
        const alertDropdownContainer = conditional.querySelector('#alertDropdownContainer');
        const alertSelect = conditional.querySelector('select[name="linkedAlertId"]');
        const alertActionInput = conditional.querySelector('input[name="alertAction"]');

        if (alertEncounteredSelect && alertDropdownContainer) {
            async function initAlertChoices() {
                if (!alertSelect) return;
                const existing = getChoicesInstance('linkedAlertId');
                if (existing) return;

                try {
                    const snap = await getDocs(query(collection(db, 'alerts')));
                    const alerts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    alerts.sort((a, b) => (a.status === 'Active' ? -1 : 1));

                    alertSelect.innerHTML = '<option value="">Select Regulatory Alert...</option>' +
                        alerts.map(a => {
                            const no = a.alertNo || 'ALT';
                            const title = (a.title || 'Untitled Alert').substring(0, 50);
                            const src = a.source ? ` (${a.source})` : '';
                            const st = a.status ? ` [${a.status}]` : '';
                            return `<option value="${escapeHTML(a.id)}">[${escapeHTML(no)}] ${escapeHTML(title)}${escapeHTML(src)}${escapeHTML(st)}</option>`;
                        }).join('');

                    const choices = new Choices(alertSelect, {
                        removeItemButton: false,
                        placeholder: true,
                        placeholderValue: 'Search regulatory alert by title, number, source...',
                        searchEnabled: true,
                        itemSelectText: '',
                        shouldSort: false
                    });
                    addChoicesInstance('linkedAlertId', choices);

                    if (currentData.linkedAlertId) {
                        choices.setChoiceByValue(currentData.linkedAlertId);
                    }
                } catch (e) {
                    console.warn("Could not load alerts:", e);
                    alertSelect.innerHTML = '<option value="">No alerts loaded</option>';
                }
            }

            alertEncounteredSelect.addEventListener('change', () => {
                const isYes = alertEncounteredSelect.value === 'true';
                alertDropdownContainer.style.display = isYes ? 'block' : 'none';
                if (isYes) {
                    initAlertChoices();
                }
            });

            if (currentData.regulatoryAlertEncountered === 'true') {
                alertEncounteredSelect.value = 'true';
                alertDropdownContainer.style.display = 'block';
                initAlertChoices().then(() => {
                    if (currentData.linkedAlertId) {
                        const c = getChoicesInstance('linkedAlertId');
                        if (c) c.instance.setChoiceByValue(currentData.linkedAlertId);
                    }
                });
                if (alertActionInput && currentData.alertAction) {
                    alertActionInput.value = currentData.alertAction;
                }
            }
        }

        // ─── Advert Monitoring Event Bindings (Company -> Product -> Medium & Sighting) ───
        const advertCategorySelect = conditional.querySelector('#advertCategorySelect');
        const advertCompanySelect = conditional.querySelector('#advertCompanySelect');
        const newCompanyRow = conditional.querySelector('#newCompanyRow');
        const newAdvertCompanyNameInput = conditional.querySelector('#newAdvertCompanyNameInput');
        const existingCompanyProductRow = conditional.querySelector('#existingCompanyProductRow');
        const companyProductSelect = conditional.querySelector('#companyProductSelect');
        const newProductRow = conditional.querySelector('#newProductRow');
        const advertNameInput = conditional.querySelector('#advertNameInput');
        const advertFolderHierarchyStatus = conditional.querySelector('#advertFolderHierarchyStatus');

        const advertMediumSelect = conditional.querySelector('#advertMediumSelect');
        const socialMediaFields = conditional.querySelector('#socialMediaFields');
        const tvFields = conditional.querySelector('#tvFields');
        const radioFields = conditional.querySelector('#radioFields');
        const billboardFields = conditional.querySelector('#billboardFields');
        const printFields = conditional.querySelector('#printFields');
        const inStoreFields = conditional.querySelector('#inStoreFields');
        const otherMediaFields = conditional.querySelector('#otherMediaFields');

        const advertSocialPlatform = conditional.querySelector('#advertSocialPlatform');
        const advertSocialHandle = conditional.querySelector('#advertSocialHandle');
        const advertTvChannelSelect = conditional.querySelector('#advertTvChannelSelect');
        const advertCustomTvChannel = conditional.querySelector('#advertCustomTvChannel');
        const advertTvProgram = conditional.querySelector('#advertTvProgram');
        const advertRadioStationSelect = conditional.querySelector('#advertRadioStationSelect');
        const advertCustomRadioStation = conditional.querySelector('#advertCustomRadioStation');
        const advertRadioProgram = conditional.querySelector('#advertRadioProgram');
        const advertBillboardLocation = conditional.querySelector('#advertBillboardLocation');
        const advertBillboardAgency = conditional.querySelector('#advertBillboardAgency');
        const advertPrintPublication = conditional.querySelector('#advertPrintPublication');
        const advertFacilityName = conditional.querySelector('#advertFacilityName');
        const advertFacilityAddress = conditional.querySelector('#advertFacilityAddress');
        const advertOtherMediumDetails = conditional.querySelector('#advertOtherMediumDetails');
        const sightingFolderDisplay = conditional.querySelector('#sightingFolderDisplay');

        if (advertCategorySelect && advertCompanySelect) {
            container.dataset.advertFolderExists = "false";
            container.dataset.isSubsequentRound = "false";
            container.dataset.activityRound = "";

            let advertCompaniesMap = new Map(); // companyName -> Set of productNames
            let advertProductRoundsMap = new Map(); // `${companyName}|||${productName}` -> roundCount

            async function loadAdvertDatabase() {
                advertCompaniesMap = new Map();
                advertProductRoundsMap = new Map();

                try {
                    // 1. Fetch from facilityReports where activityType == 'Advert'
                    const repSnap = await getDocs(query(collection(db, 'facilityReports'), where('activityType', '==', 'Advert')));
                    repSnap.forEach(d => {
                        const data = d.data();
                        const comp = (data.advertCompany || data.companyName || data.advertiser || '').trim();
                        const prod = (data.advertName || '').trim();
                        if (comp) {
                            if (!advertCompaniesMap.has(comp)) advertCompaniesMap.set(comp, new Set());
                            if (prod) advertCompaniesMap.get(comp).add(prod);
                        }
                        if (comp && prod) {
                            const key = `${comp.toLowerCase()}|||${prod.toLowerCase()}`;
                            advertProductRoundsMap.set(key, (advertProductRoundsMap.get(key) || 0) + 1);
                        }
                    });
                } catch (err) {
                    console.warn("Could not load advert reports from facilityReports:", err);
                }

                // 2. Also check adverts collection if accessible
                try {
                    const advSnap = await getDocs(collection(db, 'adverts'));
                    advSnap.forEach(d => {
                        const data = d.data();
                        const comp = (data.advertCompany || data.advertiser || '').trim();
                        const prod = (data.advertName || '').trim();
                        if (comp) {
                            if (!advertCompaniesMap.has(comp)) advertCompaniesMap.set(comp, new Set());
                            if (prod) advertCompaniesMap.get(comp).add(prod);
                        }
                    });
                } catch (err) {
                    // Suppressed if adverts collection is not permitted
                }

                // Populate Company Dropdown
                removeChoicesInstance('advertCompanySelect');
                const sortedCompanies = Array.from(advertCompaniesMap.keys()).sort((a, b) => a.localeCompare(b));
                advertCompanySelect.innerHTML = '<option value="__NEW_COMPANY__">➕ Enter New Company / Advertiser</option>' +
                    sortedCompanies.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)} (${advertCompaniesMap.get(c).size} products in DB)</option>`).join('');

                const compChoices = new Choices(advertCompanySelect, {
                    removeItemButton: false,
                    placeholder: true,
                    placeholderValue: 'Search or select company / advertiser...',
                    searchEnabled: true,
                    itemSelectText: '',
                    shouldSort: false
                });
                addChoicesInstance('advertCompanySelect', compChoices);

                // Rehydrate if previously selected
                let initialCompany = null;
                let initialProduct = null;
                if (wizardState.currentAdvert && wizardState.currentAdvert.advertCompany) {
                    initialCompany = wizardState.currentAdvert.advertCompany;
                    initialProduct = wizardState.currentAdvert.advertName;
                } else if (currentData.advertCompany) {
                    initialCompany = currentData.advertCompany;
                    initialProduct = currentData.advertName;
                }

                if (initialCompany && sortedCompanies.includes(initialCompany)) {
                    compChoices.setChoiceByValue(initialCompany);
                    handleCompanyChange(initialCompany, initialProduct);
                } else if (initialCompany) {
                    compChoices.setChoiceByValue('__NEW_COMPANY__');
                    if (newAdvertCompanyNameInput) newAdvertCompanyNameInput.value = initialCompany;
                    if (advertNameInput && initialProduct) advertNameInput.value = initialProduct;
                    handleCompanyChange('__NEW_COMPANY__', initialProduct);
                } else {
                    compChoices.setChoiceByValue('__NEW_COMPANY__');
                    handleCompanyChange('__NEW_COMPANY__', null);
                }
            }

            function handleCompanyChange(selectedComp, targetProduct = null) {
                if (!selectedComp || selectedComp === '__NEW_COMPANY__') {
                    if (newCompanyRow) newCompanyRow.style.display = 'block';
                    if (existingCompanyProductRow) existingCompanyProductRow.style.display = 'none';
                    if (newProductRow) newProductRow.style.display = 'block';
                    if (advertNameInput) {
                        advertNameInput.readOnly = false;
                        if (!targetProduct) advertNameInput.value = '';
                    }
                    updateFolderHierarchyStatus('__NEW_COMPANY__', targetProduct || '', false);
                } else {
                    if (newCompanyRow) newCompanyRow.style.display = 'none';
                    if (existingCompanyProductRow) existingCompanyProductRow.style.display = 'block';

                    const products = Array.from(advertCompaniesMap.get(selectedComp) || []).sort();
                    removeChoicesInstance('companyProductSelect');
                    companyProductSelect.innerHTML = `<option value="__NEW_PRODUCT__">➕ Enter New Product for ${escapeHTML(selectedComp)}</option>` +
                        products.map(p => `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join('');

                    const prodChoices = new Choices(companyProductSelect, {
                        removeItemButton: false,
                        placeholder: true,
                        placeholderValue: `Search products for ${selectedComp}...`,
                        searchEnabled: true,
                        itemSelectText: '',
                        shouldSort: false
                    });
                    addChoicesInstance('companyProductSelect', prodChoices);

                    if (targetProduct && products.includes(targetProduct)) {
                        prodChoices.setChoiceByValue(targetProduct);
                        handleProductChange(selectedComp, targetProduct);
                    } else if (targetProduct) {
                        prodChoices.setChoiceByValue('__NEW_PRODUCT__');
                        handleProductChange(selectedComp, '__NEW_PRODUCT__', targetProduct);
                    } else if (products.length > 0) {
                        prodChoices.setChoiceByValue(products[0]);
                        handleProductChange(selectedComp, products[0]);
                    } else {
                        prodChoices.setChoiceByValue('__NEW_PRODUCT__');
                        handleProductChange(selectedComp, '__NEW_PRODUCT__');
                    }
                }
            }

            function handleProductChange(selectedComp, selectedProd, customProdName = null) {
                if (selectedProd === '__NEW_PRODUCT__' || !selectedProd) {
                    if (newProductRow) newProductRow.style.display = 'block';
                    if (advertNameInput) {
                        advertNameInput.readOnly = false;
                        advertNameInput.value = customProdName || '';
                        advertNameInput.placeholder = `New Product Name for ${selectedComp}`;
                    }
                    updateFolderHierarchyStatus(selectedComp, customProdName || '', false);
                } else {
                    if (newProductRow) newProductRow.style.display = 'block';
                    if (advertNameInput) {
                        advertNameInput.value = selectedProd;
                        advertNameInput.readOnly = true;
                    }
                    updateFolderHierarchyStatus(selectedComp, selectedProd, true);
                }
            }

            function updateFolderHierarchyStatus(comp, prod, existsInDb) {
                const isScheduled = advertCategorySelect.value === 'Scheduled Advert';
                const effectiveComp = (comp && comp !== '__NEW_COMPANY__')
                    ? comp
                    : (newAdvertCompanyNameInput?.value.trim() || '[Company Name]');
                const effectiveProd = (prod && prod !== '__NEW_PRODUCT__')
                    ? prod
                    : (advertNameInput?.value.trim() || '[Product Name]');

                if (isScheduled) {
                    const key = `${effectiveComp.toLowerCase()}|||${effectiveProd.toLowerCase()}`;
                    const roundCount = advertProductRoundsMap.get(key) || 0;
                    if (roundCount === 0 || !existsInDb) {
                        container.dataset.advertFolderExists = "false";
                        container.dataset.isSubsequentRound = "false";
                        container.dataset.activityRound = "";
                        advertFolderHierarchyStatus.innerHTML = `<span style="color:#16a34a;font-weight:600;">★ First Scheduled Monitoring Activity — will scaffold: ADVERTS/[Product Line]/2026/[Month]/${escapeHTML(effectiveComp)}/${escapeHTML(effectiveProd)}/</span>`;
                    } else {
                        const nextRound = roundCount + 1;
                        const dateStr = container.querySelector('input[name="inspectionDate"]')?.value || new Date().toISOString().split('T')[0];
                        const roundName = `Round_${nextRound}_${dateStr}`;
                        container.dataset.advertFolderExists = "true";
                        container.dataset.isSubsequentRound = "true";
                        container.dataset.activityRound = roundName;
                        advertFolderHierarchyStatus.innerHTML = `<span style="color:#2563eb;font-weight:600;">🔄 Subsequent Monitoring Activity Round #${nextRound} — will scaffold: ADVERTS/[Product Line]/2026/[Month]/${escapeHTML(effectiveComp)}/${escapeHTML(effectiveProd)}/${roundName}/</span>`;
                    }
                } else {
                    // Unexpected Advert
                    if (existsInDb) {
                        container.dataset.advertFolderExists = "true";
                        container.dataset.isSubsequentRound = "false";
                        container.dataset.activityRound = "";
                        advertFolderHierarchyStatus.innerHTML = `<span style="color:#0284c7;font-weight:600;">ℹ️ Product exists in database — will link sighting under: ADVERTS/[Product Line]/2026/[Month]/Unexpected Adverts/${escapeHTML(effectiveComp)}/${escapeHTML(effectiveProd)}/Facilities/</span>`;
                    } else {
                        container.dataset.advertFolderExists = "false";
                        container.dataset.isSubsequentRound = "false";
                        container.dataset.activityRound = "";
                        advertFolderHierarchyStatus.innerHTML = `<span style="color:#16a34a;font-weight:600;">✨ New Advert — will scaffold: ADVERTS/[Product Line]/2026/[Month]/Unexpected Adverts/${escapeHTML(effectiveComp)}/${escapeHTML(effectiveProd)}/</span>`;
                    }
                }
            }

            function onCompanySelectionEvent() {
                const compChoices = getChoicesInstance('advertCompanySelect');
                const val = compChoices ? compChoices.instance.getValue(true) : advertCompanySelect.value;
                handleCompanyChange(val);
            }

            advertCompanySelect.addEventListener('change', onCompanySelectionEvent);
            advertCompanySelect.addEventListener('addItem', onCompanySelectionEvent);

            function onProductSelectionEvent() {
                const compChoices = getChoicesInstance('advertCompanySelect');
                const compVal = compChoices ? compChoices.instance.getValue(true) : '';
                const prodChoices = getChoicesInstance('companyProductSelect');
                const prodVal = prodChoices ? prodChoices.instance.getValue(true) : companyProductSelect.value;
                handleProductChange(compVal, prodVal);
            }

            if (companyProductSelect) {
                companyProductSelect.addEventListener('change', onProductSelectionEvent);
                companyProductSelect.addEventListener('addItem', onProductSelectionEvent);
            }

            if (newAdvertCompanyNameInput) {
                newAdvertCompanyNameInput.addEventListener('input', () => {
                    updateFolderHierarchyStatus('__NEW_COMPANY__', advertNameInput?.value.trim() || '', false);
                });
            }

            if (advertNameInput) {
                advertNameInput.addEventListener('input', () => {
                    const compChoices = getChoicesInstance('advertCompanySelect');
                    const compVal = compChoices ? compChoices.instance.getValue(true) : '';
                    updateFolderHierarchyStatus(compVal, advertNameInput.value.trim(), false);
                });
            }

            advertCategorySelect.addEventListener('change', () => {
                const compChoices = getChoicesInstance('advertCompanySelect');
                const compVal = compChoices ? compChoices.instance.getValue(true) : '';
                const prodChoices = getChoicesInstance('companyProductSelect');
                const prodVal = prodChoices ? prodChoices.instance.getValue(true) : '';
                const isExistingProd = prodVal && prodVal !== '__NEW_PRODUCT__';
                updateFolderHierarchyStatus(compVal, isExistingProd ? prodVal : (advertNameInput?.value.trim() || ''), isExistingProd);
            });

            // ─── Medium & Sighting Field Toggles ─────────────────────────────
            function updateMediumFields() {
                const med = advertMediumSelect.value;
                if (socialMediaFields) socialMediaFields.style.display = (med === 'Social Media / Online') ? 'block' : 'none';
                if (tvFields) tvFields.style.display = (med === 'Television / Broadcast') ? 'block' : 'none';
                if (radioFields) radioFields.style.display = (med === 'Radio') ? 'block' : 'none';
                if (billboardFields) billboardFields.style.display = (med === 'Billboard / Poster / Outdoor') ? 'block' : 'none';
                if (printFields) printFields.style.display = (med === 'Print / Flyer / Handbill') ? 'block' : 'none';
                if (inStoreFields) inStoreFields.style.display = (med === 'In-Store / Point of Sale Display') ? 'block' : 'none';
                if (otherMediaFields) otherMediaFields.style.display = (med === 'Other') ? 'block' : 'none';
                updateSightingPreview();
            }

            function updateSightingPreview() {
                if (!sightingFolderDisplay) return;
                const med = advertMediumSelect.value;
                let folderName = '';
                if (med === 'Social Media / Online') {
                    const p = advertSocialPlatform ? advertSocialPlatform.value : 'Social';
                    const h = (advertSocialHandle?.value || '').trim() || '@handle';
                    folderName = `${p}_${h.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_')}`;
                } else if (med === 'Television / Broadcast') {
                    const ch = (advertTvChannelSelect?.value === '__CUSTOM_TV__')
                        ? (advertCustomTvChannel?.value.trim() || 'Custom_TV')
                        : (advertTvChannelSelect?.value || 'Channels_TV');
                    folderName = ch.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_');
                } else if (med === 'Radio') {
                    const st = (advertRadioStationSelect?.value === '__CUSTOM_RADIO__')
                        ? (advertCustomRadioStation?.value.trim() || 'Custom_Radio')
                        : (advertRadioStationSelect?.value || 'Radio_Station');
                    folderName = st.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_');
                } else if (med === 'Billboard / Poster / Outdoor') {
                    const loc = (advertBillboardLocation?.value || '').trim() || 'Billboard_Location';
                    folderName = loc.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').substring(0, 45);
                } else if (med === 'Print / Flyer / Handbill') {
                    const pub = (advertPrintPublication?.value || '').trim() || 'Publication_Name';
                    folderName = pub.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').substring(0, 45);
                } else if (med === 'In-Store / Point of Sale Display') {
                    const store = (advertFacilityName?.value || '').trim() || 'Store_Outlet';
                    folderName = store.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').substring(0, 45);
                } else {
                    const det = (advertOtherMediumDetails?.value || '').trim() || 'Other_Channel';
                    folderName = det.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').substring(0, 45);
                }
                sightingFolderDisplay.textContent = folderName;
            }

            advertMediumSelect.addEventListener('change', updateMediumFields);

            if (advertTvChannelSelect) {
                advertTvChannelSelect.addEventListener('change', () => {
                    if (advertCustomTvChannel) {
                        advertCustomTvChannel.style.display = (advertTvChannelSelect.value === '__CUSTOM_TV__') ? 'block' : 'none';
                    }
                    updateSightingPreview();
                });
            }

            if (advertRadioStationSelect) {
                advertRadioStationSelect.addEventListener('change', () => {
                    if (advertCustomRadioStation) {
                        advertCustomRadioStation.style.display = (advertRadioStationSelect.value === '__CUSTOM_RADIO__') ? 'block' : 'none';
                    }
                    updateSightingPreview();
                });
            }

            // Bind input listeners for live sighting folder indicator
            [
                advertSocialPlatform, advertSocialHandle, advertCustomTvChannel,
                advertCustomRadioStation, advertBillboardLocation, advertPrintPublication,
                advertFacilityName, advertOtherMediumDetails
            ].forEach(inputEl => {
                if (inputEl) {
                    inputEl.addEventListener('input', updateSightingPreview);
                    inputEl.addEventListener('change', updateSightingPreview);
                }
            });

            // Initialize medium fields & advert database
            if (currentData.advertMedium) {
                advertMediumSelect.value = currentData.advertMedium;
            }
            updateMediumFields();
            loadAdvertDatabase();

            // Rehydrate saved sighting fields if available
            if (currentData.advertPlatform && advertSocialPlatform) advertSocialPlatform.value = currentData.advertPlatform;
            if (currentData.advertHandle && advertSocialHandle) advertSocialHandle.value = currentData.advertHandle;
            if (currentData.advertChannel && advertTvChannelSelect) advertTvChannelSelect.value = currentData.advertChannel;
            if (currentData.advertRadioStation && advertRadioStationSelect) advertRadioStationSelect.value = currentData.advertRadioStation;
            if (currentData.advertBillboardLocation && advertBillboardLocation) advertBillboardLocation.value = currentData.advertBillboardLocation;
            if (currentData.advertPrintPublication && advertPrintPublication) advertPrintPublication.value = currentData.advertPrintPublication;
            if (currentData.facilityName && advertFacilityName) advertFacilityName.value = currentData.facilityName;
            if (currentData.facilityAddress && advertFacilityAddress) advertFacilityAddress.value = currentData.facilityAddress;
            updateSightingPreview();
        }

        const categorySelect = conditional.querySelector('[name="consultativeMeetingCategory"]');
        if (categorySelect) {
            const subCategoryContainer = conditional.querySelector('#consultativeSubCategoryContainer');
            const subCategorySelect = conditional.querySelector('[name="consultativeProductType"]');
            const consultativeFacilitySelect = conditional.querySelector('[name="consultativeFacilityName"]');
            const facilityLoadingMsg = conditional.querySelector('#facilityLoadingMsg');
            const surveillanceProducts = ["Drugs", "Food", "Medical Devices", "Cosmetics", "Vaccines & Biologics", "Herbals"];
            const complaintProducts = ["Food", "Drugs", "Medical Devices", "Herbals"];

            // Destroy old Choices instance for facility dropdown if exists
            const oldFacilityChoices = getChoicesInstance('consultativeFacilityName');
            if (oldFacilityChoices) oldFacilityChoices.instance.destroy();

            const addressInput = conditional.querySelector('input[name="consultativeFacilityAddress"]');
            const addNewSection = conditional.querySelector('#addNewFacilitySection');

            categorySelect.addEventListener('change', async () => {
                const selectedCategory = categorySelect.value;

                // Handle product type sub-dropdown
                if (selectedCategory && ['Routine Surveillance', 'Special Surveillance', 'Consumer Complaint', 'Advert'].includes(selectedCategory)) {
                    let options = [];
                    if (selectedCategory === 'Routine Surveillance' || selectedCategory === 'Special Surveillance') options = surveillanceProducts;
                    else if (selectedCategory === 'Consumer Complaint') options = complaintProducts;
                    else if (selectedCategory === 'Advert') options = MAIN_PRODUCT_TYPES;

                    subCategorySelect.innerHTML = options.map(p => `<option value="${p}">${p}</option>`).join('');
                    subCategoryContainer.style.display = 'block';
                } else {
                    subCategoryContainer.style.display = 'none';
                }

                // Reset address + add-new section
                if (addressInput) { addressInput.value = ''; addressInput.readOnly = true; addressInput.style.background = '#f0f0f0'; }
                if (addNewSection) addNewSection.style.display = 'none';

                // Load facilities for the selected category
                if (selectedCategory) {
                    facilityLoadingMsg.style.display = 'block';
                    const oldChoices = getChoicesInstance('consultativeFacilityName');
                    if (oldChoices) oldChoices.instance.destroy();

                    const facilityNames = await loadFacilitiesForCategory(selectedCategory, true);

                    consultativeFacilitySelect.innerHTML = '<option value="">Select facility...</option>' +
                        facilityNames.map(f => `<option value="${f}">${f}</option>`).join('') +
                        '<option value="__ADD_NEW__">➕ Add new facility…</option>';

                    const choices = new Choices(consultativeFacilitySelect, {
                        removeItemButton: false,
                        placeholder: true,
                        placeholderValue: 'Search facility...',
                        searchEnabled: true
                    });
                    addChoicesInstance('consultativeFacilityName', choices);

                    // Restore saved value if available
                    if (currentData.consultativeFacilityName) {
                        choices.setChoiceByValue(currentData.consultativeFacilityName);
                    }

                    facilityLoadingMsg.style.display = 'none';
                } else {
                    consultativeFacilitySelect.innerHTML = '<option value="">Select category first...</option>';
                }
            });

            // Auto-populate address when facility is selected, or show add-new section
            consultativeFacilitySelect.addEventListener('change', () => {
                const selectedName = consultativeFacilitySelect.value;

                if (selectedName === '__ADD_NEW__') {
                    // Show manual entry fields
                    if (addNewSection) addNewSection.style.display = 'block';
                    if (addressInput) { addressInput.value = ''; addressInput.readOnly = false; addressInput.style.background = ''; }
                } else {
                    // Hide manual entry fields
                    if (addNewSection) addNewSection.style.display = 'none';

                    // Auto-populate address from cache
                    const category = categorySelect.value;
                    const details = facilityDetailCache[category] || [];
                    const match = details.find(d => d.name === selectedName);
                    if (addressInput) {
                        addressInput.value = match ? match.address : '';
                        addressInput.readOnly = true;
                        addressInput.style.background = '#f0f0f0';
                    }
                }
            });
        }

        const gsdpFacilitySelect = conditional.querySelector('[name="gsdpFacilityName"]');
        const gsdpSubActivitySelect = conditional.querySelector('[name="gsdpSubActivity"]');
        const ceviFacilitySection = conditional.querySelector('#ceviFacilitySection');

        if (gsdpSubActivitySelect && ceviFacilitySection && facilityRow) {
            gsdpSubActivitySelect.addEventListener('change', () => {
                if (gsdpSubActivitySelect.value === 'CEVI') {
                    facilityRow.style.display = 'none';
                    ceviFacilitySection.style.display = 'block';
                } else {
                    facilityRow.style.display = '';
                    ceviFacilitySection.style.display = 'none';
                }
            });
            // Don't trigger change instantly here because currentData might set it later. By default GDP shows regular input.
        }

        if (gsdpFacilitySelect) {
            const addressInput = conditional.querySelector('input[name="gsdpFacilityAddress"]');
            const addNewSection = conditional.querySelector('#addNewGsdpFacilitySection');
            const loadingMsg = conditional.querySelector('#gsdpFacilityLoadingMsg');

            loadingMsg.style.display = 'block';
            loadFacilitiesForCategory('GSDP', true).then(facilityNames => {
                const oldChoices = getChoicesInstance('gsdpFacilityName');
                if (oldChoices) oldChoices.instance.destroy();

                gsdpFacilitySelect.innerHTML = '<option value="">Select facility...</option>' +
                    facilityNames.map(f => `<option value="${f}">${f}</option>`).join('') +
                    '<option value="__ADD_NEW__">➕ Add new facility…</option>';

                const choices = new Choices(gsdpFacilitySelect, {
                    removeItemButton: false,
                    placeholder: true,
                    placeholderValue: 'Search existing GSDP facility...',
                    searchEnabled: true
                });
                addChoicesInstance('gsdpFacilityName', choices);

                if (currentData.gsdpFacilityName) {
                    choices.setChoiceByValue(currentData.gsdpFacilityName);
                }
                loadingMsg.style.display = 'none';
            });

            gsdpFacilitySelect.addEventListener('change', () => {
                const selectedName = gsdpFacilitySelect.value;
                if (selectedName === '__ADD_NEW__') {
                    if (addNewSection) addNewSection.style.display = 'block';
                    if (addressInput) { addressInput.value = ''; addressInput.readOnly = false; addressInput.style.background = ''; }
                } else {
                    if (addNewSection) addNewSection.style.display = 'none';
                    const details = facilityDetailCache['GSDP'] || [];
                    const match = details.find(d => d.name === selectedName);
                    if (addressInput) {
                        addressInput.value = match ? match.address : '';
                        addressInput.readOnly = true;
                        addressInput.style.background = '#f0f0f0';
                    }
                }
            });
        }

        const sanctionSelect = conditional.querySelector('select[name="sanctionGiven"]');
        if (sanctionSelect) {
            const sanctionDocContainer = conditional.querySelector('#sanctionDocContainer');
            sanctionSelect.addEventListener('change', () => {
                sanctionDocContainer.style.display = sanctionSelect.value === 'true' ? 'block' : 'none';
            });
        }

        const mopUpSelect = conditional.querySelector('select[name="mopUp"]');
        if (mopUpSelect) {
            const mopUpDetails = conditional.querySelector('[name="mopUpDetailsContainer"]');
            mopUpSelect.addEventListener('change', () => {
                mopUpDetails.style.display = mopUpSelect.value === 'true' ? 'block' : 'none';
            });
        }

        const holdSelect = conditional.querySelector('select[name="hold"]');
        if (holdSelect) {
            const holdDetails = conditional.querySelector('[name="holdDetailsContainer"]');
            holdSelect.addEventListener('change', () => {
                holdDetails.style.display = holdSelect.value === 'true' ? 'block' : 'none';
            });
        }

        Object.keys(currentData).forEach(key => {
            const el = conditional.querySelector(`[name="${key}"]`);
            if (el) {
                el.value = currentData[key];
                el.dispatchEvent(new Event('change'));
            }
        });

        // Trigger gsdp sub activity after possible rehydration to ensure UI is in correct state
        if (gsdpSubActivitySelect) {
            gsdpSubActivitySelect.dispatchEvent(new Event('change'));
        }
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
        renderWizardStep(root);
    };

    document.getElementById('nextBtn').onclick = () => {
        if (!saveCurrentFacilityData()) return;

        if (currentIndex + 1 < wizardState.facilityCount) {
            wizardState.currentFacilityIndex++;
            renderWizardStep(root);
        } else {
            handleSubmitWizard(root);
        }
    };
}

function saveCurrentFacilityData() {
    const container = document.getElementById('facilityFormContainer');
    const data = {};

    // Check for facility name: use the consultative meeting dropdown if present, otherwise the regular input
    const consultativeFacilitySelect = container.querySelector('select[name="consultativeFacilityName"]');
    const gsdpFacilitySelect = container.querySelector('select[name="gsdpFacilityName"]');
    const facilityNameInput = container.querySelector('input[name="facilityName"]');
    const newFacNameInput = container.querySelector('input[name="newConsultativeFacilityName"]');
    const newGsdpFacNameInput = container.querySelector('input[name="newGsdpFacilityName"]');

    const isConsultative = consultativeFacilitySelect != null;
    const isCevi = gsdpFacilitySelect != null && container.querySelector('#ceviFacilitySection') && container.querySelector('#ceviFacilitySection').style.display !== 'none';

    const isAdvert = container.querySelector('#advertCategorySelect') != null;
    const advertFacNameInput = container.querySelector('input[name="advertFacilityName"]');

    if (isConsultative) {
        // Consultative Meeting mode
        const isAddNew = consultativeFacilitySelect.value === '__ADD_NEW__';
        if (isAddNew) {
            // Validate manual entry fields
            if (!newFacNameInput || !newFacNameInput.value.trim()) {
                alert('Please enter a facility name.');
                if (newFacNameInput) newFacNameInput.focus();
                return false;
            }
        } else if (!consultativeFacilitySelect.value) {
            alert('Please select a facility from the dropdown.');
            return false;
        }
    } else if (isCevi) {
        // CEVI mode
        const isAddNew = gsdpFacilitySelect.value === '__ADD_NEW__';
        if (isAddNew) {
            if (!newGsdpFacNameInput || !newGsdpFacNameInput.value.trim()) {
                alert('Please enter a facility name.');
                if (newGsdpFacNameInput) newGsdpFacNameInput.focus();
                return false;
            }
        } else if (!gsdpFacilitySelect.value) {
            alert('Please select a facility from the dropdown.');
            return false;
        }
    } else if (isAdvert) {
        // Validation handled in advert-specific section below
    } else if (facilityNameInput && !facilityNameInput.value.trim()) {
        alert('Facility Name is required.');
        facilityNameInput.focus();
        return false;
    }

    if (wizardState.sameInspectorsForAll === false) {
        const choicesItem = getChoicesInstance('inspectorNameSelect');
        const selected = choicesItem ? choicesItem.instance.getValue(true).filter(name => name !== 'Others') : [];
        const otherText = container.querySelector('textarea[name="inspectorNameOther"]').value.trim();
        const fromOther = otherText ? otherText.split(',').map(n => n.trim()).filter(Boolean) : [];
        // Use Set to deduplicate
        data.inspectorNames = [...new Set([...selected, ...fromOther])];
        if (data.inspectorNames.length === 0) { alert('Please select at least one inspector for this facility.'); return false; }
    }

    const productChoicesItem = getChoicesInstance('productTypeSelect');
    data.productTypes = productChoicesItem ? productChoicesItem.instance.getValue(true) : [];

    const mainProductSelect = container.querySelector('select[name="mainProductType"]');
    data.mainProductType = mainProductSelect ? mainProductSelect.value : null;

    const fields = [
        'inspectionDate', 'area', 'facilityName', 'facilityAddress', 'activityType', 'actionTaken',
        'sanctionGiven', 'gsdpSubActivity', 'riskCategory', 'companyEmail', 'Samplescount', 'consultativeMeetingCategory', 'consultativeProductType',
        'mopUp', 'mopUpDrugs', 'mopUpCosmetics', 'mopUpMedicalDevices', 'mopUpFood',
        'hold', 'holdDrugs', 'holdCosmetics', 'holdMedicalDevices', 'holdFood',
        'linkedComplaintId', 'regulatoryAlertEncountered', 'linkedAlertId', 'alertAction'
    ];

    fields.forEach(fieldName => {
        const el = container.querySelector(`[name="${fieldName}"]`);
        if (el) {
            data[fieldName] = el.value;
        }
    });

    const complaintChoices = getChoicesInstance('linkedComplaintId');
    if (complaintChoices && complaintChoices.instance) {
        data.linkedComplaintId = complaintChoices.instance.getValue(true) || null;
    }

    if (data.regulatoryAlertEncountered === 'true') {
        const alertChoices = getChoicesInstance('linkedAlertId');
        if (alertChoices && alertChoices.instance) {
            data.linkedAlertId = alertChoices.instance.getValue(true) || null;
        }
    } else {
        data.linkedAlertId = null;
        data.alertAction = '';
    }

    // Override facilityName and facilityAddress from consultative meeting fields
    // (must be AFTER fields.forEach so it doesn't get overwritten by the hidden regular inputs)
    if (isConsultative) {
        data.isNewFacility = (consultativeFacilitySelect.value === '__ADD_NEW__');
        if (consultativeFacilitySelect.value === '__ADD_NEW__') {
            // Use manually entered name + address
            data.facilityName = newFacNameInput ? newFacNameInput.value.trim() : '';
            const newAddrInput = container.querySelector('input[name="newConsultativeFacilityAddress"]');
            data.facilityAddress = newAddrInput ? newAddrInput.value.trim() : '';
        } else if (consultativeFacilitySelect.value) {
            data.facilityName = consultativeFacilitySelect.value;
            const addrInput = container.querySelector('input[name="consultativeFacilityAddress"]');
            data.facilityAddress = addrInput ? addrInput.value.trim() : '';
        }
        data.consultativeFacilityName = consultativeFacilitySelect.value;
    } else if (isCevi) {
        if (gsdpFacilitySelect.value === '__ADD_NEW__') {
            data.facilityName = newGsdpFacNameInput ? newGsdpFacNameInput.value.trim() : '';
            const newAddrInput = container.querySelector('input[name="newGsdpFacilityAddress"]');
            data.facilityAddress = newAddrInput ? newAddrInput.value.trim() : '';
        } else if (gsdpFacilitySelect.value) {
            data.facilityName = gsdpFacilitySelect.value;
            const addrInput = container.querySelector('input[name="gsdpFacilityAddress"]');
            data.facilityAddress = addrInput ? addrInput.value.trim() : '';
        }
        data.gsdpFacilityName = gsdpFacilitySelect.value;
    }

    // Advert-specific data handling
    if (data.activityType === 'Advert') {
        const catSelect = container.querySelector('#advertCategorySelect');
        data.advertCategory = catSelect ? catSelect.value : 'Unexpected Advert';

        // 1. Company / Advertiser
        const compSelect = container.querySelector('#advertCompanySelect');
        const compChoices = getChoicesInstance('advertCompanySelect');
        const compVal = compChoices ? compChoices.instance.getValue(true) : (compSelect ? compSelect.value : '');
        if (compVal === '__NEW_COMPANY__' || !compVal) {
            const newCompInput = container.querySelector('#newAdvertCompanyNameInput');
            data.advertCompany = newCompInput ? newCompInput.value.trim() : '';
        } else {
            data.advertCompany = compVal.trim();
        }

        // 2. Product Name
        const prodSelect = container.querySelector('#companyProductSelect');
        const prodChoices = getChoicesInstance('companyProductSelect');
        const prodVal = prodChoices ? prodChoices.instance.getValue(true) : (prodSelect ? prodSelect.value : '');
        if (compVal === '__NEW_COMPANY__' || prodVal === '__NEW_PRODUCT__' || !prodVal) {
            const nameInput = container.querySelector('#advertNameInput');
            data.advertName = nameInput ? nameInput.value.trim() : '';
        } else {
            data.advertName = prodVal.trim();
        }

        if (!data.advertCompany) {
            alert('Please specify the Company / Advertiser Name.');
            const newCompInput = container.querySelector('#newAdvertCompanyNameInput');
            if (newCompInput) newCompInput.focus();
            return false;
        }

        if (!data.advertName) {
            alert('Please specify the Advert / Product Name.');
            const nameInput = container.querySelector('#advertNameInput');
            if (nameInput) nameInput.focus();
            return false;
        }

        // 3. Medium & Sighting
        const medSelect = container.querySelector('#advertMediumSelect');
        data.advertMedium = medSelect ? medSelect.value : 'Social Media / Online';

        let sightingFolder = '';
        let sightingLabel = '';
        let sightingAddress = '';

        if (data.advertMedium === 'Social Media / Online') {
            const platform = container.querySelector('#advertSocialPlatform')?.value || 'Social Media';
            const handle = container.querySelector('#advertSocialHandle')?.value.trim() || '';
            if (!handle) {
                alert('Please enter the Social Media Handle or Profile URL.');
                const hEl = container.querySelector('#advertSocialHandle');
                if (hEl) hEl.focus();
                return false;
            }
            data.advertPlatform = platform;
            data.advertHandle = handle;
            sightingFolder = `${platform}_${handle.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').trim()}`;
            sightingLabel = `${platform}: ${handle}`;
            sightingAddress = handle;
        } else if (data.advertMedium === 'Television / Broadcast') {
            let channel = container.querySelector('#advertTvChannelSelect')?.value || 'TV';
            if (channel === '__CUSTOM_TV__') {
                channel = container.querySelector('#advertCustomTvChannel')?.value.trim() || '';
                if (!channel) {
                    alert('Please specify the TV Channel Name.');
                    container.querySelector('#advertCustomTvChannel')?.focus();
                    return false;
                }
            }
            const program = container.querySelector('#advertTvProgram')?.value.trim() || '';
            data.advertChannel = channel;
            data.advertTvProgram = program;
            sightingFolder = channel.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').trim();
            sightingLabel = channel;
            sightingAddress = program ? `Program: ${program}` : channel;
        } else if (data.advertMedium === 'Radio') {
            let station = container.querySelector('#advertRadioStationSelect')?.value || 'Radio';
            if (station === '__CUSTOM_RADIO__') {
                station = container.querySelector('#advertCustomRadioStation')?.value.trim() || '';
                if (!station) {
                    alert('Please specify the Radio Station Name / Frequency.');
                    container.querySelector('#advertCustomRadioStation')?.focus();
                    return false;
                }
            }
            const program = container.querySelector('#advertRadioProgram')?.value.trim() || '';
            data.advertRadioStation = station;
            data.advertRadioProgram = program;
            sightingFolder = station.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').trim();
            sightingLabel = station;
            sightingAddress = program ? `Program: ${program}` : station;
        } else if (data.advertMedium === 'Billboard / Poster / Outdoor') {
            const loc = container.querySelector('#advertBillboardLocation')?.value.trim() || '';
            if (!loc) {
                alert('Please enter the Billboard / Outdoor Location & Landmark.');
                container.querySelector('#advertBillboardLocation')?.focus();
                return false;
            }
            const agency = container.querySelector('#advertBillboardAgency')?.value.trim() || '';
            data.advertBillboardLocation = loc;
            data.advertBillboardAgency = agency;
            sightingFolder = loc.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').trim().substring(0, 45);
            sightingLabel = `Billboard: ${loc}`;
            sightingAddress = agency ? `${loc} (${agency})` : loc;
        } else if (data.advertMedium === 'Print / Flyer / Handbill') {
            const pub = container.querySelector('#advertPrintPublication')?.value.trim() || '';
            if (!pub) {
                alert('Please enter the Publication Name or Flyer Distribution Point.');
                container.querySelector('#advertPrintPublication')?.focus();
                return false;
            }
            data.advertPrintPublication = pub;
            sightingFolder = pub.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').trim().substring(0, 45);
            sightingLabel = `Print: ${pub}`;
            sightingAddress = pub;
        } else if (data.advertMedium === 'In-Store / Point of Sale Display') {
            const storeName = container.querySelector('#advertFacilityName')?.value.trim() || '';
            if (!storeName) {
                alert('Please enter the Physical Store / Outlet Name where the advert was displayed.');
                container.querySelector('#advertFacilityName')?.focus();
                return false;
            }
            const storeAddr = container.querySelector('#advertFacilityAddress')?.value.trim() || '';
            data.facilityName = storeName;
            data.facilityAddress = storeAddr;
            sightingFolder = storeName.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').trim().substring(0, 45);
            sightingLabel = storeName;
            sightingAddress = storeAddr;
        } else {
            const details = container.querySelector('#advertOtherMediumDetails')?.value.trim() || 'Other Medium';
            sightingFolder = details.replace(/[@\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').trim().substring(0, 45);
            sightingLabel = details;
            sightingAddress = details;
        }

        data.sightingFolder = sightingFolder;
        data.facilityName = sightingLabel;
        data.facilityAddress = sightingAddress;
        data.advertFolderExists = container.dataset.advertFolderExists === "true";
        data.isSubsequentRound = container.dataset.isSubsequentRound === "true";
        data.advertActivityRound = container.dataset.activityRound || '';

        // Remember advert for subsequent facilities in this multi-facility wizard session
        wizardState.currentAdvert = {
            advertCategory: data.advertCategory,
            advertCompany: data.advertCompany,
            advertName: data.advertName,
            advertMedium: data.advertMedium,
            advertFolderExists: true,
            isSubsequentRound: data.isSubsequentRound,
            advertActivityRound: data.advertActivityRound
        };
    }

    data.mopUpCount = (parseInt(data.mopUpDrugs) || 0) + (parseInt(data.mopUpCosmetics) || 0) + (parseInt(data.mopUpMedicalDevices) || 0) + (parseInt(data.mopUpFood) || 0);
    data.holdCount = (parseInt(data.holdDrugs) || 0) + (parseInt(data.holdCosmetics) || 0) + (parseInt(data.holdMedicalDevices) || 0) + (parseInt(data.holdFood) || 0);

    wizardState.facilities[wizardState.currentFacilityIndex] = data;
    return true;
}

async function handleSubmitWizard(root) {
    const submitButton = document.querySelector('#nextBtn');
    submitButton.textContent = "Submitting...";
    submitButton.disabled = true;
    const submissionId = 'sub_' + Date.now();

    try {
        const promises = wizardState.facilities.map(async (facilityData) => {
            const finalInspectorNames = wizardState.sameInspectorsForAll ? wizardState.sharedInspectorNames : facilityData.inspectorNames;

            const sanctionFileEl = document.querySelector(`input[name="sanctionDoc"]`);
            let sanctionDocUrl = '';
            if (facilityData.sanctionGiven === 'true' && sanctionFileEl && sanctionFileEl.files[0]) {
                const uploaded = await uploadToCloudinary(sanctionFileEl.files[0]);
                sanctionDocUrl = uploaded.secure_url || '';
            }

            const cleanFacName = (facilityData.facilityName || '').trim().replace(/[."*:<>?\/\\|]/g, '').replace(/\.+$/, '').trim();
            const reportData = {
                submissionId,
                lookupKey: `${cleanFacName}_${facilityData.activityType}`,
                inspectorNames: finalInspectorNames,
                mainProductType: facilityData.mainProductType || null,
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
                    drugs: parseInt(facilityData.holdCounts?.drugs || facilityData.holdDrugs || 0),
                    cosmetics: parseInt(facilityData.holdCounts?.cosmetics || facilityData.holdCosmetics || 0),
                    medicalDevices: parseInt(facilityData.holdCounts?.medicalDevices || facilityData.holdMedicalDevices || 0),
                    food: parseInt(facilityData.holdCounts?.food || facilityData.holdFood || 0)
                },
                gsdpSubActivity: facilityData.gsdpSubActivity || '',
                riskCategory: facilityData.riskCategory || '',
                companyEmail: facilityData.companyEmail || '',
                Samples: parseInt(facilityData.Samplescount || 0) > 0,
                Samplescount: parseInt(facilityData.Samplescount || 0),
                consultativeMeetingCategory: facilityData.consultativeMeetingCategory || '',
                consultativeProductType: facilityData.consultativeProductType || '',
                isNewFacility: facilityData.isNewFacility || (facilityData.consultativeFacilityName === '__ADD_NEW__'),
                linkedComplaintId: facilityData.linkedComplaintId || null,
                regulatoryAlertEncountered: facilityData.regulatoryAlertEncountered === 'true',
                linkedAlertId: facilityData.linkedAlertId || null,
                alertAction: facilityData.alertAction || '',
                advertCategory: facilityData.advertCategory || '',
                advertCompany: facilityData.advertCompany || '',
                advertName: facilityData.advertName || '',
                advertMedium: facilityData.advertMedium || '',
                advertPlatform: facilityData.advertPlatform || '',
                advertHandle: facilityData.advertHandle || '',
                advertChannel: facilityData.advertChannel || '',
                advertTvProgram: facilityData.advertTvProgram || '',
                advertRadioStation: facilityData.advertRadioStation || '',
                advertRadioProgram: facilityData.advertRadioProgram || '',
                advertBillboardLocation: facilityData.advertBillboardLocation || '',
                advertBillboardAgency: facilityData.advertBillboardAgency || '',
                advertPrintPublication: facilityData.advertPrintPublication || '',
                sightingFolder: facilityData.sightingFolder || '',
                advertFolderExists: facilityData.advertFolderExists ?? false,
                isSubsequentRound: facilityData.isSubsequentRound ?? false,
                advertActivityRound: facilityData.advertActivityRound || '',
                createdBy: currentUser.uid,
                createdAt: serverTimestamp()
            };

            // Add to Firestore
            await addDoc(collection(db, 'facilityReports'), reportData);

            // Sync with Advert dockets collection
            if (reportData.activityType === 'Advert' && reportData.advertName) {
                try {
                    const cleanAdvName = reportData.advertName.trim();
                    const advQ = query(collection(db, 'adverts'), where('advertName', '==', cleanAdvName));
                    const advSnap = await getDocs(advQ);
                    const formattedDateStr = reportData.inspectionDate ? new Date(reportData.inspectionDate).toISOString() : new Date().toISOString();
                    const advYear = (reportData.inspectionDate ? new Date(reportData.inspectionDate).getFullYear() : new Date().getFullYear()).toString();

                    if (advSnap.empty) {
                        await addDoc(collection(db, 'adverts'), {
                            advertName: cleanAdvName,
                            category: (reportData.advertCategory || '').includes('Schedul') ? 'Scheduled' : 'Unexpected',
                            advertiser: reportData.advertCompany || facilityData.newScheduledAdvertiser || '',
                            advertCompany: reportData.advertCompany || '',
                            mainProductType: reportData.mainProductType || '',
                            medium: reportData.advertMedium || '',
                            year: advYear,
                            firstMonitoredDate: formattedDateStr,
                            lastMonitoredDate: formattedDateStr,
                            monitoringCount: 1,
                            status: 'Active',
                            createdAt: serverTimestamp()
                        });
                    } else {
                        const advDoc = advSnap.docs[0];
                        const currentCount = parseInt(advDoc.data().monitoringCount || 1, 10);
                        await setDoc(advDoc.ref, {
                            lastMonitoredDate: formattedDateStr,
                            monitoringCount: currentCount + 1,
                            advertCompany: reportData.advertCompany || advDoc.data().advertCompany || ''
                        }, { merge: true });
                    }
                } catch (advErr) {
                    console.warn("Could not sync advert docket record:", advErr);
                }
            }

            // Advance linked complaint docket status to "Under Investigation"
            if (reportData.linkedComplaintId) {
                try {
                    await setDoc(doc(db, 'complaints', reportData.linkedComplaintId), {
                        status: 'Under Investigation',
                        lastInspectionDate: new Date().toISOString()
                    }, { merge: true });
                } catch (err) {
                    console.warn('Could not update linked complaint:', err);
                }
            }

            // Update regulatory alert status to "Under Investigation" if alerted product intercepted
            if (reportData.linkedAlertId) {
                try {
                    await setDoc(doc(db, 'alerts', reportData.linkedAlertId), {
                        status: 'Under Investigation',
                        lastVisitDate: new Date().toISOString()
                    }, { merge: true });
                } catch (err) {
                    console.warn('Could not update linked alert:', err);
                }
            }

            // Sync with master facilities database
            try {
                const facName = (reportData.facilityName || "").trim();
                if (facName) {
                    const resolved = await resolveFacility(
                        facName,
                        reportData.facilityAddress,
                        "wizard",
                        reportData.activityType
                    );
                    // Link the report to the found/created record ID
                    reportData.facilityId = resolved.facilityId;
                    reportData.facilityDocId = resolved.docId; // Keep docId for reference if needed
                }
            } catch (facErr) {
                console.error("Error syncing with facility database:", facErr);
            }

            // Trigger Teams Webhook for activities that need folder creation
            const folderActivities = [
                'Routine Surveillance',
                'Special Surveillance',
                'Advert',
                'Consumer Complaint',
                'GSDP',
                'GLSI',
                'COLD CHAIN Monitoring'
            ];
            const isNewConsultativeFacility = reportData.activityType === 'Consultative Meeting' && reportData.isNewFacility;
            if (folderActivities.includes(reportData.activityType) || isNewConsultativeFacility) {
                await triggerTeamsWebhook(reportData);
            }

            // Trigger dedicated Consultative Meeting webhook
            // This updates the SharePoint list with meeting-specific inspectors
            // so the approval chain uses the RIGHT people (not the original inspection team)
            if (reportData.activityType === 'Consultative Meeting') {
                await triggerConsultativeMeetingWebhook(reportData);
            }
        });

        await Promise.all(promises);
        await addDoc(collection(db, 'submissions'), { id: submissionId, createdBy: currentUser.uid, createdAt: serverTimestamp(), count: wizardState.facilityCount });
        navigate('success');
    } catch (error) {
        console.error("Error submitting reports:", error);
        alert("Failed to submit reports. Please try again.");
        submitButton.textContent = 'Submit All Reports';
        submitButton.disabled = false;
    }
}

export function getReportDateObj(rawDate) {
    if (!rawDate) return new Date();
    if (rawDate instanceof Date && !isNaN(rawDate.getTime())) return rawDate;
    if (typeof rawDate.toDate === 'function') return rawDate.toDate();
    if (typeof rawDate === 'object' && (rawDate.seconds || rawDate._seconds)) {
        return new Date((rawDate.seconds || rawDate._seconds) * 1000);
    }
    if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
        const [y, m, d] = rawDate.trim().split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const parsed = new Date(rawDate);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function triggerTeamsWebhook(report) {
    try {
        // Fetch URL from settings
        const settingsRef = doc(db, 'settings', 'kpiTargets');
        const settingsSnap = await getDoc(settingsRef);

        if (!settingsSnap.exists()) return;

        const webhookUrl = settingsSnap.data().webhookUrl;
        if (!webhookUrl) return;

        // Extract Year and Month from inspectionDate safely
        const dateObj = getReportDateObj(report.inspectionDate);
        const year = dateObj.getFullYear().toString();
        const month = dateObj.toLocaleString('default', { month: 'long' }).toUpperCase();

        // Generate unique Report ID
        const timestamp = Date.now();
        const activityCode = getActivityCode(report.activityType);
        const reportId = `${activityCode}-${year}-${timestamp}`;

        // Calculate deadline (2 days from now)
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 2);
        deadline.setHours(23, 59, 59, 0);

        // Determine folder routing based on activity and product type
        const folderConfig = getFolderConfig(report);

        // Sanitize facility name for SharePoint (remove trailing periods/spaces and invalid chars)
        const sanitizedFacilityName = report.facilityName
            .trim()
            .replace(/[."*:<>?\/\\|]/g, '') // Remove invalid SharePoint characters
            .replace(/\.+$/, '')  // Remove trailing periods
            .trim();

        const formattedDate = (dateObj && !isNaN(dateObj.getTime()))
            ? dateObj.toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];
        const cleanRemarks = (report.actionTaken || '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'");

        const isAdvert = report.activityType === 'Advert';
        // For Advert, Power Automate Step 6 creates the entity folder inside the month folder using facilityName
        // In Option A, this is 'Unexpected Adverts/[Advert Name]' or '[Advert Name]'
        const flowFacilityName = (isAdvert && folderConfig.entityFolderName)
            ? folderConfig.entityFolderName
            : sanitizedFacilityName;

        // Prepare enhanced payload
        const payload = {
            reportId: reportId,
            lookupKey: `${sanitizedFacilityName}_${report.activityType}`, // UNIQUE KEY FOR FLOW LOOKUP
            facilityName: flowFacilityName,
            actualFacilityName: sanitizedFacilityName,
            advertFacilityName: sanitizedFacilityName,
            area: report.area || '',
            inspectionDate: formattedDate,
            inspectors: Array.isArray(report.inspectorNames) ? report.inspectorNames.join(', ') : (report.inspectorName || ''),
            activity: report.activityType,
            activityType: report.activityType,
            year: year,
            month: month,
            productType: folderConfig.productType || null,
            rootFolder: folderConfig.rootFolder,
            subfolders: folderConfig.subfolders,
            deadline: deadline.toISOString(),
            remarks: isAdvert
                ? `[Company: ${report.advertCompany || folderConfig.advertCompany || ''}] [Product: ${folderConfig.advertName || report.advertName}] [Medium: ${report.advertMedium || ''}] ${cleanRemarks}`.trim()
                : cleanRemarks,
            actionTaken: cleanRemarks,
            gsdpSubActivity: report.gsdpSubActivity || null,
            riskCategory: report.riskCategory || null,
            companyEmail: report.companyEmail || null,
            advertCompany: report.advertCompany || folderConfig.advertCompany || null,
            advertName: report.advertName || folderConfig.advertName || null,
            advertCategory: report.advertCategory || folderConfig.advertCategory || null,
            advertMedium: report.advertMedium || null,
            advertPlatform: report.advertPlatform || null,
            advertHandle: report.advertHandle || null,
            advertChannel: report.advertChannel || null,
            advertTvProgram: report.advertTvProgram || null,
            advertRadioStation: report.advertRadioStation || null,
            advertRadioProgram: report.advertRadioProgram || null,
            advertBillboardLocation: report.advertBillboardLocation || null,
            advertBillboardAgency: report.advertBillboardAgency || null,
            advertPrintPublication: report.advertPrintPublication || null,
            sightingFolder: report.sightingFolder || null,
            advertFolderExists: folderConfig.advertFolderExists ?? null,
            isSubsequentRound: folderConfig.isSubsequentRound ?? null,
            activityRound: folderConfig.activityRound || null,
            facilityFolder: folderConfig.facilityFolder || null
        };

        // Fire and forget
        fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(err => console.error("Webhook trigger failed:", err));

    } catch (error) {
        console.error("Error in triggerTeamsWebhook:", error);
    }
}

// ─── Consultative Meeting Webhook ────────────────────────────────────────────
// Fires when a Consultative Meeting is logged in the wizard.
// Sends meeting-specific inspectors to Power Automate so it can update the
// SharePoint facility list — SEPARATE from the original inspection team.
// Power Automate Flow A:  receives this → updates MeetingInspectors column on the SharePoint list row
// Power Automate Flow B:  triggered by file upload to Consultative_Meeting subfolder →
//                         reads MeetingInspectors from SharePoint → starts approval chain → Mada
async function triggerConsultativeMeetingWebhook(report) {
    try {
        const settingsRef = doc(db, 'settings', 'kpiTargets');
        const settingsSnap = await getDoc(settingsRef);
        if (!settingsSnap.exists()) return;

        // Use a dedicated webhook URL for consultative meeting flow
        // Falls back to the main webhook URL if not separately configured
        const webhookUrl = settingsSnap.data().consultativeMeetingWebhookUrl
            || settingsSnap.data().webhookUrl;
        if (!webhookUrl) return;

        const dateObj = new Date(report.inspectionDate);
        const meetingDate = dateObj.toISOString().split('T')[0];
        const year = dateObj.getFullYear().toString();
        const month = dateObj.toLocaleString('default', { month: 'long' }).toUpperCase();

        // Sanitize facility name exactly as done for folder creation
        const sanitizedFacilityName = (report.facilityName || '')
            .trim()
            .replace(/[."*:<>?/\\|]/g, '')
            .replace(/\.+$/, '')
            .trim();

        const rawInspectors = Array.isArray(report.inspectorNames)
            ? report.inspectorNames
            : [report.inspectorNames];
        const inspectors = rawInspectors.map(n => (n || '').trim()).filter(n => n.length > 0);
        if (inspectors.length === 0 && report.inspectorName) {
            inspectors.push(report.inspectorName.trim());
        }

        // Build a temporary report object to get the correct root folder
        // based on the consultative category (e.g., RS → /ROUTINE SURVEILLANCE/DRUGS)
        const folderReport = {
            activityType: report.consultativeMeetingCategory || 'Routine Surveillance',
            mainProductType: report.consultativeProductType || null,
            productTypes: report.consultativeProductType ? [report.consultativeProductType] : []
        };
        const folderConfig = getFolderConfig(folderReport);

        // Generate report ID for folder naming
        const timestamp = Date.now();
        const activityCode = getActivityCode('Consultative Meeting');
        const reportId = `${activityCode}-${year}-${timestamp}`;

        // Consultative meetings only get this subfolder
        const cmSubfolders = ['Consultative_Meeting'];

        const cleanRemarks = (report.actionTaken || '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'");

        const payload = {
            // PA uses this to identify the activity type (matches the field name in the other webhook)
            activity: 'Consultative Meeting',
            activityType: 'Consultative Meeting',
            lookupKey: `${sanitizedFacilityName}_Consultative Meeting`, // UNIQUE KEY FOR FLOW LOOKUP

            // Facility info — used to find the right SharePoint list row
            facilityName: sanitizedFacilityName,
            area: report.area || '',
            year,
            month,
            meetingDate,

            // Meeting-specific attendees — stored in SharePoint MeetingInspectors column
            // PA Flow B reads this when the Consultative_Meeting file is uploaded
            meetingInspectors: inspectors.join(', '),          // comma string for SharePoint column
            meetingInspectorsArray: inspectors,                 // array for adaptive card loop
            meetingInspectorCount: inspectors.length,

            // Additional context for the approval card
            remarks: cleanRemarks,
            actionTaken: cleanRemarks,
            consultativeMeetingCategory: report.consultativeMeetingCategory || '',
            consultativeCategory: report.consultativeMeetingCategory || '', // used by PA to know which SP path
            consultativeProductType: report.consultativeProductType || '',
            productType: report.consultativeProductType || folderConfig.productType || null,

            // Folder creation info — used by Flow A when facility doesn't exist in SharePoint
            reportId,
            rootFolder: folderConfig.rootFolder,
            subfolders: cmSubfolders,
            inspectors: inspectors.join(', '),
            inspectionDate: meetingDate,

            // Deadline: 3 working days from meeting date
            deadline: (() => {
                const d = new Date(dateObj);
                d.setDate(d.getDate() + 3);
                d.setHours(23, 59, 59, 0);
                return d.toISOString();
            })()
        };

        fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(err => console.error("Consultative meeting webhook failed:", err));

    } catch (error) {
        console.error("Error in triggerConsultativeMeetingWebhook:", error);
    }
}

// Helper: Get activity code for Report ID
function getActivityCode(activity) {
    const codes = {
        'Routine Surveillance': 'RS',
        'Special Surveillance': 'SS',
        'Consumer Complaint': 'CC',
        'GSDP': 'GSDP',
        'GLSI': 'GLSI',
        'COLD CHAIN Monitoring': 'CCM',
        'Consultative Meeting': 'CM',
        'Laboratory Analysis': 'LA',
        'RASFF': 'RASFF',
        'Survey': 'SRV'
    };
    return codes[activity] || 'OTH';
}

// Helper: Get product type folder name for Advert
function getAdvertProductTypeFolder(mainProductType) {
    if (!mainProductType) return 'DRUGS';
    const lower = mainProductType.toLowerCase();
    if (lower.includes('food') || lower.includes('drink') || lower.includes('water')) return 'FOOD';
    if (lower.includes('cosmetic')) return 'COSMETICS';
    if (lower.includes('device')) return 'MEDICAL DEVICES';
    if (lower.includes('chemical')) return 'CHEMICALS';
    return 'DRUGS';
}

// Helper: Get folder configuration based on activity type
function getFolderConfig(report) {
    const activity = report.activityType;
    const mainProductType = report.mainProductType;
    const productTypes = report.productTypes || [];

    // Check if this is Service/Donated/Orphan drugs
    const specialDrugs = ['Service Drugs', 'Donated Items/Drugs', 'Orphan Drugs'];
    const isSpecial = mainProductType && specialDrugs.includes(mainProductType);

    switch (activity) {
        case 'Routine Surveillance': {
            const dateObj = getReportDateObj(report.inspectionDate);
            const year = dateObj.getFullYear().toString();
            if (isSpecial) {
                return {
                    rootFolder: `/DONATED DRUGS, SERVICE DRUGS AND ORPHAN DRUGS/${year}`,
                    productType: mainProductType,
                    subfolders: ['Surveillance_Report', 'Consultative_Meeting', 'Extra_Data']
                };
            }

            let root = '/ROUTINE SURVEILLANCE/DRUGS';
            if (mainProductType === 'Medical Devices') {
                root = '/MEDICAL DEVICES/ROUTINE SURVEILLANCE FOR MEDICAL DEVICES';
            } else if (mainProductType) {
                root = `/ROUTINE SURVEILLANCE/${mainProductType.toUpperCase()}`;
            }
            return {
                rootFolder: root,
                productType: mainProductType || 'Drugs',
                subfolders: ['Surveillance_Report', 'Consultative_Meeting', 'Extra_Data']
            };
        }

        case 'Special Surveillance':
            return {
                rootFolder: mainProductType ? `/Special Surveillance/${mainProductType.toUpperCase()}` : '/Special Surveillance',
                productType: mainProductType || null,
                subfolders: ['Surveillance_Report', 'Consultative_Meeting', 'Extra_Data']
            };

        case 'Consumer Complaint':
            return {
                rootFolder: '/CONSUMER COMPLAINT',
                productType: productTypes.join(', ') || null,
                subfolders: ['Inspection_Report', 'Consultative_Meeting', 'Investigation_Data']
            };

        case 'GSDP': {
            const dateObj = getReportDateObj(report.inspectionDate);
            const year = dateObj.getFullYear().toString();
            const root = `/GSDP (GOOD STORAGE AND DISTRIBUTION PRACTICE)/GSDP COMPANY FILES/${year}`;
            const risk = String(report.riskCategory || '').toLowerCase();
            const isLowRisk = risk.includes('low') || risk.includes('category a') || risk === 'a';

            if (isLowRisk) {
                return {
                    rootFolder: root,
                    productType: null,
                    riskCategory: 'Category A (Low)',
                    subfolders: [
                        'Company_Files',
                        'GSDP/Inspection_Report',
                        'GSDP/Risk_Categorization'
                    ]
                };
            }

            return {
                rootFolder: root,
                productType: null,
                riskCategory: report.riskCategory || 'Category B (Medium)',
                subfolders: [
                    'Company_Files',
                    'GSDP/Inspection_Report',
                    'GSDP/Compliance_Directives',
                    'GSDP/CAPA_Template',
                    'GSDP/Risk_Categorization',
                    'CEVI/Inspection_Report',
                    'CEVI/Compliance_Directives',
                    'CEVI/CAPA_Template',
                    'CEVI/Risk_Categorization'
                ]
            };
        }

        case 'GLSI':
            return {
                rootFolder: '/GLSI MONITORING',
                productType: null,
                subfolders: ['Inspection_Report', 'Consultative_Meeting', 'Inspection_Data']
            };

        case 'COLD CHAIN Monitoring':
            return {
                rootFolder: '/COLD-CHAIN-MONITORING',
                productType: null,
                subfolders: ['Inspection_Report', 'Consultative_Meeting', 'Inspection_Field_Data']
            };

        case 'Advert': {
            const advDateObj = getReportDateObj(report.inspectionDate);
            const year = advDateObj.getFullYear().toString();
            const prodType = getAdvertProductTypeFolder(report.mainProductType);
            const cleanCompany = (report.advertCompany || 'GENERAL_COMPANY')
                .trim()
                .replace(/[."*:<>?\/\\|]/g, '')
                .replace(/\.+$/, '')
                .trim();
            const cleanAdvert = (report.advertName || 'GENERAL_ADVERT')
                .trim()
                .replace(/[."*:<>?\/\\|]/g, '')
                .replace(/\.+$/, '')
                .trim();
            const cleanSighting = (report.sightingFolder || report.facilityName || 'OUTLET')
                .trim()
                .replace(/[."*:<>?\/\\|]/g, '')
                .replace(/\.+$/, '')
                .trim();
            const dateStr = `${advDateObj.getFullYear()}-${String(advDateObj.getMonth() + 1).padStart(2, '0')}-${String(advDateObj.getDate()).padStart(2, '0')}`;

            const facilitySubPath = `Facilities/${dateStr}_${cleanSighting}`;
            const isUnexpected = String(report.advertCategory || '').toLowerCase().includes('unexpect');
            const advertFolderExists = !!report.advertFolderExists;
            const isSubsequentRound = !!report.isSubsequentRound;

            // rootFolder MUST be /ADVERTS/${prodType} so that Power Automate Step 4 and 5
            // automatically scaffold /ADVERTS/${prodType}/${year}/${month}
            const rootFolder = `/ADVERTS/${prodType}`;

            // Entity folder name for Power Automate Step 6 (facilityName parameter in payload)
            // Hierarchy: Company parent folder, followed by Product child folder
            //   - Unexpected: 'Unexpected Adverts/[Company]/[Product]'
            //   - Scheduled: '[Company]/[Product]' (or '[Company]/[Product]/[RoundName]' for subsequent rounds)
            let entityFolderName = `${cleanCompany}/${cleanAdvert}`;
            if (isUnexpected) {
                entityFolderName = `Unexpected Adverts/${cleanCompany}/${cleanAdvert}`;
            } else if (isSubsequentRound) {
                const roundName = report.advertActivityRound || `Activity_${dateStr}_${cleanSighting}`;
                entityFolderName = `${cleanCompany}/${cleanAdvert}/${roundName}`;
            }

            // Subfolders created inside the entity folder by Power Automate Step 7 (Apply to each)
            let subfolders = [];
            if (advertFolderExists) {
                // If advert folder already exists, only create the new facility folder structure
                subfolders = [
                    'Facilities',
                    `${facilitySubPath}/Inspection_Report`
                ];
            } else {
                // First inspection for this advert -> scaffold root advert structure + this facility folder
                subfolders = [
                    'Advert Data and Evidence',
                    'Consultative Meetings',
                    'Facilities',
                    `${facilitySubPath}/Inspection_Report`
                ];
            }

            return {
                rootFolder: rootFolder,
                entityFolderName: entityFolderName,
                productType: report.mainProductType || 'Drugs',
                advertCompany: cleanCompany,
                advertName: cleanAdvert,
                advertCategory: isUnexpected ? 'Unexpected Advert' : 'Scheduled Advert',
                advertFolderExists: advertFolderExists,
                isSubsequentRound: isSubsequentRound,
                facilityFolder: facilitySubPath,
                subfolders: subfolders
            };
        }

        case 'Consultative Meeting': {
            // Re-route based on the consultative category (e.g., Advert, Consumer Complaint)
            const cmCategory = report.consultativeMeetingCategory;
            if (cmCategory && cmCategory !== 'Consultative Meeting') {
                const cmReport = {
                    activityType: cmCategory,
                    mainProductType: report.consultativeProductType || report.mainProductType || null,
                    productTypes: report.consultativeProductType ? [report.consultativeProductType] : (report.productTypes || [])
                };
                const cmConfig = getFolderConfig(cmReport);
                return {
                    rootFolder: cmConfig.rootFolder,
                    productType: cmConfig.productType,
                    subfolders: ['Consultative_Meeting']
                };
            }
            return {
                rootFolder: '/OTHER',
                productType: null,
                subfolders: ['Consultative_Meeting']
            };
        }

        default:
            return {
                rootFolder: '/OTHER',
                productType: null,
                subfolders: []
            };
    }
}

async function uploadToCloudinary(file) {
    if (CLOUDINARY_UPLOAD_PRESET === 'YOUR_UNSIGNED_UPLOAD_PRESET' || !CLOUDINARY_UPLOAD_PRESET) {
        throw new Error('Set CLOUDINARY_UPLOAD_PRESET in app.js to your unsigned upload preset name');
    }
    const fd = new FormData(); fd.append('file', file); fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: 'POST', body: fd }); return await res.json();
}

function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

