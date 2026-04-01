import { db, collection, query, where, orderBy, getDocs, doc, getDoc, setDoc, serverTimestamp } from "./db.js";
import { clearRoot, addChoicesInstance, getChoicesInstance, navigate } from "./ui.js";

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

let chartActivities, chartMopHold, chartGsdp, chartSanctions;
let lastLoadedReports = [];
let lastLoadedUsers = [];

/**
 * Main dashboard layout template
 */
const dashboardLayout = `
<section class="animate-fade-in">
    <div class="controls" style="margin-bottom: 24px; justify-content: space-between; align-items: center;">
        <button id="backToHome" class="secondary">&larr; Return to Home</button>
        <div class="flex">
            <button id="exportCsvBtn" class="secondary" style="font-size: 13px; padding: 10px 20px;">💾 Export CSV</button>
            <button id="applyFilters" style="padding: 10px 24px;">📊 Refresh Dashboard</button>
        </div>
    </div>

    <!-- KPI Overview Row -->
    <div class="card">
        <h2 style="font-size: 18px; text-transform: uppercase;">National KPI Matrix</h2>
        <p class="muted small" style="margin-bottom: 24px;">Performance targets based on selected filters.</p>
        <div class="kpi-grid" id="kpiGridContainer"></div>
    </div>

    <!-- Stat Cards Row -->
    <div class="stat-cards" id="statCardsContainer"></div>

    <div class="row">
        <!-- Main Filter & Visuals Section -->
        <div class="col" style="flex: 2;">
            <div class="card">
                <h2 style="font-size: 18px; text-transform: uppercase;">Intelligence Filters</h2>
                <div style="display:flex; gap:16px; margin-top:20px; flex-wrap:wrap; align-items: flex-end;">
                    <div style="flex:1; min-width:140px"><label class="small">Zone</label><select id="filterZone"><option value="">All Zones</option>${Object.keys(ZONES).map(z => `<option>${z}</option>`).join('')}</select></div>
                    <div style="flex:1; min-width:140px"><label class="small">State</label><select id="filterState"><option value="">Select Zone first</option></select></div>
                    <div style="flex:2; min-width:180px"><label class="small">Activity</label><select id="filterActivity"><option value="">All Activities</option><option>Routine Surveillance</option><option>GSDP</option><option>GLSI</option><option>Consumer Complaint</option><option>RASFF</option><option>Survey</option><option>Laboratory Analysis</option><option>COLD CHAIN Monitoring</option><option>Consultative Meeting</option><option>Adverts Monitoring</option></select></div>
                    <div style="flex:2; min-width:180px"><label class="small">Product Type</label><select id="filterProductType" multiple></select></div>
                </div>
                <div style="display:flex; gap:16px; margin-top:16px; flex-wrap:wrap; align-items: flex-end;">
                    <div style="flex:1; min-width:140px"><label class="small">From</label><input type="date" id="filterFrom"></div>
                    <div style="flex:1; min-width:140px"><label class="small">To</label><input type="date" id="filterTo"></div>
                    <div style="flex:2; min-width:200px"><label class="small">Search Facility</label><input type="text" id="filterSearch" placeholder="Name or Address..."></div>
                </div>
            </div>

            <div class="charts">
                <div class="card"><h3 class="small muted">Activity Distribution</h3><canvas id="chartActivities"></canvas></div>
                <div class="card"><h3 class="small muted">Enforcement Volume</h3><canvas id="chartMopHold"></canvas></div>
            </div>
            
            <div class="card" style="margin-top: 24px;">
                <h3 class="small muted uppercase" style="margin-bottom: 16px;">Latest Intelligence Submissions</h3>
                <div id="tableContainer" style="overflow-x: auto;"></div>
            </div>
        </div>

        <!-- Right Side: Leaderboard & Performance -->
        <div class="col" style="flex: 1;">
            <div class="card">
                <h2 style="font-size: 18px; text-transform: uppercase;">🏅 Officer Performance</h2>
                <p class="muted small">Monthly activity tally per field officer.</p>
                <div id="leaderboardContainer" style="margin-top: 16px;"></div>
            </div>
            
            <div class="card" style="margin-top: 24px;">
                <h3 class="small muted uppercase">GSDP Breakdown</h3>
                <canvas id="chartGsdp"></canvas>
            </div>
            
            <div class="card" style="margin-top: 24px;">
                <h3 class="small muted uppercase">Sanctions Timeline</h3>
                <canvas id="chartSanctions"></canvas>
            </div>
        </div>
    </div>
</section>
`;

export const renderDashboard = () => {
    return dashboardLayout;
};

export const bindDashboard = (root) => {
    // Cascading Dropdowns: Zone -> State
    const zoneSelect = document.getElementById('filterZone');
    const stateSelect = document.getElementById('filterState');
    zoneSelect.onchange = () => {
        const zone = zoneSelect.value;
        stateSelect.innerHTML = '<option value="">All States</option>';
        if (ZONES[zone]) {
            ZONES[zone].forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                stateSelect.appendChild(opt);
            });
        }
    };

    // Initialize Multiselect for Product Type
    const ptFilter = document.getElementById('filterProductType');
    ptFilter.innerHTML = PRODUCT_TYPES.map(pt => `<option value="${pt}">${pt}</option>`).join('');
    const ptChoices = new Choices(ptFilter, { removeItemButton: true, placeholder: true, placeholderValue: 'Filter Products' });
    addChoicesInstance('filterProductType', ptChoices);

    document.getElementById('backToHome').onclick = () => navigate('welcome');
    document.getElementById('applyFilters').onclick = loadDashboard;
    document.getElementById('exportCsvBtn').onclick = exportToCSV;

    loadDashboard();
};

async function loadDashboard() {
    const root = document.getElementById('app');
    const tableContainer = document.getElementById('tableContainer');
    tableContainer.innerHTML = '<div class="muted small" style="text-align:center; padding: 40px;">🔍 Searching Firestore...</div>';

    // 1. Fetch KPI Targets (Defaults or from settings)
    const kpiTargets = { targetSurveillance: 100, targetGsdp: 30, targetMeetings: 20 };

    // 2. Query Facility Reports
    let q = query(collection(db, 'facilityReports'), orderBy('createdAt', 'desc'));

    // Apply basic filters available to Firestore (simple equality)
    const filterActivity = document.getElementById('filterActivity').value;
    const filterZone = document.getElementById('filterZone').value;
    const filterState = document.getElementById('filterState').value;
    const filterFrom = document.getElementById('filterFrom').value;
    const filterTo = document.getElementById('filterTo').value;

    if (filterActivity) q = query(q, where('activityType', '==', filterActivity));
    if (filterZone) q = query(q, where('zone', '==', filterZone));
    if (filterState) q = query(q, where('state', '==', filterState));

    try {
        const snap = await getDocs(q);
        let reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // 3. Client-side filtering (Complex or Missing indices)
        const filterSearch = document.getElementById('filterSearch').value.toLowerCase();
        const selectedPTs = getChoicesInstance('filterProductType').getValue(true);

        if (filterSearch) {
            reports = reports.filter(r => 
                (r.facilityName || '').toLowerCase().includes(filterSearch) || 
                (r.facilityAddress || '').toLowerCase().includes(filterSearch)
            );
        }

        if (selectedPTs.length > 0) {
            reports = reports.filter(r => 
                (r.productTypes || []).some(pt => selectedPTs.includes(pt))
            );
        }

        // Filter by Date properly (if string comparison fails)
        if (filterFrom) {
            const fromDate = new Date(filterFrom);
            reports = reports.filter(r => r.inspectionDate && r.inspectionDate.toDate() >= fromDate);
        }
        if (filterTo) {
            const toDate = new Date(filterTo);
            toDate.setHours(23, 59, 59);
            reports = reports.filter(r => r.inspectionDate && r.inspectionDate.toDate() <= toDate);
        }

        lastLoadedReports = reports;

        // 4. Render Visuals
        renderKPIs(reports, kpiTargets);
        renderStatCards(reports);
        renderLeaderboard(reports);
        renderTable(reports);
        
        buildCharts(reports);

    } catch (err) {
        console.error("Dashboard Error:", err);
        tableContainer.innerHTML = `<div class="card" style="border-color:red; color:red;">${err.message}</div>`;
    }
}

// ─── RENDERING FUNCTIONS ────────────────────────────────────────────────────

function renderKPIs(reports, targets) {
    const container = document.getElementById('kpiGridContainer');
    const counts = {
        surv: reports.filter(r => r.activityType === 'Routine Surveillance').length,
        gsdp: reports.filter(r => r.activityType === 'GSDP').length,
        meeting: reports.filter(r => r.activityType === 'Consultative Meeting').length
    };

    const kpis = [
        { label: "Routine Surveillance", value: counts.surv, target: targets.targetSurveillance },
        { label: "GSDP Inspections", value: counts.gsdp, target: targets.targetGsdp },
        { label: "Technical Meetings", value: counts.meeting, target: targets.targetMeetings }
    ];

    container.innerHTML = kpis.map(kpi => {
        const perc = Math.round((kpi.value / kpi.target) * 100);
        return `
        <div class="kpi-card">
            <div class="kpi-title">${kpi.label}</div>
            <div class="kpi-progress-bar"><div class="kpi-progress ${perc >= 100 ? 'complete' : ''}" style="width: ${Math.min(perc, 100)}%;"></div></div>
            <div class="flex" style="justify-content: space-between;">
                <span class="kpi-values">${kpi.value} / ${kpi.target}</span>
                <span class="kpi-percentage font-bold">${perc}%</span>
            </div>
        </div>`;
    }).join('');
}

function renderStatCards(data) {
    const cards = [
        { title: "Total National Reports", value: data.length },
        { title: "Facilities Monitored", value: new Set(data.map(r => r.facilityName)).size },
        { title: "States Active", value: new Set(data.map(r => r.state)).size },
        { title: "Enforcement Actions", value: data.filter(r => r.mopUp === 'true' || r.gsdv === 'true').length }
    ];
    document.getElementById('statCardsContainer').innerHTML = cards.map(c => `
        <div class="stat-card">
            <div class="stat-card-title">${c.title}</div>
            <div class="stat-card-value">${c.value.toLocaleString()}</div>
        </div>`).join('');
}

function renderLeaderboard(reports) {
    const container = document.getElementById('leaderboardContainer');
    const counts = {};
    reports.forEach(r => {
        (r.inspectorNames || []).forEach(name => {
            counts[name] = (counts[name] || 0) + 1;
        });
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (sorted.length === 0) {
        container.innerHTML = '<p class="muted small text-center">No inspector data available.</p>';
        return;
    }

    const max = sorted[0][1];
    container.innerHTML = sorted.map((entry, i) => {
        const perc = (entry[1] / max) * 100;
        let trophy = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
        return `
        <div class="leaderboard-item">
            <div class="leaderboard-meta">
                <div class="leaderboard-name"><strong>${i + 1}. ${entry[0]}</strong> ${trophy}</div>
                <div class="leaderboard-score">${entry[1]} <span>reports</span></div>
            </div>
            <div class="leaderboard-bar-bg"><div class="leaderboard-bar-fill" style="width: ${perc}%; background: var(--accent);"></div></div>
        </div>`;
    }).join('');
}

function renderTable(data) {
    const container = document.getElementById('tableContainer');
    if (data.length === 0) {
        container.innerHTML = '<p class="muted text-center" style="padding: 20px;">No records found matching filters.</p>';
        return;
    }

    const html = [`<table><thead><tr><th>Date</th><th>Zone/State</th><th>Facility</th><th>Activity</th><th>Officers</th></tr></thead><tbody>`];
    data.forEach(r => {
        const date = r.inspectionDate && r.inspectionDate.toDate ? r.inspectionDate.toDate().toLocaleDateString() : 'N/A';
        const location = `${r.zone ? r.zone.split(' ')[1] : ''}/${r.state || ''}`;
        const officers = (r.inspectorNames || []).slice(0, 2).join(', ') + (r.inspectorNames && r.inspectorNames.length > 2 ? '...' : '');

        html.push(`
        <tr onclick="window.showReportDetail('${r.id}')">
            <td>${date}</td>
            <td><strong>${location}</strong></td>
            <td>${r.facilityName || 'N/A'}</td>
            <td>${r.activityType || 'N/A'}</td>
            <td class="small">${officers}</td>
        </tr>`);
    });
    html.push('</tbody></table>');
    container.innerHTML = html.join('');
}

// ─── VISUAL CHARTS ──────────────────────────────────────────────────────────

function buildCharts(data) {
    // 1. Activity Distribution (Pie)
    const actCounts = {};
    data.forEach(r => actCounts[r.activityType] = (actCounts[r.activityType] || 0) + 1);
    
    if (chartActivities) chartActivities.destroy();
    chartActivities = new Chart(document.getElementById('chartActivities'), {
        type: 'pie',
        data: {
            labels: Object.keys(actCounts),
            datasets: [{ data: Object.values(actCounts), backgroundColor: ['#008751', '#006b3f', '#28a745', '#718096', '#2d3748', '#e53e3e', '#f6ad55'] }]
        },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }
    });

    // 2. Mop Up / GSDV (Bar)
    const mopCount = data.filter(r => r.mopUp === 'true').length;
    const gsdvCount = data.filter(r => r.gsdv === 'true').length;
    const sancCount = data.filter(r => r.docUrl).length;

    if (chartMopHold) chartMopHold.destroy();
    chartMopHold = new Chart(document.getElementById('chartMopHold'), {
        type: 'bar',
        data: {
            labels: ['Mop-Ups', 'GSDV Done', 'Docs Uploaded'],
            datasets: [{ label: 'National Volume', data: [mopCount, gsdvCount, sancCount], backgroundColor: '#008751' }]
        },
        options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });

    // 3. GSDP (Donut)
    if (chartGsdp) chartGsdp.destroy();
    chartGsdp = new Chart(document.getElementById('chartGsdp'), {
        type: 'doughnut',
        data: {
            labels: ['Routine', 'GSDP'],
            datasets: [{ data: [data.filter(r => r.activityType === 'Routine Surveillance').length, data.filter(r => r.activityType === 'GSDP').length], backgroundColor: ['#008751', '#f6ad55'] }]
        }
    });

    // 4. Sanctions Line (By Month)
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthCounts = Array(12).fill(0);
    data.forEach(r => {
        if (r.month) monthCounts[r.month - 1]++;
    });

    if (chartSanctions) chartSanctions.destroy();
    chartSanctions = new Chart(document.getElementById('chartSanctions'), {
        type: 'line',
        data: {
            labels: months,
            datasets: [{ label: 'Submissions', data: monthCounts, borderColor: '#008751', tension: 0.3 }]
        }
    });
}

// ─── UTILITIES (GLOBAL) ─────────────────────────────────────────────────────

window.showReportDetail = (id) => {
    const r = lastLoadedReports.find(x => x.id === id);
    if (!r) return;

    const modal = document.getElementById('modalContainer');
    const date = r.inspectionDate && r.inspectionDate.toDate ? r.inspectionDate.toDate().toLocaleString() : 'N/A';
    const submissionDate = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleString() : 'N/A';

    modal.innerHTML = `
    <div class="modal-backdrop" onclick="this.remove()">
        <div class="modal-content animate-fade-in" onclick="event.stopPropagation()">
            <div class="modal-header">
                <h3 style="margin:0; text-transform:uppercase;">Intelligence Dossier</h3>
                <button onclick="this.closest('.modal-backdrop').remove()" style="background:none; color:#000; font-size:24px;">&times;</button>
            </div>
            <div style="padding: 12px 0;">
                <p><strong>Facility:</strong> ${r.facilityName || 'N/A'}</p>
                <p><strong>Address:</strong> ${r.facilityAddress || 'N/A'}</p>
                <p><strong>Location:</strong> ${r.zone} / ${r.state}</p>
                <p><strong>Activity:</strong> <span class="badge" style="background:#f0fff4; border:1px solid var(--accent); padding:2px 8px; font-weight:bold; color:var(--accent);">${r.activityType}</span></p>
                <hr style="border:0; border-top:1px solid #eee; margin:16px 0;">
                <p><strong>Officers Involved:</strong><br>${(r.inspectorNames || []).join(', ')}</p>
                <p><strong>Product Types:</strong> ${(r.productTypes || []).join(', ')}</p>
                <p><strong>Mop up:</strong> ${r.mopUp === 'true' ? '✅ YES' : '❌ No'}</p>
                <p><strong>GSDV:</strong> ${r.gsdv === 'true' ? '✅ YES' : '❌ No'}</p>
                <p><strong>Sanction Doc:</strong> ${r.docUrl ? `<a href="${r.docUrl}" target="_blank" style="color:var(--accent); text-decoration:underline;">View Document</a>` : 'None'}</p>
                <hr style="border:0; border-top:1px solid #eee; margin:16px 0;">
                <p><strong>Findings / Action Taken:</strong></p>
                <div style="background:#f9f9f9; padding:12px; border-left:4px solid var(--accent); white-space:pre-wrap;">${r.actionTaken || 'No additional remarks.'}</div>
                <div class="muted small" style="margin-top:20px; border-top:1px dashed #ddd; padding-top:12px;">
                    Report ID: ${r.id}<br>
                    Inspection Date: ${date}<br>
                    Intelligence Synced: ${submissionDate} by ${r.createdByName}
                </div>
            </div>
            <div class="controls" style="justify-content:flex-end; margin-top:24px;">
                <button onclick="this.closest('.modal-backdrop').remove()">Close Dossier</button>
            </div>
        </div>
    </div>`;
};

function exportToCSV() {
    if (lastLoadedReports.length === 0) return alert("No data to export.");

    const headers = ["Date", "Zone", "State", "Facility", "Activity", "Officers", "MopUp", "GSDV", "Remarks"];
    const rows = lastLoadedReports.map(r => [
        r.inspectionDate && r.inspectionDate.toDate ? r.inspectionDate.toDate().toLocaleDateString() : 'N/A',
        r.zone || '',
        r.state || '',
        (r.facilityName || '').replace(/,/g, ''),
        r.activityType || '',
        (r.inspectorNames || []).join('; '),
        r.mopUp || 'false',
        r.gsdv || 'false',
        (r.actionTaken || '').replace(/,/g, '').replace(/\n/g, ' ')
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `National_Intelligence_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
}
