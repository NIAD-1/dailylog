import { db, collection, getDocs, addDoc, serverTimestamp, doc, getDoc, query, where, orderBy } from "./db.js";
import { clearRoot, addChoicesInstance, getChoicesInstance, navigate } from "./ui.js";

const LAGOS_LGAs = ["Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa", "Badagry", "Epe", "Eti-Osa", "Ibeju-Lekki", "Ifako-Ijaiye", "Ikeja", "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo", "Oshodi-Isolo", "Shomolu", "Surulere"];
const INSPECTORS_LIST = ["Dr Regina K. Garba", "Pharm. Mmamel Victor", "Pharm. Adesanya Oluwaseun", "Mr Omotuwa Adebayo", "Mrs Bisola Robert", "Mr Ifeanyi Okeke", "Dr Saad Abubakar", "Mr Enilama Emmanuel", "Mr Solomon Emeje Ileanwa", "Ms Mary Adegbite", "Mr Adekunle Adeniran"];
const ACTIVITY_TYPES = ["Routine Surveillance", "GSDP", "GLSI", "Consumer Complaint", "COLD CHAIN Monitoring"];

let currentUser = null;
let currentWeekStart = null;
let scheduledRows = [];
let facilitiesCache = [];
let choicesInstances = {};

export const setSchedulerUser = (user) => { currentUser = user; };

// Get Monday of the current week
function getWeekMonday(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function formatDate(date) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function formatWeekRange(monday) {
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 4);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (monday.getMonth() === friday.getMonth()) {
        return `${months[monday.getMonth()]} ${monday.getDate()}–${friday.getDate()}, ${monday.getFullYear()}`;
    }
    return `${months[monday.getMonth()]} ${monday.getDate()} – ${months[friday.getMonth()]} ${friday.getDate()}, ${monday.getFullYear()}`;
}

function toISODate(date) {
    return date.toISOString().split('T')[0];
}

async function loadFacilities() {
    if (facilitiesCache.length > 0) return facilitiesCache;
    try {
        const snap = await getDocs(collection(db, 'facilities'));
        facilitiesCache = [];
        snap.forEach(d => facilitiesCache.push({ id: d.id, ...d.data() }));
        return facilitiesCache;
    } catch (e) {
        console.error('Error loading facilities:', e);
        return [];
    }
}

export async function renderSchedulerPage(root) {
    clearRoot(root);
    currentWeekStart = getWeekMonday();
    scheduledRows = [];
    choicesInstances = {};

    // Load facilities
    const loadingHTML = `<section class="card" style="text-align:center;padding:60px"><p>Loading facilities...</p></section>`;
    root.innerHTML = loadingHTML;
    await loadFacilities();

    // Add one default row
    addRow();
    renderScheduler(root);
}

function addRow() {
    const day = new Date(currentWeekStart);
    day.setDate(day.getDate() + scheduledRows.length);
    // Keep within Mon-Fri
    if (day.getDay() === 0 || day.getDay() === 6) {
        day.setDate(currentWeekStart.getDate());
    }
    scheduledRows.push({
        id: 'row_' + Date.now() + '_' + scheduledRows.length,
        inspectionDate: toISODate(day),
        facilityName: '',
        facilityAddress: '',
        area: '',
        activityType: '',
        inspectors: [],
        facilityId: null
    });
}

function renderScheduler(root) {
    // Clean up old Choices instances
    Object.values(choicesInstances).forEach(c => {
        try { c.destroy(); } catch (e) { }
    });
    choicesInstances = {};

    const weekLabel = formatWeekRange(currentWeekStart);
    const inspectorCount = new Set(scheduledRows.flatMap(r => r.inspectors)).size;

    root.innerHTML = `
    <section class="card scheduler-card">
        <div class="scheduler-header">
            <h2 style="margin:0;color:var(--accent)">📋 Schedule Inspections</h2>
            <button id="backToWelcome" class="secondary" style="padding:8px 16px;font-size:13px">← Back</button>
        </div>

        <div class="week-navigator">
            <button id="prevWeek" class="secondary week-nav-btn">◀</button>
            <div class="week-label">Week of ${weekLabel}</div>
            <button id="nextWeek" class="secondary week-nav-btn">▶</button>
        </div>

        <div class="scheduler-table-wrap">
            <table class="scheduler-table">
                <thead>
                    <tr>
                        <th style="width:120px">📅 Date</th>
                        <th style="width:140px">🔍 Activity</th>
                        <th style="width:200px">🏢 Facility</th>
                        <th style="width:180px">📍 Address</th>
                        <th style="width:120px">📌 Area</th>
                        <th style="width:200px">👥 Inspectors</th>
                        <th style="width:40px"></th>
                    </tr>
                </thead>
                <tbody id="schedulerBody">
                    ${scheduledRows.map((row, i) => renderRow(row, i)).join('')}
                </tbody>
            </table>
        </div>

        <div class="scheduler-actions">
            <button id="addRowBtn" class="secondary" style="font-size:13px;padding:8px 16px">+ Add Inspection</button>
            <div class="scheduler-summary">
                ${scheduledRows.length} inspection(s) · ${inspectorCount} inspector(s) assigned
            </div>
        </div>

        <div style="margin-top:24px;display:flex;gap:12px;justify-content:flex-end">
            <button id="submitSchedule" class="success" style="padding:12px 32px">Submit Week Schedule</button>
        </div>

        <!-- Add Facility Modal -->
        <div id="addFacilityModal" class="modal-backdrop" style="display:none">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 style="margin:0">Add New Facility</h3>
                    <button id="closeAddFacility" class="secondary" style="padding:4px 12px;font-size:18px">×</button>
                </div>
                <div class="row"><div class="col"><label>Facility Name</label><input id="newFacName"></div></div>
                <div class="row" style="margin-top:12px"><div class="col"><label>Address</label><input id="newFacAddress"></div></div>
                <div class="row" style="margin-top:12px">
                    <div class="col"><label>Activity Type</label><select id="newFacActivity">${ACTIVITY_TYPES.map(a => `<option>${a}</option>`).join('')}</select></div>
                    <div class="col"><label>Area (LGA)</label><select id="newFacArea">${LAGOS_LGAs.map(a => `<option>${a}</option>`).join('')}</select></div>
                </div>
                <div style="margin-top:16px;text-align:right">
                    <button id="saveNewFacility" style="padding:10px 24px">Save Facility</button>
                </div>
            </div>
        </div>
    </section>`;

    bindSchedulerEvents(root);
}

function renderRow(row, index) {
    // Get weekdays for this week
    const weekdays = [];
    for (let i = 0; i < 5; i++) {
        const d = new Date(currentWeekStart);
        d.setDate(d.getDate() + i);
        weekdays.push({ value: toISODate(d), label: formatDate(d) });
    }

    return `
    <tr data-row-id="${row.id}">
        <td>
            <select name="inspectionDate" class="sched-input" data-idx="${index}">
                ${weekdays.map(d => `<option value="${d.value}" ${d.value === row.inspectionDate ? 'selected' : ''}>${d.label}</option>`).join('')}
            </select>
        </td>
        <td>
            <select name="activityType" class="sched-input" data-idx="${index}">
                <option value="">Select...</option>
                ${ACTIVITY_TYPES.map(a => `<option ${a === row.activityType ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
        </td>
        <td>
            <select name="facilityName" class="sched-input facility-select" data-idx="${index}">
                <option value="">Select facility...</option>
            </select>
            <div class="facility-meta" data-idx="${index}"></div>
        </td>
        <td>
            <input name="facilityAddress" class="sched-input" data-idx="${index}" value="${row.facilityAddress}" placeholder="Address">
        </td>
        <td>
            <select name="area" class="sched-input" data-idx="${index}">
                <option value="">Select...</option>
                ${LAGOS_LGAs.map(a => `<option ${a === row.area ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
        </td>
        <td>
            <select name="inspectors" class="sched-input inspector-select" data-idx="${index}" multiple>
                ${INSPECTORS_LIST.map(name => `<option value="${name}" ${row.inspectors.includes(name) ? 'selected' : ''}>${name}</option>`).join('')}
            </select>
        </td>
        <td>
            <button class="remove-row-btn danger" data-idx="${index}" style="padding:4px 10px;font-size:16px" title="Remove">×</button>
        </td>
    </tr>`;
}

function filterFacilitiesForRow(activityType) {
    if (!activityType) return [];
    return facilitiesCache.filter(f => f.activityType === activityType);
}

function bindSchedulerEvents(root) {
    // Back button
    document.getElementById('backToWelcome').addEventListener('click', () => navigate('welcome'));

    // Week navigation
    document.getElementById('prevWeek').addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        scheduledRows.forEach((r, i) => {
            const d = new Date(currentWeekStart);
            d.setDate(d.getDate() + Math.min(i, 4));
            r.inspectionDate = toISODate(d);
        });
        renderScheduler(root);
    });
    document.getElementById('nextWeek').addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        scheduledRows.forEach((r, i) => {
            const d = new Date(currentWeekStart);
            d.setDate(d.getDate() + Math.min(i, 4));
            r.inspectionDate = toISODate(d);
        });
        renderScheduler(root);
    });

    // Add row
    document.getElementById('addRowBtn').addEventListener('click', () => {
        saveAllRowData();
        addRow();
        renderScheduler(root);
    });

    // Remove row buttons
    document.querySelectorAll('.remove-row-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            if (scheduledRows.length <= 1) { alert('You need at least one inspection.'); return; }
            saveAllRowData();
            scheduledRows.splice(idx, 1);
            renderScheduler(root);
        });
    });

    // Initialize Choices.js for inspector selects
    document.querySelectorAll('.inspector-select').forEach(select => {
        const idx = select.dataset.idx;
        const choices = new Choices(select, {
            removeItemButton: true,
            placeholder: true,
            placeholderValue: 'Select...',
            searchEnabled: false
        });
        choicesInstances['inspector_' + idx] = choices;

        // Restore selections
        if (scheduledRows[idx] && scheduledRows[idx].inspectors.length > 0) {
            choices.setValue(scheduledRows[idx].inspectors);
        }
    });

    // Bind activity type changes to filter facilities
    document.querySelectorAll('select[name="activityType"]').forEach(select => {
        select.addEventListener('change', () => {
            const idx = parseInt(select.dataset.idx);
            scheduledRows[idx].activityType = select.value;
            populateFacilityDropdown(idx, select.value);
        });
        // Initialize if activity already selected
        const idx = parseInt(select.dataset.idx);
        if (scheduledRows[idx].activityType) {
            populateFacilityDropdown(idx, scheduledRows[idx].activityType);
        }
    });

    // Bind facility selection changes
    document.querySelectorAll('select[name="facilityName"]').forEach(select => {
        select.addEventListener('change', () => {
            const idx = parseInt(select.dataset.idx);
            const facilityId = select.value;
            const facility = facilitiesCache.find(f => f.id === facilityId);
            if (facility) {
                scheduledRows[idx].facilityName = facility.name;
                scheduledRows[idx].facilityAddress = facility.address;
                scheduledRows[idx].facilityId = facility.id;
                // Update address input
                const addrInput = document.querySelector(`input[name="facilityAddress"][data-idx="${idx}"]`);
                if (addrInput) addrInput.value = facility.address || '';
                // Update area if available
                // Show visit history badge
                showFacilityMeta(idx, facility);
            }
        });
    });

    // Bind other input changes
    document.querySelectorAll('.sched-input').forEach(input => {
        if (input.name === 'activityType' || input.name === 'facilityName' || input.name === 'inspectors') return;
        input.addEventListener('change', () => {
            const idx = parseInt(input.dataset.idx);
            scheduledRows[idx][input.name] = input.value;
        });
    });

    // Submit
    document.getElementById('submitSchedule').addEventListener('click', () => handleSubmit(root));

    // Add facility modal
    document.getElementById('closeAddFacility').addEventListener('click', () => {
        document.getElementById('addFacilityModal').style.display = 'none';
    });
    document.getElementById('saveNewFacility').addEventListener('click', () => handleAddFacility(root));
}

function populateFacilityDropdown(idx, activityType) {
    const select = document.querySelector(`select[name="facilityName"][data-idx="${idx}"]`);
    if (!select) return;

    // Destroy existing Choices instance if any
    if (choicesInstances['facility_' + idx]) {
        choicesInstances['facility_' + idx].destroy();
        delete choicesInstances['facility_' + idx];
    }

    const filtered = filterFacilitiesForRow(activityType);
    select.innerHTML = `<option value="">Select facility (${filtered.length} available)...</option>`
        + filtered.map(f => `<option value="${f.id}">${f.name}</option>`).join('')
        + `<option value="__ADD_NEW__">➕ Add new facility...</option>`;

    // Initialize Choices.js for searchable dropdown
    const choices = new Choices(select, {
        searchEnabled: true,
        placeholder: true,
        placeholderValue: `Search ${filtered.length} facilities...`,
        searchPlaceholderValue: 'Type to search...',
        shouldSort: true,
        itemSelectText: '',
        noResultsText: 'No facilities found',
        noChoicesText: 'Select an activity type first'
    });
    choicesInstances['facility_' + idx] = choices;

    // Restore selection
    if (scheduledRows[idx].facilityId) {
        choices.setChoiceByValue(scheduledRows[idx].facilityId);
    }

    // Listen for "Add new" selection
    select.addEventListener('change', () => {
        if (select.value === '__ADD_NEW__') {
            const modal = document.getElementById('addFacilityModal');
            const actSelect = document.getElementById('newFacActivity');
            actSelect.value = activityType;
            modal.dataset.rowIdx = idx;
            modal.style.display = 'flex';
            choices.setChoiceByValue('');
        }
    }, { once: false });
}

function showFacilityMeta(idx, facility) {
    const meta = document.querySelector(`.facility-meta[data-idx="${idx}"]`);
    if (!meta) return;

    let badge = '';
    if (facility.lastVisitDate) {
        badge = `<span class="visit-badge visited">Last: ${facility.lastVisitDate}</span>`;
    } else {
        badge = `<span class="visit-badge new">🟢 Never visited</span>`;
    }
    if (facility.fileNumber) {
        badge += `<span class="file-badge">${facility.fileNumber}</span>`;
    }
    meta.innerHTML = badge;
}

function saveAllRowData() {
    scheduledRows.forEach((row, idx) => {
        const dateSelect = document.querySelector(`select[name="inspectionDate"][data-idx="${idx}"]`);
        const addrInput = document.querySelector(`input[name="facilityAddress"][data-idx="${idx}"]`);
        const areaSelect = document.querySelector(`select[name="area"][data-idx="${idx}"]`);
        const actSelect = document.querySelector(`select[name="activityType"][data-idx="${idx}"]`);

        if (dateSelect) row.inspectionDate = dateSelect.value;
        if (addrInput) row.facilityAddress = addrInput.value;
        if (areaSelect) row.area = areaSelect.value;
        if (actSelect) row.activityType = actSelect.value;

        // Get inspectors from Choices
        const inspChoices = choicesInstances['inspector_' + idx];
        if (inspChoices) {
            row.inspectors = inspChoices.getValue(true);
        }
    });
}

async function handleAddFacility(root) {
    const name = document.getElementById('newFacName').value.trim();
    const address = document.getElementById('newFacAddress').value.trim();
    const activityType = document.getElementById('newFacActivity').value;
    const area = document.getElementById('newFacArea').value;

    if (!name) { alert('Please enter a facility name.'); return; }

    try {
        const newFacility = {
            name, address, activityType, area,
            contactPerson: '', email: '', fileNumber: '',
            lastVisitDate: '', status: 'Active', visitCount: 0
        };
        const docRef = await addDoc(collection(db, 'facilities'), newFacility);
        facilitiesCache.push({ id: docRef.id, ...newFacility });

        // Close modal
        const modal = document.getElementById('addFacilityModal');
        const rowIdx = parseInt(modal.dataset.rowIdx || '0');
        modal.style.display = 'none';

        // Clear form
        document.getElementById('newFacName').value = '';
        document.getElementById('newFacAddress').value = '';

        // Refresh the facility dropdown for that row
        saveAllRowData();
        scheduledRows[rowIdx].facilityName = name;
        scheduledRows[rowIdx].facilityAddress = address;
        scheduledRows[rowIdx].facilityId = docRef.id;
        renderScheduler(root);

        alert(`Facility "${name}" added successfully!`);
    } catch (e) {
        console.error('Error adding facility:', e);
        alert('Failed to add facility. Please try again.');
    }
}

async function handleSubmit(root) {
    saveAllRowData();

    // Validate
    for (let i = 0; i < scheduledRows.length; i++) {
        const row = scheduledRows[i];
        if (!row.activityType) { alert(`Row ${i + 1}: Please select an activity type.`); return; }
        if (!row.facilityName) { alert(`Row ${i + 1}: Please select a facility.`); return; }
        if (row.inspectors.length === 0) { alert(`Row ${i + 1}: Please assign at least one inspector.`); return; }
    }

    const submitBtn = document.getElementById('submitSchedule');
    submitBtn.textContent = 'Submitting...';
    submitBtn.disabled = true;

    try {
        // Fetch webhook URL
        const settingsRef = doc(db, 'settings', 'kpiTargets');
        const settingsSnap = await getDoc(settingsRef);
        const webhookUrl = settingsSnap.exists() ? settingsSnap.data().schedulerWebhookUrl : null;

        // Save to Firestore
        const scheduleId = 'SCH-' + new Date().getFullYear() + '-' + Date.now();
        const scheduleDoc = {
            scheduleId,
            weekStart: currentWeekStart.toISOString(),
            submittedBy: currentUser ? (currentUser.displayName || currentUser.email) : 'Unknown',
            submittedByUid: currentUser ? currentUser.uid : null,
            status: 'Pending',
            createdAt: serverTimestamp(),
            inspections: scheduledRows.map(row => ({
                inspectionDate: row.inspectionDate,
                facilityName: row.facilityName,
                facilityAddress: row.facilityAddress,
                area: row.area,
                activityType: row.activityType,
                inspectors: row.inspectors.join(', '),
                facilityId: row.facilityId
            }))
        };

        await addDoc(collection(db, 'inspectionSchedules'), scheduleDoc);

        // Trigger Power Automate webhook if configured
        if (webhookUrl) {
            const payload = {
                scheduleId,
                weekStart: toISODate(currentWeekStart),
                submittedBy: scheduleDoc.submittedBy,
                inspections: scheduleDoc.inspections
            };

            fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(err => console.error('Scheduler webhook failed:', err));
        }

        // Show success
        root.innerHTML = `
        <section class="card" style="text-align:center;padding:60px">
            <h2 style="color:var(--accent)">✅ Schedule Submitted</h2>
            <p style="font-size:18px;margin:16px 0">${scheduledRows.length} inspection(s) for the week of ${formatWeekRange(currentWeekStart)}</p>
            <p class="muted">Schedule ID: <strong>${scheduleId}</strong></p>
            <p class="muted">Status: <strong>Pending Approval</strong></p>
            <div style="margin-top:32px;display:flex;gap:16px;justify-content:center">
                <button id="newSchedule" class="secondary" style="padding:12px 24px">Create Another Schedule</button>
                <button id="goHome" style="padding:12px 24px">Back to Home</button>
            </div>
        </section>`;

        document.getElementById('newSchedule').addEventListener('click', () => renderSchedulerPage(root));
        document.getElementById('goHome').addEventListener('click', () => navigate('welcome'));

    } catch (e) {
        console.error('Error submitting schedule:', e);
        alert('Failed to submit schedule. Please try again.');
        submitBtn.textContent = 'Submit Week Schedule';
        submitBtn.disabled = false;
    }
}
