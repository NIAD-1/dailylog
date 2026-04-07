import { db, collection, query, orderBy, onSnapshot } from "./db.js";

/**
 * Renders the Live Movement dashboard to track reports across the approval chain.
 */
export function renderWorkflowPage(root) {
    root.innerHTML = `
    <section class="card" style="max-width: 1200px; margin: auto;">
        <div class="flex" style="justify-content: space-between; align-items: start; margin-bottom: 32px;">
            <div>
                <h2 style="color: var(--accent); margin: 0;">🚦 Live Report Movement</h2>
                <p class="muted">Real-time status of all reports currently in the approval pipeline.</p>
            </div>
            <button class="secondary" onclick="window.history.back()">← Back</button>
        </div>

        <div id="workflowStats" class="workflow-stats-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px;">
            <div class="stat-box">
                <span class="stat-label">TOTAL ACTIVE</span>
                <strong id="statActive">0</strong>
            </div>
            <div class="stat-box" style="border-left: 4px solid #F59E0B;">
                <span class="stat-label">WITH INSPECTORS</span>
                <strong id="statInspector">0</strong>
            </div>
            <div class="stat-box" style="border-left: 4px solid #10B981;">
                <span class="stat-label">WITH DIRECTOR</span>
                <strong id="statDirector">0</strong>
            </div>
            <div class="stat-box" style="border-left: 4px solid #EF4444;">
                <span class="stat-label">OVERDUE (>48h)</span>
                <strong id="statOverdue">0</strong>
            </div>
        </div>

        <div style="margin-bottom: 16px; display: flex; gap: 12px; align-items: center;">
             <input type="text" id="workflowSearch" placeholder="Search Facility, Activity or Holder..." style="flex: 1; padding: 12px;">
             <select id="statusFilter" style="width: 200px;">
                <option value="ALL">All Active</option>
                <option value="With Inspector">With Inspector</option>
                <option value="With Director">With Director</option>
                <option value="Approved">Approved (Last 24h)</option>
             </select>
        </div>

        <div id="workflowList" class="workflow-list-container">
            <div style="text-align: center; padding: 60px; color: #718096;">
                <div class="loader-spinner"></div>
                <p>Establishing real-time connection to pipeline...</p>
            </div>
        </div>
    </section>

    <style>
        .workflow-stats-grid .stat-box {
            background: #f8fafc;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            text-align: center;
        }
        .stat-label { font-size: 11px; font-weight: 700; color: #64748b; display: block; margin-bottom: 4px; }
        .stat-box strong { font-size: 28px; color: var(--primary); }

        .wf-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            margin-bottom: 16px;
            padding: 20px;
            display: grid;
            grid-template-columns: 2fr 1fr 2fr 1fr;
            align-items: center;
            gap: 20px;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .wf-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .wf-card.overdue { border-left: 6px solid #EF4444; background: #FFF5F5; }

        .wf-info-title { font-weight: 800; font-size: 16px; color: var(--primary); display: block; }
        .wf-info-sub { font-size: 13px; color: #64748b; }

        .progress-track {
            height: 10px;
            background: #e2e8f0;
            border-radius: 5px;
            position: relative;
            overflow: hidden;
        }
        .progress-bar {
            height: 100%;
            background: var(--accent);
            width: 0%;
            transition: width 0.8s ease-in-out;
        }
        .progress-bar.director { background: #10B981; }
        .progress-bar.inspector { background: #F59E0B; }

        .wf-status-pill {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
        }
        .pill-inspector { background: #FEF3C7; color: #92400E; }
        .pill-director { background: #D1FAE5; color: #065F46; }
        .pill-approved { background: #DBEAFE; color: #1E40AF; }

        .loader-spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid var(--accent);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
    `;

    bindWorkflowLogic();
}

async function bindWorkflowLogic() {
    const listEl = document.getElementById("workflowList");
    const searchInput = document.getElementById("workflowSearch");
    const statusFilter = document.getElementById("statusFilter");
    
    const sActive = document.getElementById("statActive");
    const sInspector = document.getElementById("statInspector");
    const sDirector = document.getElementById("statDirector");
    const sOverdue = document.getElementById("statOverdue");

    // Real-time listener on workflow_tracking collection
    const q = query(collection(db, "workflow_tracking"), orderBy("updatedAt", "desc"));
    
    onSnapshot(q, (snapshot) => {
        const reports = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data._id = doc.id;
            reports.push(data);
        });

        const render = () => {
            const query = searchInput.value.toLowerCase();
            const filter = statusFilter.value;

            const filtered = reports.filter(r => {
                const matchesSearch = (r.facilityName || "").toLowerCase().includes(query) || 
                                     (r.activityType || "").toLowerCase().includes(query) || 
                                     (r.currentHolder || "").toLowerCase().includes(query);
                const matchesFilter = filter === "ALL" ? r.status !== "Approved" : r.status === filter;
                return matchesSearch && matchesFilter;
            });

            // Update Stats
            const now = Date.now();
            sActive.textContent = reports.filter(r => r.status !== "Approved").length;
            sInspector.textContent = reports.filter(r => r.status === "With Inspector").length;
            sDirector.textContent = reports.filter(r => r.status === "With Director").length;
            
            const over48h = reports.filter(r => {
                if (r.status === "Approved") return false;
                const start = r.stepStartedAt ? new Date(r.stepStartedAt).getTime() : 0;
                return (now - start) > (48 * 60 * 60 * 1000);
            }).length;
            sOverdue.textContent = over48h;

            if (filtered.length === 0) {
                listEl.innerHTML = `<div style="text-align:center; padding:40px; color:#94a3b8">No matching reports in the pipeline.</div>`;
                return;
            }

            listEl.innerHTML = filtered.map(r => {
                const start = r.stepStartedAt ? new Date(r.stepStartedAt) : new Date();
                const diffH = Math.floor((now - start.getTime()) / (3600 * 1000));
                const isOverdue = diffH > 48 && r.status !== "Approved";
                
                let progress = "0%";
                let barClass = "";
                let pillClass = "";
                let displayStatus = r.status;
                let dynamicStyle = "";
                
                if (r.status.startsWith("With Inspector")) { 
                    progress = "33%"; 
                    barClass = "inspector"; 
                    pillClass = "pill-inspector"; 
                    displayStatus = "With Inspector";

                    const match = r.status.match(/\((\d+)\s*of\s*(\d+)\)/i);
                    if (match) {
                        const current = parseInt(match[1]);
                        const total = parseInt(match[2]);
                        if (total > 0) {
                            // Base 33%, max 66% before Director
                            const fraction = (current - 1) / total;
                            const percentage = Math.floor(33 + (33 * fraction));
                            progress = percentage + "%";
                            displayStatus = `With Inspector (${current}/${total})`;
                            
                            // Dynamic color transition from Amber(38) to Sky Blue(200)
                            const hue = Math.floor(38 + (fraction * 162));
                            dynamicStyle = `background-color: hsl(${hue}, 90%, 50%) !important;`;
                        }
                    }
                }
                else if (r.status === "With Director") { progress = "66%"; barClass = "director"; pillClass = "pill-director"; }
                else if (r.status === "Approved") { progress = "100%"; barClass = "director"; pillClass = "pill-approved"; }

                let displayHolder = r.currentHolder || "N/A";
                if (displayHolder.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(displayHolder);
                        if (parsed.name) displayHolder = parsed.name;
                    } catch (e) {}
                }

                return `
                <div class="wf-card ${isOverdue ? 'overdue' : ''}">
                    <div>
                        <span class="wf-info-title">${r.facilityName}</span>
                        <span class="wf-info-sub">${r.activityType}</span>
                    </div>
                    <div>
                        <span class="wf-status-pill ${pillClass}">${displayStatus}</span>
                    </div>
                    <div style="padding: 0 20px;">
                        <div style="display:flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; font-weight: 600; color: #718096;">
                            <span>Progress</span>
                            <span>${progress}</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-bar ${barClass}" style="width: ${progress}; ${dynamicStyle}"></div>
                        </div>
                        <div class="wf-info-sub" style="margin-top: 4px; font-size: 11px;">
                            Currently with: <strong>${displayHolder}</strong>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div class="wf-info-title" style="font-size: 20px; ${isOverdue ? 'color:#EF4444' : ''}">${diffH}h</div>
                        <div class="wf-info-sub">Aging Time</div>
                    </div>
                </div>`;
            }).join("");
        };

        render();
        searchInput.oninput = render;
        statusFilter.onchange = render;
    });
}
