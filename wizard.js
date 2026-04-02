import { db, collection, addDoc, serverTimestamp, doc, getDoc, getDocs, query, where } from "./db.js";
import { resolveFacility } from "./facility-utils.js";
import { clearRoot, addChoicesInstance, getChoicesInstance, removeChoicesInstance, navigate } from "./ui.js";

const LAGOS_LGAs = ["Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa", "Badagry", "Epe", "Eti-Osa", "Ibeju-Lekki", "Ifako-Ijaiye", "Ikeja", "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo", "Oshodi-Isolo", "Shomolu", "Surulere"];
const INSPECTORS_LIST = ["Dr Regina K. Garba", "Pharm. Mmamel Victor", "Pharm. Adesanya Oluwaseun", "Mr Omotuwa Adebayo", "Mrs Bisola Robert", "Mr Ifeanyi Okeke", "Dr Saad Abubakar", "Mr Enilama Emmanuel", "Mr Solomon Emeje Ileanwa", "Ms Mary Adegbite", "Mr Adekunle Adeniran", "Others"];
const PRODUCT_TYPES = ["Drugs", "Food", "Medical Devices", "Cosmetics", "Vaccines & Biologics", "Herbals", "Service Drugs", "Donated Items/Drugs", "Orphan Drugs"];
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
        <div style="margin-top:8px"><label>Activity Type</label><select name="activityType" required><option value=""></option><option>Consultative Meeting</option><option>GLSI</option><option>Routine Surveillance</option><option>GSDP</option><option>Consumer Complaint</option><option>RASFF</option><option>Survey</option><option>Laboratory Analysis</option><option>COLD CHAIN Monitoring</option></select></div>
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
        // Remove old productTypeSelect instance if it exists
        const oldChoices = getChoicesInstance('productTypeSelect');
        if (oldChoices) {
            oldChoices.instance.destroy();
        }
        // Remove old consultativeFacilityName instance if exists
        removeChoicesInstance('consultativeFacilityName');

        let conditionalHTML = '';
        const val = activitySelect.value;

        // Hide the regular Facility Name & Address row when Consultative Meeting is chosen
        // (the CM section has its own searchable facility dropdown)
        const facilityRow = container.querySelector('#regularFacilityRow');
        if (facilityRow) {
            facilityRow.style.display = val === 'Consultative Meeting' ? 'none' : '';
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
                    <div class="col">
                        <label>Activity Category</label>
                        <select name="consultativeMeetingCategory">
                            <option value="">Select activity category...</option>
                            <option value="Routine Surveillance">Routine Surveillance</option>
                            <option value="GLSI">GLSI</option>
                            <option value="Consumer Complaint">Consumer Complaint</option>
                            <option value="GSDP">GSDP</option>
                            <option value="Monitoring">Monitoring of Service Drugs, Orphan Drugs & Donated Items</option>
                        </select>
                    </div>
                    <div class="col" id="consultativeSubCategoryContainer" style="display: none;">
                        <label>Product Type</label>
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
            conditionalHTML = `<div style="margin-top:8px"><label>GSDP Sub-Activity</label><select name="gsdpSubActivity"><option>GDP</option><option>CEVI</option></select></div>
                <div style="margin-top:8px"><label>Company Email (M.D / Superintendent Pharmacist)</label><input name="companyEmail" type="email" placeholder="Must be M.D or Superintendent Pharmacist email" required></div>`;
        } else if (val === 'Laboratory Analysis') {
            conditionalHTML = `<div style="margin-top:8px"><label>How many samples taken?</label><input name="Samplescount" type="number" min="0" value="0"></div>`;
        }

        conditional.innerHTML = conditionalHTML;

        const productSelect = conditional.querySelector('select[name="productTypeSelect"]');
        if (productSelect) {
            productSelect.innerHTML = PRODUCT_TYPES.map(pt => `<option value="${pt}">${pt}</option>`).join('');
            const choices = new Choices(productSelect, { removeItemButton: true, placeholder: true, placeholderValue: 'Select Product Type(s)...' });
            addChoicesInstance('productTypeSelect', choices);
            if (currentData.productTypes) {
                choices.setValue(currentData.productTypes);
            }
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
                if (selectedCategory && ['Routine Surveillance', 'Consumer Complaint'].includes(selectedCategory)) {
                    const options = selectedCategory === 'Routine Surveillance' ? surveillanceProducts : complaintProducts;
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
    const facilityNameInput = container.querySelector('input[name="facilityName"]');
    const newFacNameInput = container.querySelector('input[name="newConsultativeFacilityName"]');

    if (consultativeFacilitySelect) {
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

    const fields = [
        'inspectionDate', 'area', 'facilityName', 'facilityAddress', 'activityType', 'actionTaken',
        'sanctionGiven', 'gsdpSubActivity', 'companyEmail', 'Samplescount', 'consultativeMeetingCategory', 'consultativeProductType',
        'mopUp', 'mopUpDrugs', 'mopUpCosmetics', 'mopUpMedicalDevices', 'mopUpFood',
        'hold', 'holdDrugs', 'holdCosmetics', 'holdMedicalDevices', 'holdFood'
    ];

    fields.forEach(fieldName => {
        const el = container.querySelector(`[name="${fieldName}"]`);
        if (el) {
            data[fieldName] = el.value;
        }
    });

    // Override facilityName and facilityAddress from consultative meeting fields
    // (must be AFTER fields.forEach so it doesn't get overwritten by the hidden regular inputs)
    if (consultativeFacilitySelect) {
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

            const reportData = {
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
                    drugs: parseInt(facilityData.holdCounts?.drugs || facilityData.holdDrugs || 0),
                    cosmetics: parseInt(facilityData.holdCounts?.cosmetics || facilityData.holdCosmetics || 0),
                    medicalDevices: parseInt(facilityData.holdCounts?.medicalDevices || facilityData.holdMedicalDevices || 0),
                    food: parseInt(facilityData.holdCounts?.food || facilityData.holdFood || 0)
                },
                gsdpSubActivity: facilityData.gsdpSubActivity || '',
                companyEmail: facilityData.companyEmail || '',
                Samples: parseInt(facilityData.Samplescount || 0) > 0,
                Samplescount: parseInt(facilityData.Samplescount || 0),
                consultativeMeetingCategory: facilityData.consultativeMeetingCategory || '',
                consultativeProductType: facilityData.consultativeProductType || '',
                createdBy: currentUser.uid,
                createdAt: serverTimestamp()
            };

            // Add to Firestore
            await addDoc(collection(db, 'facilityReports'), reportData);

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
                'Consumer Complaint',
                'GSDP',
                'GLSI',
                'COLD CHAIN Monitoring'
            ];
            if (folderActivities.includes(reportData.activityType)) {
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

async function triggerTeamsWebhook(report) {
    try {
        // Fetch URL from settings
        const settingsRef = doc(db, 'settings', 'kpiTargets');
        const settingsSnap = await getDoc(settingsRef);

        if (!settingsSnap.exists()) return;

        const webhookUrl = settingsSnap.data().webhookUrl;
        if (!webhookUrl) return;

        // Extract Year and Month from inspectionDate
        const dateObj = new Date(report.inspectionDate);
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

        // Prepare enhanced payload
        const payload = {
            reportId: reportId,
            lookupKey: `${sanitizedFacilityName}_${report.activityType}`, // UNIQUE KEY FOR FLOW LOOKUP
            facilityName: sanitizedFacilityName,
            area: report.area,
            inspectionDate: report.inspectionDate.toISOString().split('T')[0],
            inspectors: Array.isArray(report.inspectorNames) ? report.inspectorNames.join(', ') : report.inspectorName,
            activity: report.activityType,
            year: year,
            month: month,
            productType: folderConfig.productType || null,
            rootFolder: folderConfig.rootFolder,
            subfolders: folderConfig.subfolders,
            deadline: deadline.toISOString(),
            gsdpSubActivity: report.gsdpSubActivity || null,
            companyEmail: report.companyEmail || null
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

        const inspectors = Array.isArray(report.inspectorNames)
            ? report.inspectorNames
            : [report.inspectorNames || ''];

        // Build a temporary report object to get the correct root folder
        // based on the consultative category (e.g., RS → /ROUTINE SURVEILLANCE/DRUGS)
        const folderReport = {
            activityType: report.consultativeMeetingCategory || 'Routine Surveillance',
            productTypes: report.consultativeProductType ? [report.consultativeProductType] : []
        };
        const folderConfig = getFolderConfig(folderReport);

        // Generate report ID for folder naming
        const timestamp = Date.now();
        const activityCode = getActivityCode('Consultative Meeting');
        const reportId = `${activityCode}-${year}-${timestamp}`;

        // Consultative meetings always get these two subfolders
        const cmSubfolders = ['Consultative_Meeting', 'Extra_Data'];

        const payload = {
            // PA uses this to identify the activity type (matches the field name in the other webhook)
            activity: 'Consultative Meeting',
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
            remarks: report.actionTaken || '',
            consultativeMeetingCategory: report.consultativeMeetingCategory || '',
            consultativeCategory: report.consultativeMeetingCategory || '', // used by PA to know which SP path
            consultativeProductType: report.consultativeProductType || '',

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

// Helper: Get folder configuration based on activity type
function getFolderConfig(report) {
    const activity = report.activityType;
    const productTypes = report.productTypes || [];

    // Check if this is Service/Donated/Orphan drugs
    const specialDrugs = ['Service Drugs', 'Donated Items/Drugs', 'Orphan Drugs'];
    const hasSpecialDrugs = productTypes.some(pt => specialDrugs.includes(pt));

    switch (activity) {
        case 'Routine Surveillance':
            if (hasSpecialDrugs) {
                return {
                    rootFolder: '/DONATED DRUGS, SERVICE DRUGS AND ORPHAN DRUGS',
                    productType: productTypes.join(', '),
                    subfolders: ['Surveillance_Report', 'Consultative_Meeting', 'Extra_Data']
                };
            }
            return {
                rootFolder: '/ROUTINE SURVEILLANCE/DRUGS',
                productType: 'Drugs',
                subfolders: ['Surveillance_Report', 'Consultative_Meeting', 'Extra_Data']
            };

        case 'Consumer Complaint':
            return {
                rootFolder: '/CONSUMER COMPLAINT',
                productType: productTypes.join(', ') || null,
                subfolders: ['Inspection_Report', 'Consultative_Meeting', 'Investigation_Data']
            };

        case 'GSDP':
            return {
                rootFolder: '/GSDP (GOOD STORAGE AND DISTRIBUTION PRACTICE)/GSDP COMPANY FILES',
                productType: null,
                subfolders: [
                    'GSDP/Inspection_Report', 'GSDP/Compliance_Directives', 'GSDP/CAPA_Template', 'GSDP/Risk_Categorization',
                    'CEVI/Inspection_Report', 'CEVI/Compliance_Directives', 'CEVI/CAPA_Template', 'CEVI/Risk_Categorization',
                    'Company_Submissions'
                ]
            };

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
