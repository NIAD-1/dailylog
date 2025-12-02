import { db, collection, query, where, orderBy, getDocs, doc, getDoc, setDoc, serverTimestamp } from "./db.js";
import { clearRoot, addChoicesInstance, getChoicesInstance, navigate } from "./ui.js";

const PRODUCT_TYPES = ["Drugs", "Food", "Medical Devices", "Cosmetics", "Vaccines & Biologics", "Herbals", "Service Drugs", "Donated Items/Drugs", "Orphan Drugs"];
const LAGOS_LGAs = ["Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa", "Badagry", "Epe", "Eti-Osa", "Ibeju-Lekki", "Ifako-Ijaiye", "Ikeja", "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo", "Oshodi-Isolo", "Shomolu", "Surulere"];

let chartActivities, chartMopHold, chartGsdv, chartSanctions;
let dashboardChoices = [];
let lastLoadedReports = [];
let lastLoadedInspectors = [];
let currentUserRole = 'inspector';

export const setDashboardUserRole = (role) => {
    currentUserRole = role;
};

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
    <div class="controls" style="margin-bottom: 16px; display: flex; justify-content: space-between;">
        <button id="backToWelcome" class="secondary">&larr; Back to Home</button>
        <button id="generateWeeklySummaryBtn" class="success">✨ Generate Weekly AI Summary</button>
    </div>
    ${kpiOverviewSection}
    <div class="stat-cards" id="statCardsContainer"></div>
    <div class="card">
        <h2>Report Details</h2>
        <div class="muted small">Filters</div>
        <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap; align-items: flex-end;">
            <div style="flex:1;min-width:150px"><label class="small">From</label><input type="date" id="filterFrom" /></div>
            <div style="flex:1;min-width:150px"><label class="small">To</label><input type="date" id="filterTo" /></div>
            <div style="flex:1;min-width:150px"><label class="small">Area</label><select id="filterArea"><option value="">All Areas</option>${LAGOS_LGAs.map(a => `<option>${a}</option>`).join('')}</select></div>
            <div style="flex:1;min-width:150px"><label class="small">Submitter</label><select id="filterInspector"><option value="">All Submitters</option></select></div>
            <div style="flex:2;min-width:200px"><label class="small">Activity</label><select id="filterActivity"><option value="">All Activities</option><option>Consultative Meeting</option><option>GLSI</option><option>Routine Surveillance</option><option>GSDP</option><option>Consumer Complaint</option><option>RASFF</option><option>Survey</option><option>Laboratory Analysis</option><option>COLD CHAIN Monitoring</option></select></div>
            <div style="flex:2;min-width:200px"><label class="small">Product Type</label><select id="filterProductType" multiple></select></div>
            <div style="flex:2;min-width:200px"><label class="small">Search Facility</label><input type="text" id="filterSearch" placeholder="Search by Facility Name..." /></div>
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

export const bindDashboard = (root) => {
    root.innerHTML = pageDashboard;
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
    // Allow pressing Enter in search box to apply filters
    document.getElementById('filterSearch').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            loadDashboard();
        }
    });

    document.getElementById('exportCsvBtn').onclick = () => {
        if (lastLoadedReports.length === 0) {
            alert("There is no data to export. Please apply a filter first.");
            return;
        }
        exportToCSV(lastLoadedReports, lastLoadedInspectors);
    };

    document.getElementById('generateWeeklySummaryBtn').onclick = generateWeeklySummary;

    loadDashboard();
};

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
    const filterSearch = document.getElementById('filterSearch').value.trim().toLowerCase();

    const productTypeFilterEl = dashboardChoices[0].passedElement.element;
    const selectedProductTypes = Array.from(productTypeFilterEl.selectedOptions).map(option => option.value);

    if (filterActivity) q = query(q, where('activityType', '==', filterActivity));
    if (filterArea) q = query(q, where('area', '==', filterArea));
    if (filterInspector) q = query(q, where('createdBy', '==', filterInspector));
    if (selectedProductTypes.length > 0) {
        q = query(q, where('productTypes', 'array-contains-any', selectedProductTypes));
    }

    if (filterFrom) {
        const fromDate = new Date(filterFrom); fromDate.setHours(0, 0, 0, 0);
        q = query(q, where('inspectionDate', '>=', fromDate));
    }
    if (filterTo) {
        const toDate = new Date(filterTo); toDate.setHours(23, 59, 59, 999);
        q = query(q, where('inspectionDate', '<=', toDate));
    }

    if (filterFrom || filterTo) {
        q = query(q, orderBy('inspectionDate', 'desc'));
    }
    q = query(q, orderBy('createdAt', 'desc'));

    try {
        const snap = await getDocs(q);
        let reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const allUsersSnap = await getDocs(query(collection(db, 'users')));
        const inspectors = allUsersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Client-side filtering for search term
        if (filterSearch) {
            reports = reports.filter(r => (r.facilityName || '').toLowerCase().includes(filterSearch));
        }

        lastLoadedReports = reports;
        lastLoadedInspectors = inspectors;

        const inspectorSelect = document.getElementById('filterInspector');
        if (inspectorSelect && inspectorSelect.options.length <= 1) {
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
    const container = document.getElementById('statCardsContainer');
    if (!container) return;
    const totalReports = data.length;
    const totalSanctions = data.filter(r => r.sanctionGiven).length;
    const totalMopUps = data.reduce((sum, r) => sum + (r.mopUpCount || 0), 0);
    const uniqueFacilities = new Set(data.map(r => r.facilityName)).size;

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
    const modalContainer = document.getElementById('modalContainer');
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

function buildActivityChart(data) { const counts = {}; data.forEach(d => counts[d.activityType] = (counts[d.activityType] || 0) + 1); const labels = Object.keys(counts); const vals = labels.map(l => counts[l]); if (chartActivities) chartActivities.destroy(); const ctx = document.getElementById('chartActivities').getContext('2d'); chartActivities = new Chart(ctx, { type: 'pie', data: { labels, datasets: [{ data: vals, backgroundColor: ['#007bff', '#6c757d', '#28a745', '#dc3545', '#ffc107', '#17a2b8', '#343a40'] }] }, options: { responsive: true, plugins: { legend: { position: 'right' } } } }); }
function buildMopHoldChart(data) { const grouped = {}; data.forEach(d => { if (!d.inspectionDate || !d.inspectionDate.toDate) return; const day = d.inspectionDate.toDate().toISOString().slice(0, 10); grouped[day] = grouped[day] || { mop: 0, hold: 0 }; grouped[day].mop += (d.mopUpCount || 0); grouped[day].hold += (d.holdCount || 0); }); const labels = Object.keys(grouped).sort(); const mop = labels.map(l => grouped[l].mop); const hold = labels.map(l => grouped[l].hold); if (chartMopHold) chartMopHold.destroy(); const ctx = document.getElementById('chartMopHold').getContext('2d'); chartMopHold = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Mop-ups', data: mop, backgroundColor: '#ffc107' }, { label: 'Holds', data: hold, backgroundColor: '#dc3545' }] }, options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } } }); }
function buildGsdvChart(data) { const counts = { GDP: 0, CEVI: 0 }; data.forEach(d => { if (d.gsdpSubActivity && counts.hasOwnProperty(d.gsdpSubActivity)) counts[d.gsdpSubActivity]++; }); const labels = Object.keys(counts); const vals = labels.map(l => counts[l]); if (chartGsdv) chartGsdv.destroy(); const ctx = document.getElementById('chartGsdv').getContext('2d'); chartGsdv = new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ data: vals, backgroundColor: ['#17a2b8', '#28a745'] }] }, options: { responsive: true, plugins: { legend: { position: 'right' } } } }); }
function buildSanctionsChart(data) { const grouped = {}; data.forEach(d => { if (!d.inspectionDate || !d.inspectionDate.toDate) return; const day = d.inspectionDate.toDate().toISOString().slice(0, 10); grouped[day] = grouped[day] || 0; if (d.sanctionGiven) grouped[day]++; }); const labels = Object.keys(grouped).sort(); const vals = labels.map(l => grouped[l]); if (chartSanctions) chartSanctions.destroy(); const ctx = document.getElementById('chartSanctions').getContext('2d'); chartSanctions = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: 'Sanctions', data: vals, fill: true, borderColor: '#007bff', tension: 0.1 }] }, options: { scales: { y: { beginAtZero: true } } } }); }

async function generateWeeklySummary() {
    const apiKey = localStorage.getItem('gemini_api_key') || prompt("Please enter your Google Gemini API Key:");
    if (!apiKey) return;
    localStorage.setItem('gemini_api_key', apiKey);

    const btn = document.getElementById('generateWeeklySummaryBtn');
    const originalText = btn.textContent;
    btn.textContent = "Generating...";
    btn.disabled = true;

    try {
        // Fetch last 7 days reports
        const today = new Date();
        const lastWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);

        let q = query(collection(db, 'facilityReports'),
            where('inspectionDate', '>=', lastWeek),
            orderBy('inspectionDate', 'desc')
        );

        const snap = await getDocs(q);
        const reports = snap.docs.map(d => d.data());

        if (reports.length === 0) {
            alert("No reports found for the last 7 days.");
            return;
        }

        // Prepare data for AI
        const summaryData = reports.map(r => `
            - Facility: ${r.facilityName} (${r.area})
            - Activity: ${r.activityType}
            - Action: ${r.actionTaken}
            - Sanction: ${r.sanctionGiven ? 'Yes' : 'No'}
            - MopUp: ${r.mopUpCount} items
        `).join('\n');

        const promptText = `
            Analyze the following inspection reports from the last week and generate a **Visual HTML Report**.
            
            **Requirements:**
            1.  **Do NOT** use Markdown. Use only HTML tags (e.g., <table>, <tr>, <th>, <td>, <ul>, <li>, <b>).
            2.  **Style the tables** with 'border-collapse: collapse; width: 100%; margin-bottom: 16px;'. Add borders to cells.
            3.  **Section 1: Activity Summary Table**
                -   Columns: Activity Type | Facility Count | Inspector(s) (comma separated)
                -   Group by Activity Type.
            4.  **Section 2: Key Actions Table**
                -   Columns: Facility Name | Action Taken | Mop Up Count | Hold Count | Sanction Given
                -   Only include facilities where Mop Up > 0 OR Hold > 0 OR Sanction is Yes.
            5.  **Section 3: Executive Summary**
                -   A concise paragraph highlighting trends and areas of concern.

            Reports Data:
            ${summaryData}
        `;

        // Try using gemini-2.0-flash which is available in the user's list
        const modelId = 'gemini-2.0-flash';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Gemini API Error:", errorData);

            // If model not found, try to list available models to help debug
            if (response.status === 404 || (errorData.error && errorData.error.message.includes('not found'))) {
                try {
                    const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                    const listData = await listResp.json();
                    console.log("Available Models:", listData);
                    const modelNames = listData.models ? listData.models.map(m => m.name).join(', ') : 'None found';
                    throw new Error(`Model '${modelId}' not found. Available models: ${modelNames}`);
                } catch (listErr) {
                    console.error("Failed to list models:", listErr);
                }
            }

            throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            console.error("Unexpected API Response:", data);
            throw new Error("Unexpected response format from AI service.");
        }

        const aiSummary = data.candidates[0].content.parts[0].text;

        // Show Summary in Modal
        const modalContainer = document.getElementById('modalContainer');
        modalContainer.innerHTML = `
            <div class="modal-backdrop">
              <div class="modal-content">
                <div class="modal-header"><h3>Weekly AI Summary</h3><button id="closeModalBtn" style="background:transparent;color:var(--primary-text);font-size:24px;">&times;</button></div>
                <div style="white-space: pre-wrap; line-height: 1.6;">${aiSummary.replace(/\*\*/g, '<b>').replace(/\*/g, '•')}</div>
              </div>
            </div>`;

        document.getElementById('closeModalBtn').onclick = () => modalContainer.innerHTML = '';
        document.querySelector('.modal-backdrop').onclick = (e) => { if (e.target === e.currentTarget) modalContainer.innerHTML = ''; };

    } catch (error) {
        console.error(error);
        alert(`Failed to generate summary: ${error.message}`);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}
