/**
 * Reusable Activity Hub Engine
 * Implements the 4-Pillar View:
 * 1. Dashboard & Analytics (Year Filter, KPIs, Heuristic Insights, Charts)
 * 2. Records Ledger (Search, Filter, Excel-matched Table, Teams Link, CSV Export)
 * 3. Log / Docket (Intake form or Continuous Docket for Complaints)
 * 4. Facility Profile link-through
 */

import { db, collection, addDoc, doc, getDoc, getDocs, query, where, orderBy, setDoc, serverTimestamp } from "./db.js";
import { currentUser, currentUserRole } from "./auth.js";
import { navigate } from "./ui.js";

// Keep track of active Chart.js instances to avoid canvas reuse errors
const activeCharts = {};

export async function renderActivityHub(root, config) {
  // 1. Fetch settings for Teams base URL
  let sharepointBaseUrl = "";
  try {
    const snap = await getDoc(doc(db, "settings", "kpiTargets"));
    if (snap.exists()) {
      sharepointBaseUrl = snap.data().sharepointBaseUrl || "";
    }
  } catch (e) {
    console.warn("Could not load settings:", e);
  }

  // 2. Render Page Frame
  root.innerHTML = `
    <div class="hub-page">
      <div class="hub-header">
        <div>
          <h1>${escapeHTML(config.title)}</h1>
          <p class="muted" style="margin-top:4px; font-size:14px;">${escapeHTML(config.subtitle || "")}</p>
        </div>
        <div class="hub-header-actions">
          <button id="hubExportCsvBtn" class="secondary" style="display:flex;align-items:center;gap:6px;">
            <svg style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Export CSV
          </button>
          <button id="hubRefreshBtn" class="secondary" style="padding:10px 14px !important;">↻</button>
        </div>
      </div>

      <div class="hub-tabs">
        <button class="hub-tab active" data-tab="dashboard">Dashboard & Analytics</button>
        <button class="hub-tab" data-tab="records">Records Ledger</button>
        <button class="hub-tab" data-tab="log">${config.isDocket ? "Case Docket & Log" : "Log Activity"}</button>
      </div>

      <!-- Tab 1: Dashboard -->
      <div id="hubTabDashboard" class="hub-tab-panel">
        <div class="hub-filters">
          <div class="hub-filter-group" style="max-width:180px;">
            <label>Filter by Year</label>
            <select id="hubYearFilter">
              <option value="ALL">All Recorded Years</option>
            </select>
          </div>
        </div>

        <div id="hubStatsGrid" class="hub-stats-grid">
          <!-- KPI Cards injected here -->
        </div>

        <div id="hubInsightsBox" class="hub-insights">
          <div class="hub-insights-title">Automated Directorate Insights</div>
          <div id="hubInsightsList">
            <div class="muted small">Loading intelligence telemetry...</div>
          </div>
        </div>

        <div id="hubChartsGrid" class="hub-charts-grid">
          <!-- Chart canvases dynamically injected here -->
        </div>
      </div>

      <!-- Tab 2: Records Ledger -->
      <div id="hubTabRecords" class="hub-tab-panel" style="display:none;">
        <div class="hub-filters">
          <div class="hub-filter-group" style="flex:2;">
            <label>Search Records</label>
            <input type="text" id="hubSearchInput" placeholder="Search facility, reference code, product, officer, action...">
          </div>
          <div class="hub-filter-group" style="max-width:160px;">
            <label>Year</label>
            <select id="hubRecordsYearFilter">
              <option value="ALL">All Years</option>
            </select>
          </div>
          ${config.statuses ? `
          <div class="hub-filter-group" style="max-width:180px;">
            <label>Status</label>
            <select id="hubRecordsStatusFilter">
              <option value="ALL">All Statuses</option>
              ${config.statuses.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join("")}
            </select>
          </div>` : ""}
        </div>

        <div class="hub-table-wrap">
          <table class="hub-table">
            <thead>
              <tr id="hubTableHead"></tr>
            </thead>
            <tbody id="hubTableBody">
              <tr><td colspan="10" style="text-align:center;padding:40px;" class="muted">Loading records...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tab 3: Log / Docket -->
      <div id="hubTabLog" class="hub-tab-panel" style="display:none;">
        <div id="hubLogContainer"></div>
      </div>
    </div>
  `;

  // 3. Tab Switching
  const tabs = root.querySelectorAll(".hub-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const target = tab.dataset.tab;
      root.querySelector("#hubTabDashboard").style.display = target === "dashboard" ? "block" : "none";
      root.querySelector("#hubTabRecords").style.display = target === "records" ? "block" : "none";
      root.querySelector("#hubTabLog").style.display = target === "log" ? "block" : "none";

      if (target === "dashboard") renderCharts(cachedItems, config);
    });
  });

  // 4. Data State
  let cachedItems = [];

  // Function to load all records for this activity
  async function loadData() {
    try {
      let q;
      if (config.activityFilter) {
        // e.g. Routine Surveillance inside facilityReports
        q = query(
          collection(db, config.collection),
          where("activityType", "==", config.activityFilter),
          orderBy("inspectionDate", "desc")
        );
      } else {
        q = query(collection(db, config.collection));
      }

      const snap = await getDocs(q);
      cachedItems = snap.docs.map(docSnap => ({
        _id: docSnap.id,
        ...docSnap.data()
      }));

      // Sort in-memory if needed (for collections without composite indices)
      cachedItems.sort((a, b) => {
        const dateA = a.dateReceived || a.inspectionDate || a.dateOfVisit || a.dateLogged || a.createdAt || "";
        const dateB = b.dateReceived || b.inspectionDate || b.dateOfVisit || b.dateLogged || b.createdAt || "";
        return String(dateB).localeCompare(String(dateA));
      });

      populateYearFilters(cachedItems);
      updateDashboard(cachedItems, config);
      updateRecordsTable(cachedItems, config, sharepointBaseUrl);
      updateLogTab(cachedItems, config);
    } catch (e) {
      console.error("Error loading activity data:", e);
      // If index error or fallback needed
      try {
        const snap = await getDocs(collection(db, config.collection));
        cachedItems = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        if (config.activityFilter) {
          cachedItems = cachedItems.filter(i => i.activityType === config.activityFilter);
        }
        populateYearFilters(cachedItems);
        updateDashboard(cachedItems, config);
        updateRecordsTable(cachedItems, config, sharepointBaseUrl);
        updateLogTab(cachedItems, config);
      } catch (err) {
        root.querySelector("#hubTableBody").innerHTML = `
          <tr><td colspan="10" style="text-align:center;color:var(--danger);padding:40px;">
            Error loading records: ${escapeHTML(err.message)}
          </td></tr>
        `;
      }
    }
  }

  // Populate Year Filter options
  function populateYearFilters(items) {
    const years = new Set();
    const currentYr = new Date().getFullYear();
    years.add(String(currentYr));

    items.forEach(item => {
      if (item.year) years.add(String(item.year));
      const rawDate = item.dateReceived || item.inspectionDate || item.dateOfVisit || item.dateLogged;
      if (rawDate) {
        const m = String(rawDate).match(/\b(20\d{2})\b/);
        if (m) years.add(m[1]);
      }
    });

    const sortedYears = Array.from(years).sort((a, b) => b.localeCompare(a));
    const yearSelect = root.querySelector("#hubYearFilter");
    const recordsYearSelect = root.querySelector("#hubRecordsYearFilter");

    const optionsHtml = `<option value="ALL">All Recorded Years</option>` +
      sortedYears.map(y => `<option value="${y}">${y}</option>`).join("");

    yearSelect.innerHTML = optionsHtml;
    recordsYearSelect.innerHTML = optionsHtml;

    yearSelect.onchange = () => {
      const yr = yearSelect.value;
      const filtered = yr === "ALL" ? cachedItems : filterByYear(cachedItems, yr);
      updateDashboard(filtered, config);
    };

    recordsYearSelect.onchange = applyRecordFilters;
  }

  function filterByYear(items, year) {
    return items.filter(item => {
      if (String(item.year) === String(year)) return true;
      const rawDate = item.dateReceived || item.inspectionDate || item.dateOfVisit || item.dateLogged;
      return rawDate && String(rawDate).includes(String(year));
    });
  }

  // 5. Update Dashboard (KPIs, Insights, Charts)
  function updateDashboard(items, cfg) {
    // KPI Cards
    const kpiBox = root.querySelector("#hubStatsGrid");
    kpiBox.innerHTML = cfg.kpis.map(k => {
      const val = k.calc(items);
      return `
        <div class="hub-stat-card ${k.color}">
          <div class="hub-stat-label">${escapeHTML(k.label)}</div>
          <div class="hub-stat-value">${val}</div>
        </div>
      `;
    }).join("");

    // Heuristic Insights
    const insightsBox = root.querySelector("#hubInsightsList");
    const insights = cfg.generateInsights ? cfg.generateInsights(items) : [];
    insightsBox.innerHTML = insights.map(i => `
      <div class="hub-insight-item">
        <div class="hub-insight-bullet"></div>
        <div>${escapeHTML(i)}</div>
      </div>
    `).join("");

    // Render Charts
    renderCharts(items, cfg);
  }

  function renderCharts(items, cfg) {
    const chartsGrid = root.querySelector("#hubChartsGrid");
    chartsGrid.innerHTML = cfg.charts.map(c => `
      <div class="hub-chart-card">
        <h3>${escapeHTML(c.title)}</h3>
        <div style="position:relative; height:240px;">
          <canvas id="${c.id}"></canvas>
        </div>
      </div>
    `).join("");

    // Initialize Chart.js
    cfg.charts.forEach(c => {
      const canvas = root.querySelector(`#${c.id}`);
      if (!canvas) return;

      if (activeCharts[c.id]) {
        activeCharts[c.id].destroy();
        delete activeCharts[c.id];
      }

      const chartData = c.generate(items);
      activeCharts[c.id] = new Chart(canvas, {
        type: c.type,
        data: chartData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: c.type === "doughnut" || c.type === "pie" ? "bottom" : "top" }
          },
          scales: c.type === "bar" ? { y: { beginAtZero: true, ticks: { precision: 0 } } } : undefined
        }
      });
    });
  }

  // 6. Update Records Ledger Table
  function updateRecordsTable(items, cfg, baseUrl) {
    const thead = root.querySelector("#hubTableHead");
    thead.innerHTML = cfg.columns.map(c => `<th>${escapeHTML(c.label)}</th>`).join("");
    renderTableRows(items, cfg, baseUrl);
  }

  function renderTableRows(items, cfg, baseUrl) {
    const tbody = root.querySelector("#hubTableBody");
    if (items.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="${cfg.columns.length}" style="text-align:center;padding:48px;" class="muted">
          No records matching current criteria.
        </td></tr>
      `;
      return;
    }

    tbody.innerHTML = items.map(item => `
      <tr data-id="${item._id}">
        ${cfg.columns.map(col => formatCell(item, col, baseUrl, cfg)).join("")}
      </tr>
    `).join("");

    // Bind Teams URL pencil edit buttons
    tbody.querySelectorAll(".hub-teams-edit").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const row = btn.closest("tr");
        const docId = row.dataset.id;
        const currentUrl = btn.dataset.current || "";
        const newUrl = prompt("Paste SharePoint / Teams Folder URL:", currentUrl);
        if (newUrl !== null) {
          try {
            await setDoc(doc(db, cfg.collection, docId), { teamsFolderUrl: newUrl.trim() }, { merge: true });
            const item = cachedItems.find(i => i._id === docId);
            if (item) item.teamsFolderUrl = newUrl.trim();
            applyRecordFilters();
          } catch (err) {
            alert("Could not update link: " + err.message);
          }
        }
      });
    });

    // Facility link-through
    tbody.querySelectorAll("[data-facility-link]").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const facName = el.dataset.facilityLink;
        if (facName) {
          navigate("facilities");
          setTimeout(() => {
            const input = document.getElementById("fpSearchInput");
            if (input) {
              input.value = facName;
              input.dispatchEvent(new Event("input"));
            }
          }, 200);
        }
      });
    });
  }

  function formatCell(item, col, baseUrl, cfg) {
    const val = item[col.key];

    if (col.format === "code") {
      return `<td><span style="font-family:monospace;font-weight:700;color:var(--accent-dark);">${escapeHTML(val || "—")}</span></td>`;
    }

    if (col.format === "bold") {
      const isFacility = col.key === "facilityName" || col.key === "name";
      if (isFacility && val) {
        return `<td><span data-facility-link="${escapeHTML(val)}" style="font-weight:700;color:var(--accent);cursor:pointer;">${escapeHTML(val)}</span></td>`;
      }
      return `<td><strong>${escapeHTML(val || "—")}</strong></td>`;
    }

    if (col.format === "badge") {
      const str = String(val || cfg.defaultStatus || "Open");
      let cls = "hub-status-open";
      if (str.toLowerCase().includes("investig") || str.toLowerCase().includes("cevi")) cls = "hub-status-investigation";
      if (str.toLowerCase().includes("close") || str.toLowerCase().includes("submit") || str.toLowerCase().includes("active") || str.toLowerCase().includes("cat a")) cls = "hub-status-closed";
      if (str.toLowerCase().includes("default") || str.toLowerCase().includes("overdue") || str.toLowerCase().includes("not located") || str.toLowerCase().includes("cat c")) cls = "hub-status-ongoing";
      return `<td><span class="hub-status-badge ${cls}">${escapeHTML(str)}</span></td>`;
    }

    if (col.format === "feedback") {
      if (item.feedbackIssued) {
        return `<td><span class="hub-status-badge hub-status-closed">✓ Feedback Issued (${escapeHTML(item.feedbackDate || "")})</span></td>`;
      }
      return `<td><span class="hub-status-badge hub-status-ongoing">Pending Feedback</span></td>`;
    }

    if (col.format === "teams") {
      let folderUrl = item.teamsFolderUrl;
      if (!folderUrl && baseUrl) {
        const facName = item.facilityName || item.outletVisited || item.complainant || item.name || "";
        if (facName) {
          const sanitized = facName.replace(/[."*:<>?\/\\|]/g, "").trim();
          folderUrl = `${baseUrl}${cfg.teamsRootFolder}/${encodeURIComponent(sanitized)}`;
        }
      }

      if (folderUrl) {
        return `
          <td style="white-space:nowrap;">
            <a href="${escapeHTML(folderUrl)}" target="_blank" rel="noopener" class="hub-teams-link">
              <svg style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Folder
            </a>
            <button class="hub-teams-edit" data-current="${escapeHTML(item.teamsFolderUrl || "")}" title="Override link">✎</button>
          </td>
        `;
      }
      return `
        <td>
          <button class="hub-teams-edit" data-current="" title="Set Teams Folder URL">+ Link</button>
        </td>
      `;
    }

    if (col.format === "date") {
      return `<td>${escapeHTML(formatDate(val))}</td>`;
    }

    if (col.format === "number") {
      return `<td><strong>${Number(val) || 0}</strong></td>`;
    }

    if (col.format === "boolean") {
      return `<td>${val ? '<span style="color:var(--danger);font-weight:700;">YES</span>' : "No"}</td>`;
    }

    return `<td>${escapeHTML(val || "—")}</td>`;
  }

  // Filter application
  function applyRecordFilters() {
    const search = (root.querySelector("#hubSearchInput").value || "").toLowerCase();
    const yr = root.querySelector("#hubRecordsYearFilter").value;
    const statusSelect = root.querySelector("#hubRecordsStatusFilter");
    const status = statusSelect ? statusSelect.value : "ALL";

    let filtered = cachedItems;

    if (yr !== "ALL") {
      filtered = filterByYear(filtered, yr);
    }

    if (status !== "ALL") {
      filtered = filtered.filter(i => (i.status || "").toLowerCase() === status.toLowerCase());
    }

    if (search) {
      filtered = filtered.filter(item => {
        const text = Object.values(item).join(" ").toLowerCase();
        return text.includes(search);
      });
    }

    renderTableRows(filtered, config, sharepointBaseUrl);
  }

  root.querySelector("#hubSearchInput").addEventListener("input", debounce(applyRecordFilters, 200));

  // 7. Update Log Tab
  function updateLogTab(items, cfg) {
    const container = root.querySelector("#hubLogContainer");

    // Case 1: Continuous Docket for Consumer Complaints
    if (cfg.isDocket) {
      renderComplaintDocket(container, items, cfg, sharepointBaseUrl);
      return;
    }

    // Case 2: Routine Surveillance redirects to Start New Log
    if (cfg.useWizardForLog) {
      container.innerHTML = `
        <div class="card" style="text-align:center;padding:60px 20px;max-width:600px;margin:auto;">
          <h2>Log Field Routine Surveillance</h2>
          <p class="muted" style="margin:16px 0;">Routine surveillance inspections are registered directly through the comprehensive Inspector Logging Wizard.</p>
          <button id="hubGoToWizardBtn" style="padding:14px 32px;font-size:16px;">Go to Start New Log</button>
        </div>
      `;
      container.querySelector("#hubGoToWizardBtn").onclick = () => navigate("report");
      return;
    }

    // Case 3: Dedicated Activity Intake Form
    renderStandardLogForm(container, cfg, loadData);
  }

  // CSV Export
  root.querySelector("#hubExportCsvBtn").onclick = () => {
    exportActivityCSV(cachedItems, config);
  };

  // Refresh
  root.querySelector("#hubRefreshBtn").onclick = loadData;

  // Initial load
  await loadData();
}

// ─── Continuous Complaint Docket Renderer ───────────────────────────────────────
async function renderComplaintDocket(container, complaints, cfg, baseUrl) {
  // Query all linked facility reports for all complaints
  let linkedReports = [];
  try {
    const snap = await getDocs(query(collection(db, "facilityReports"), where("activityType", "==", "Consumer Complaint")));
    linkedReports = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("Could not load linked reports:", e);
  }

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div>
        <h3 style="margin:0;">Active Complaint Dockets</h3>
        <p class="muted small" style="margin-top:4px;">Each complaint is a living case tracking inspections, consultative meetings, and complainant closure.</p>
      </div>
      <button id="hubNewComplaintBtn" class="success">+ Log New Complaint Intake</button>
    </div>

    <div id="hubDocketIntakeForm" style="display:none;margin-bottom:30px;" class="card">
      <h3>New Consumer Complaint Intake</h3>
      <div id="hubIntakeFormMount"></div>
    </div>

    <div id="hubDocketList">
      ${complaints.length === 0 ? '<div class="muted" style="padding:40px;text-align:center;">No complaint cases on docket.</div>' : ""}
    </div>
  `;

  // Toggle New Intake form
  const newBtn = container.querySelector("#hubNewComplaintBtn");
  const intakeForm = container.querySelector("#hubDocketIntakeForm");
  newBtn.onclick = () => {
    const isHidden = intakeForm.style.display === "none";
    intakeForm.style.display = isHidden ? "block" : "none";
    newBtn.textContent = isHidden ? "✕ Cancel Intake Form" : "+ Log New Complaint Intake";
    if (isHidden) {
      renderStandardLogForm(container.querySelector("#hubIntakeFormMount"), cfg, () => {
        intakeForm.style.display = "none";
        newBtn.textContent = "+ Log New Complaint Intake";
        renderActivityHub(document.getElementById("app"), cfg);
      });
    }
  };

  // Render Case Cards
  const docketList = container.querySelector("#hubDocketList");
  docketList.innerHTML = complaints.map(c => {
    // Find all facilityReports linked to this complaint
    const linked = linkedReports.filter(r => r.linkedComplaintId === c._id || (c.referenceCode && r.actionTaken && r.actionTaken.includes(c.referenceCode)));
    const status = c.status || "Open";

    let statusCls = "hub-status-open";
    if (status.toLowerCase().includes("investig")) statusCls = "hub-status-investigation";
    if (status.toLowerCase().includes("closed") || c.feedbackIssued) statusCls = "hub-status-closed";

    return `
      <div class="hub-case-card" data-complaint-id="${c._id}">
        <div class="hub-case-header">
          <div>
            <div class="hub-case-ref">${escapeHTML(c.referenceCode || "REF-PENDING")}</div>
            <div class="hub-case-title">${escapeHTML(c.product || c.caseInfo || "Untitled Case")}</div>
            <div class="hub-case-meta">
              <span><strong>Complainant:</strong> ${escapeHTML(c.complainant || c.complainantName || "Anonymous")}</span>
              <span><strong>Date Received:</strong> ${escapeHTML(formatDate(c.dateReceived || c.dateLogged))}</span>
              <span><strong>Category:</strong> ${escapeHTML(c.productType || "Food/Drug")}</span>
              <span><strong>Facilities Involved:</strong> ${linked.length} visited</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="hub-status-badge ${statusCls}">${escapeHTML(status)}</span>
            <button class="hub-case-toggle secondary" style="padding:6px 14px !important;font-size:12px !important;">View Docket ▼</button>
          </div>
        </div>

        <div class="hub-case-body">
          <div style="background:#fff;padding:16px;border:1px solid #e2e8f0;border-radius:4px;margin-bottom:16px;">
            <h4 style="margin:0 0 8px;">Case Allegation & Intake Details</h4>
            <p style="margin:0;font-size:13px;line-height:1.6;">${escapeHTML(c.caseInfo || c.complaint || "No case description provided.")}</p>
            ${c.outletVisited ? `<div style="margin-top:8px;font-size:12px;color:var(--secondary-text);"><strong>Suspected Purchase Location:</strong> ${escapeHTML(c.outletVisited)}</div>` : ""}
          </div>

          <h4 style="margin:16px 0 8px;">Enforcement Timeline & Linked Facility Inspections</h4>
          <div class="hub-facility-timeline">
            ${linked.length === 0 ? `
              <div class="muted small" style="padding:12px 0;">
                No field inspections logged yet. When field inspectors select this complaint in "Start New Log", their visit reports, mop-ups, and consultative meetings will automatically link here.
              </div>
            ` : linked.map(r => `
              <div class="hub-facility-entry">
                <div style="width:130px;flex-shrink:0;">
                  <div class="hub-facility-date">${escapeHTML(formatDate(r.inspectionDate))}</div>
                  <div style="font-size:11px;color:var(--accent-dark);font-weight:700;margin-top:2px;">${escapeHTML(r.area || "")}</div>
                </div>
                <div class="hub-facility-detail">
                  <div class="hub-facility-name" data-facility-link="${escapeHTML(r.facilityName)}">${escapeHTML(r.facilityName)}</div>
                  <div class="hub-facility-action">${escapeHTML(r.actionTaken || "Field inspection carried out.")}</div>
                  <div style="margin-top:6px;display:flex;gap:12px;font-size:12px;" class="muted">
                    ${r.mopUpCount ? `<span>🔴 Mopped up: ${r.mopUpCount} units</span>` : ""}
                    ${r.holdCount ? `<span>🟡 Placed on hold: ${r.holdCount} units</span>` : ""}
                    ${r.sanctionGiven ? `<span style="color:var(--danger);font-weight:700;">⚖️ Sanctioned</span>` : ""}
                    ${r.inspectors ? `<span>Inspectors: ${escapeHTML(r.inspectors)}</span>` : ""}
                  </div>
                </div>
              </div>
            `).join("")}
          </div>

          <!-- Gated Close: Feedback Issued to Complainant -->
          <div style="margin-top:20px;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
            <div>
              <strong style="color:var(--accent-dark);">Regulatory Closure Gate: Complainant Feedback</strong>
              <div style="font-size:12px;color:var(--primary-text);margin-top:2px;">
                ${c.feedbackIssued ? `✓ Feedback communicated to complainant on ${escapeHTML(c.feedbackDate || "")} via ${escapeHTML(c.feedbackMethod || "Official Communication")}. Case closed.` : "In accordance with PMS procedure, this complaint cannot be formally closed until feedback is communicated to the complainant."}
              </div>
            </div>
            ${!c.feedbackIssued ? `
              <button class="hub-feedback-btn success" style="padding:8px 16px !important;font-size:13px !important;" data-id="${c._id}">
                ✓ Mark Feedback Issued & Close Case
              </button>
            ` : `
              <span class="hub-status-badge hub-status-closed">CASE CLOSED</span>
            `}
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Bind expand/collapse
  docketList.querySelectorAll(".hub-case-header").forEach(hdr => {
    hdr.addEventListener("click", () => {
      const card = hdr.closest(".hub-case-card");
      const body = card.querySelector(".hub-case-body");
      const btn = card.querySelector(".hub-case-toggle");
      const isExp = body.classList.contains("expanded");
      body.classList.toggle("expanded", !isExp);
      btn.textContent = isExp ? "View Docket ▼" : "Collapse ▲";
    });
  });

  // Bind Feedback closure button
  docketList.querySelectorAll(".hub-feedback-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const docId = btn.dataset.id;
      const method = prompt("Feedback delivery method (e.g. Official Letter, Phone Call, Email, Meeting):", "Official Letter");
      if (method) {
        try {
          const today = new Date().toISOString().split("T")[0];
          await setDoc(doc(db, "complaints", docId), {
            feedbackIssued: true,
            feedbackDate: today,
            feedbackMethod: method.trim(),
            status: "Closed",
            closedAt: serverTimestamp()
          }, { merge: true });
          alert("Case formally closed! Feedback recorded.");
          renderActivityHub(document.getElementById("app"), cfg);
        } catch (err) {
          alert("Error updating feedback: " + err.message);
        }
      }
    });
  });
}

// ─── Standard Log Form Renderer ────────────────────────────────────────────────
function renderStandardLogForm(container, cfg, onSaved) {
  const fields = cfg.logFields || [];
  container.innerHTML = `
    <form id="hubStandardForm" class="hub-form">
      ${fields.map(f => {
        if (f.type === "textarea") {
          return `
            <div style="margin-bottom:14px;">
              <label>${escapeHTML(f.label)} ${f.required ? '<span style="color:red">*</span>' : ""}</label>
              <textarea name="${f.name}" rows="${f.rows || 3}" ${f.required ? "required" : ""}></textarea>
            </div>
          `;
        }
        if (f.type === "select") {
          return `
            <div style="margin-bottom:14px;">
              <label>${escapeHTML(f.label)} ${f.required ? '<span style="color:red">*</span>' : ""}</label>
              <select name="${f.name}">
                ${f.options.map(opt => `<option value="${escapeHTML(opt)}" ${opt === f.default ? "selected" : ""}>${escapeHTML(opt)}</option>`).join("")}
              </select>
            </div>
          `;
        }
        return `
          <div style="margin-bottom:14px;">
            <label>${escapeHTML(f.label)} ${f.required ? '<span style="color:red">*</span>' : ""}</label>
            <input type="${f.type || "text"}" name="${f.name}" ${f.required ? "required" : ""}>
          </div>
        `;
      }).join("")}

      <div class="hub-form-actions">
        <button type="submit" class="success" style="padding:12px 32px;">Save Record</button>
      </div>
    </form>
  `;

  container.querySelector("#hubStandardForm").onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {};
    formData.forEach((val, key) => {
      data[key] = val.trim();
    });

    data.createdAt = serverTimestamp();
    data.createdBy = currentUser ? currentUser.uid : "unknown";
    data.year = new Date().getFullYear();

    try {
      await addDoc(collection(db, cfg.collection), data);
      alert("Record successfully saved!");
      e.target.reset();
      if (onSaved) onSaved();
    } catch (err) {
      console.error("Error saving record:", err);
      alert("Could not save record: " + err.message);
    }
  };
}

// ─── CSV Exporter ─────────────────────────────────────────────────────────────
function exportActivityCSV(items, cfg) {
  if (!items || items.length === 0) {
    alert("No records to export.");
    return;
  }

  const headers = cfg.columns.map(c => `"${c.label.replace(/"/g, '""')}"`);
  const rows = items.map(item => {
    return cfg.columns.map(c => {
      let val = item[c.key] || "";
      if (c.format === "date") val = formatDate(val);
      if (typeof val === "object") val = JSON.stringify(val);
      return `"${String(val).replace(/"/g, '""').replace(/\n/g, " ")}"`;
    }).join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nafdac_${cfg.key}_records_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(d) {
  if (!d) return "—";
  if (d.toDate && typeof d.toDate === "function") {
    return d.toDate().toISOString().split("T")[0];
  }
  const str = String(d);
  if (str.length >= 10 && str.charAt(4) === "-" && str.charAt(7) === "-") {
    return str.substring(0, 10);
  }
  const dateObj = new Date(d);
  if (!isNaN(dateObj.getTime())) {
    return dateObj.toISOString().split("T")[0];
  }
  return str;
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
