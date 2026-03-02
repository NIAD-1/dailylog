import { db, collection, getDocs, query, where, orderBy, doc, getDoc } from "./db.js";
import { clearRoot, navigate } from "./ui.js";

function getWeekMonday(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function toISODate(d) { return d.toISOString().split('T')[0]; }

function formatWeekRange(monday) {
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 6);
    const opts = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${monday.toLocaleDateString('en-GB', opts)} – ${friday.toLocaleDateString('en-GB', opts)}`;
}

export async function renderWeeklySummaryPage(root) {
    clearRoot(root);

    const monday = getWeekMonday();
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    root.innerHTML = `
    <section class="card" style="max-width:900px;margin:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px">
            <div>
                <h2 style="margin:0;color:var(--accent)">📊 Weekly Activity Summary</h2>
                <p class="muted" style="margin:4px 0 0 0;font-size:13px">All inspection activities logged by users</p>
            </div>
            <button id="backFromWeekly" class="secondary" style="padding:8px 16px;font-size:13px">← Back</button>
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:8px">
                <label style="font-size:13px;font-weight:600">Week starting:</label>
                <input type="date" id="weekStartPicker" value="${toISODate(monday)}" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px">
            </div>
            <button id="loadWeekBtn" style="padding:8px 20px">Load Week</button>
            <button id="prevWeekBtn" class="secondary" style="padding:8px 14px">◀ Prev</button>
            <button id="nextWeekBtn" class="secondary" style="padding:8px 14px">Next ▶</button>
        </div>

        <div id="weeklyContent">
            <div style="text-align:center;padding:40px;color:var(--secondary-text)">Click "Load Week" to view summary</div>
        </div>
    </section>`;

    document.getElementById('backFromWeekly').addEventListener('click', () => navigate('welcome'));

    const picker = document.getElementById('weekStartPicker');
    document.getElementById('loadWeekBtn').addEventListener('click', () => loadWeek(root, picker.value));
    document.getElementById('prevWeekBtn').addEventListener('click', () => {
        const d = new Date(picker.value);
        d.setDate(d.getDate() - 7);
        picker.value = toISODate(d);
        loadWeek(root, picker.value);
    });
    document.getElementById('nextWeekBtn').addEventListener('click', () => {
        const d = new Date(picker.value);
        d.setDate(d.getDate() + 7);
        picker.value = toISODate(d);
        loadWeek(root, picker.value);
    });

    // Auto-load current week
    loadWeek(root, toISODate(monday));
}

async function loadWeek(root, weekStartStr) {
    const content = document.getElementById('weeklyContent');
    content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--accent)">⏳ Loading reports...</div>`;

    const weekStart = new Date(weekStartStr);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    let reports = [];
    try {
        const snap = await getDocs(query(
            collection(db, 'facilityReports'),
            where('inspectionDate', '>=', weekStart),
            where('inspectionDate', '<', weekEnd),
            orderBy('inspectionDate', 'asc')
        ));
        snap.forEach(d => reports.push({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error('Error loading reports:', e);
        content.innerHTML = `<p style="color:red">Error loading reports: ${e.message}</p>`;
        return;
    }

    const weekLabel = formatWeekRange(weekStart);
    renderSummary(content, reports, weekLabel, weekStart);
}

function renderSummary(content, reports, weekLabel, weekStart) {
    if (reports.length === 0) {
        content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--secondary-text)">No activities logged for <strong>${weekLabel}</strong></div>`;
        return;
    }

    // --- Aggregate stats ---
    const byActivity = {};
    const byArea = {};
    const byInspector = {};
    let totalMopUp = 0, totalHold = 0, totalSanctions = 0, totalSamples = 0;

    reports.forEach(r => {
        // By activity
        byActivity[r.activityType] = (byActivity[r.activityType] || 0) + 1;
        // By area
        const area = r.area || 'Unknown';
        byArea[area] = (byArea[area] || 0) + 1;
        // By inspector
        const inspectors = Array.isArray(r.inspectorNames) ? r.inspectorNames : [r.inspectorNames || 'Unknown'];
        inspectors.forEach(name => {
            byInspector[name] = (byInspector[name] || 0) + 1;
        });
        // Actions
        totalMopUp += r.mopUpCount || 0;
        totalHold += r.holdCount || 0;
        if (r.sanctionGiven) totalSanctions++;
        totalSamples += r.Samplescount || 0;
    });

    const activityRows = Object.entries(byActivity).sort((a, b) => b[1] - a[1])
        .map(([act, count]) => `<tr><td>${act}</td><td style="text-align:right;font-weight:700;color:var(--accent)">${count}</td></tr>`).join('');

    const areaRows = Object.entries(byArea).sort((a, b) => b[1] - a[1])
        .map(([area, count]) => `<tr><td>${area}</td><td style="text-align:right;font-weight:700">${count}</td></tr>`).join('');

    const inspectorRows = Object.entries(byInspector).sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `<tr><td>${name}</td><td style="text-align:right;font-weight:700">${count}</td></tr>`).join('');

    const reportRows = reports.map(r => {
        const date = r.inspectionDate?.toDate ? r.inspectionDate.toDate().toLocaleDateString('en-GB') : (r.inspectionDate || '—');
        const inspectors = Array.isArray(r.inspectorNames) ? r.inspectorNames.join(', ') : (r.inspectorNames || '—');
        const actions = [
            r.mopUpCount > 0 ? `🔴 Mop-up: ${r.mopUpCount}` : '',
            r.holdCount > 0 ? `🟡 Hold: ${r.holdCount}` : '',
            r.sanctionGiven ? '⚖️ Sanction' : '',
            r.Samplescount > 0 ? `🧪 Samples: ${r.Samplescount}` : ''
        ].filter(Boolean).join(' · ') || '—';
        return `<tr>
            <td style="font-size:12px">${date}</td>
            <td style="font-weight:600;font-size:12px">${r.facilityName || '—'}</td>
            <td style="font-size:12px;color:var(--secondary-text)">${r.area || '—'}</td>
            <td><span style="background:#e8f5e9;padding:2px 6px;border-radius:3px;font-size:11px;color:#2e7d32;white-space:nowrap">${r.activityType || '—'}</span></td>
            <td style="font-size:11px;color:var(--secondary-text)">${inspectors}</td>
            <td style="font-size:11px">${actions}</td>
        </tr>`;
    }).join('');

    content.innerHTML = `
        <!-- KPI cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:24px">
            ${kpiCard('📋', 'Total', reports.length, '#2e7d32')}
            ${kpiCard('🔴', 'Mop-ups', totalMopUp, '#c62828')}
            ${kpiCard('🟡', 'Holds', totalHold, '#f9a825')}
            ${kpiCard('⚖️', 'Sanctions', totalSanctions, '#6a1b9a')}
            ${kpiCard('🧪', 'Samples', totalSamples, '#0277bd')}
        </div>

        <!-- Breakdown grids -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px">
            <div>
                <h4 style="margin:0 0 8px 0;font-size:13px;color:var(--secondary-text);text-transform:uppercase;letter-spacing:0.5px">By Activity</h4>
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    ${activityRows}
                </table>
            </div>
            <div>
                <h4 style="margin:0 0 8px 0;font-size:13px;color:var(--secondary-text);text-transform:uppercase;letter-spacing:0.5px">By Area</h4>
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    ${areaRows}
                </table>
            </div>
            <div>
                <h4 style="margin:0 0 8px 0;font-size:13px;color:var(--secondary-text);text-transform:uppercase;letter-spacing:0.5px">By Inspector</h4>
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    ${inspectorRows}
                </table>
            </div>
        </div>

        <!-- Detailed table -->
        <h4 style="margin:0 0 10px 0;font-size:13px;color:var(--secondary-text);text-transform:uppercase;letter-spacing:0.5px">All Logged Activities (${reports.length})</h4>
        <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead>
                    <tr style="background:#f7fafc;text-align:left">
                        <th style="padding:8px;border-bottom:2px solid #e2e8f0">Date</th>
                        <th style="padding:8px;border-bottom:2px solid #e2e8f0">Facility</th>
                        <th style="padding:8px;border-bottom:2px solid #e2e8f0">Area</th>
                        <th style="padding:8px;border-bottom:2px solid #e2e8f0">Activity</th>
                        <th style="padding:8px;border-bottom:2px solid #e2e8f0">Inspectors</th>
                        <th style="padding:8px;border-bottom:2px solid #e2e8f0">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportRows}
                </tbody>
            </table>
        </div>

        <!-- Send to Teams -->
        <div style="margin-top:24px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <button id="sendToTeamsBtn" style="padding:10px 24px;background:#6264a7;color:white;border:none;border-radius:6px;font-size:14px;cursor:pointer">
                📣 Send Summary to Teams
            </button>
            <span id="teamsStatus" style="font-size:13px;color:var(--secondary-text)"></span>
        </div>
    `;

    // Bind Teams send button
    document.getElementById('sendToTeamsBtn').addEventListener('click', () =>
        sendToTeams(reports, weekLabel, { total: reports.length, totalMopUp, totalHold, totalSanctions, totalSamples, byActivity, byArea, byInspector })
    );
}

function kpiCard(icon, label, value, color) {
    return `<div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;border-left:4px solid ${color}">
        <div style="font-size:22px;font-weight:900;color:${color}">${value}</div>
        <div style="font-size:11px;color:var(--secondary-text);margin-top:4px">${icon} ${label}</div>
    </div>`;
}

async function sendToTeams(reports, weekLabel, stats) {
    const statusEl = document.getElementById('teamsStatus');
    const btn = document.getElementById('sendToTeamsBtn');
    statusEl.textContent = 'Fetching webhook...';
    btn.disabled = true;

    try {
        // Get webhook URL from settings
        const settingsSnap = await getDoc(doc(db, 'settings', 'kpiTargets'));
        const webhookUrl = settingsSnap.exists() ? (settingsSnap.data().weeklyWebhookUrl || settingsSnap.data().webhookUrl) : null;

        if (!webhookUrl) {
            statusEl.textContent = '❌ No webhook URL configured. Add one in Settings.';
            btn.disabled = false;
            return;
        }

        // Build activity breakdown text
        const activityLines = Object.entries(stats.byActivity)
            .sort((a, b) => b[1] - a[1])
            .map(([act, count]) => `• ${act}: **${count}**`)
            .join('\n');

        const inspectorLines = Object.entries(stats.byInspector)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, count]) => `• ${name}: ${count}`)
            .join('\n');

        // Microsoft Teams Adaptive Card payload
        const payload = {
            type: 'message',
            attachments: [{
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: {
                    type: 'AdaptiveCard',
                    version: '1.4',
                    body: [
                        {
                            type: 'Container',
                            style: 'emphasis',
                            items: [{
                                type: 'TextBlock',
                                text: '📊 NAFDAC PMS — Weekly Activity Summary',
                                weight: 'Bolder',
                                size: 'Large',
                                color: 'Accent'
                            }, {
                                type: 'TextBlock',
                                text: `Week: ${weekLabel}`,
                                isSubtle: true,
                                spacing: 'None'
                            }]
                        },
                        {
                            type: 'ColumnSet',
                            columns: [
                                { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: `**${stats.total}**\nTotal Inspections`, wrap: true }] },
                                { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: `**${stats.totalMopUp}**\nMop-ups`, wrap: true }] },
                                { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: `**${stats.totalHold}**\nHolds`, wrap: true }] },
                                { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: `**${stats.totalSanctions}**\nSanctions`, wrap: true }] },
                                { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: `**${stats.totalSamples}**\nSamples`, wrap: true }] }
                            ]
                        },
                        { type: 'TextBlock', text: '**By Activity Type**', weight: 'Bolder', spacing: 'Medium' },
                        { type: 'TextBlock', text: activityLines || 'None', wrap: true },
                        { type: 'TextBlock', text: '**By Inspector**', weight: 'Bolder', spacing: 'Medium' },
                        { type: 'TextBlock', text: inspectorLines || 'None', wrap: true },
                        {
                            type: 'TextBlock',
                            text: `Generated ${new Date().toLocaleString()} | NAFDAC PMS Portal`,
                            isSubtle: true,
                            size: 'Small',
                            spacing: 'Medium'
                        }
                    ]
                }
            }]
        };

        const resp = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (resp.ok || resp.status === 202) {
            statusEl.textContent = '✅ Summary sent to Teams!';
            statusEl.style.color = '#2e7d32';
        } else {
            throw new Error(`HTTP ${resp.status}`);
        }
    } catch (e) {
        console.error('Teams send error:', e);
        statusEl.textContent = `❌ Failed: ${e.message}`;
        statusEl.style.color = 'red';
    } finally {
        btn.disabled = false;
    }
}
