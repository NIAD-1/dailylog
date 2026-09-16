/**
 * Reusable Activity Hub Engine
 * Implements the 4-Pillar View:
 * 1. Dashboard & Analytics (Year Filter, KPIs, Heuristic Insights, Charts)
 * 2. Records Ledger (Search, Filter, Excel-matched Table, Teams Link, CSV Export, Inline Edit)
 * 3. Log / Docket (Intake form or Continuous Docket for Complaints)
 * 4. Facility Profile link-through
 */

import { db, collection, addDoc, doc, getDoc, getDocs, query, where, orderBy, setDoc, serverTimestamp } from "./db.js";
import { currentUser, currentUserRole } from "./auth.js";
import { navigate } from "./ui.js";

// Keep track of active Chart.js instances across all hubs to avoid canvas reuse / memory leaks
const activeCharts = {};

function destroyAllCharts() {
  Object.keys(activeCharts).forEach(key => {
    try {
      if (activeCharts[key]?.destroy) activeCharts[key].destroy();
    } catch (e) {
      console.warn("Chart destroy warning:", e);
    }
    delete activeCharts[key];
  });
}

function getItemYear(item) {
  if (item.year) return String(item.year);
  const raw = item.dateReceived || item.inspectionDate || item.dateOfVisit || item.dateLogged || item.createdAt;
  if (!raw) return "";
  if (raw.toDate && typeof raw.toDate === "function") return String(raw.toDate().getFullYear());
  if (raw instanceof Date) return String(raw.getFullYear());
  if (typeof raw === "object" && raw.seconds) return String(new Date(raw.seconds * 1000).getFullYear());
  const m = String(raw).match(/\b(20\d{2})\b/);
  return m ? m[1] : "";
}

export async function renderActivityHub(root, config) {
  destroyAllCharts();

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
  const primaryColName = config.columns[0]?.label || "First column";

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

        <div class="hub-table-toolbar">
          <div class="hub-table-count" id="hubTableCount">Showing <strong>0</strong> records</div>
          <div class="hub-table-scroll-hint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M3 12h18"/></svg>
            Scroll horizontally to view all ${config.columns.length} columns (${escapeHTML(primaryColName)} is pinned) • Click ✎ Edit to update any record
          </div>
        </div>

        <div class="hub-table-wrap">
          <table class="hub-table">
            <thead>
              <tr id="hubTableHead"></tr>
            </thead>
            <tbody id="hubTableBody">
              <tr><td colspan="${config.columns.length + 1}" style="text-align:center;padding:40px;" class="muted">Loading records...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tab 3: Log / Docket -->
      <div id="hubTabLog" class="hub-tab-panel" style="display:none;">
        <div id="hubLogContainer"></div>
      </div>
    </div>

    <!-- Edit Record Modal Container -->
    <div id="hubEditModalContainer"></div>
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

      if (target === "dashboard") {
        const yr = root.querySelector("#hubYearFilter")?.value || "ALL";
        const itemsToChart = yr === "ALL" ? cachedItems : filterByYear(cachedItems, yr);
        renderCharts(itemsToChart, config);
      }
    });
  });

  // Pre-initialize Log Tab
  updateLogTab([], config);

  // 4. Data State
  let cachedItems = [];
  let currentFilteredItems = [];

  // Function to load all records for this activity
  async function loadData() {
    try {
      let q;
      if (config.activityFilter) {
        q = query(
          collection(db, config.collection),
          where("activityType", "==", config.activityFilter)
        );
      } else {
        q = query(collection(db, config.collection));
      }

      const snap = await getDocs(q);
      cachedItems = snap.docs.map(docSnap => ({
        _id: docSnap.id,
        ...docSnap.data()
      }));

      // Filter out invalid/header rows
      cachedItems = cachedItems.filter(item => {
        const ref = String(item.referenceCode || item.alertNo || "");
        if (ref.includes("DATE RECEIVED") || ref.includes("REFERENCE CODE") || ref.includes("COMPLAINTS NO")) return false;
        if (!item.product && !item.facilityName && !item.caseInfo && !item.title && !item.alertNo && !item.name) return false;
        return true;
      });

      // Sort by Year DESC, then Date DESC
      cachedItems.sort((a, b) => {
        const yrA = parseInt(a.year) || 0;
        const yrB = parseInt(b.year) || 0;
        if (yrB !== yrA) return yrB - yrA;
        const dateA = a.dateReceived || a.inspectionDate || a.dateOfVisit || a.dateLogged || a.createdAt || "";
        const dateB = b.dateReceived || b.inspectionDate || b.dateOfVisit || b.dateLogged || b.createdAt || "";
        return String(dateB).localeCompare(String(dateA));
      });

      currentFilteredItems = cachedItems;

      populateYearFilters(cachedItems);
      updateDashboard(cachedItems, config);
      updateRecordsTable(cachedItems, config, sharepointBaseUrl);
      updateLogTab(cachedItems, config);
    } catch (e) {
      console.error("Error loading activity data:", e);
      root.querySelector("#hubTableBody").innerHTML = `
        <tr><td colspan="${config.columns.length + 1}" style="text-align:center;color:var(--danger);padding:40px;">
          Error loading records: ${escapeHTML(e.message)}
        </td></tr>
      `;
    }
  }

  // Populate Year Filter options
  function populateYearFilters(items) {
    const years = new Set();
    const currentYr = new Date().getFullYear();
    years.add(String(currentYr));

    items.forEach(item => {
      const yr = getItemYear(item);
      if (yr) years.add(yr);
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
    return items.filter(item => getItemYear(item) === String(year));
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
    destroyAllCharts();

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
    thead.innerHTML = cfg.columns.map(c => `<th>${escapeHTML(c.label)}</th>`).join("") + `<th style="text-align:center;width:80px;">Action</th>`;
    renderTableRows(items, cfg, baseUrl);
  }

  function renderTableRows(items, cfg, baseUrl) {
    const tbody = root.querySelector("#hubTableBody");
    const countEl = root.querySelector("#hubTableCount");
    if (countEl) {
      countEl.innerHTML = `Showing <strong>${items.length}</strong> records`;
    }

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="${cfg.columns.length + 1}" style="text-align:center;padding:48px;" class="muted">
          No records matching current criteria.
        </td></tr>
      `;
      return;
    }

    tbody.innerHTML = items.map(item => `
      <tr data-id="${escapeHTML(item._id)}">
        ${cfg.columns.map(col => formatCell(item, col, baseUrl, cfg)).join("")}
        <td style="text-align:center;white-space:nowrap;">
          <button class="hub-row-edit" data-id="${escapeHTML(item._id)}" title="Edit Record" style="padding:4px 8px;font-size:12px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;color:#334155;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
            ✎ Edit
          </button>
        </td>
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
          const trimmed = newUrl.trim();
          if (trimmed && !/^https?:\/\//i.test(trimmed)) {
            alert("Invalid URL: must start with https:// or http://");
            return;
          }
          try {
            await setDoc(doc(db, cfg.collection, docId), { teamsFolderUrl: trimmed }, { merge: true });
            const item = cachedItems.find(i => i._id === docId);
            if (item) item.teamsFolderUrl = trimmed;
            applyRecordFilters();
          } catch (err) {
            alert("Could not update link: " + err.message);
          }
        }
      });
    });

    // Facility link-through: Immediate dossier navigation
    tbody.querySelectorAll("[data-facility-link]").forEach(el => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const facName = el.dataset.facilityLink;
        if (facName) {
          sessionStorage.setItem("targetFacilityProfile", facName.trim());
          window.location.hash = "facilities?name=" + encodeURIComponent(facName.trim());
          navigate("facilities");
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      });
    });

    // Bind Row Edit buttons
    tbody.querySelectorAll(".hub-row-edit").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const docId = btn.dataset.id;
        const item = cachedItems.find(i => i._id === docId);
        if (item) {
          showRecordEditModal(item, cfg);
        }
      });
    });

    // Bind editable badge clicks (quick edit)
    tbody.querySelectorAll(".hub-editable-code").forEach(span => {
      span.addEventListener("click", (e) => {
        e.stopPropagation();
        const docId = span.dataset.id;
        const item = cachedItems.find(i => i._id === docId);
        if (item) showRecordEditModal(item, cfg);
      });
    });
  }

  function formatCell(item, col, baseUrl, cfg) {
    const val = item[col.key];

    // 1. Specialized Case Info formatter for Complaints
    if (col.key === "caseInfo") {
      const prod = item.product || "";
      const details = item.caseInfo || item.complaint || item.observation || "";
      return `
        <td>
          ${prod ? `<div style="font-weight:700;color:var(--primary-text);margin-bottom:2px;">${escapeHTML(prod)}</div>` : ""}
          <div class="muted small" style="line-height:1.4;max-width:340px;">${escapeHTML(details || "—")}</div>
        </td>
      `;
    }

    // 2. Reference Code / Alert No. badge (clickable for editing)
    if (col.format === "code" || col.key === "referenceCode" || col.key === "alertNo") {
      const code = val || (item.year ? `${item.year}/REF-PENDING` : "—");
      return `<td><span class="hub-editable-code" data-id="${escapeHTML(item._id)}" title="Click to edit: ${escapeHTML(code)}" style="display:inline-block;padding:3px 8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;font-family:monospace;font-weight:700;font-size:11px;color:#1e40af;letter-spacing:0.02em;white-space:nowrap;cursor:pointer;">${escapeHTML(code)}</span></td>`;
    }

    // 3. Complainant styling
    if (col.key === "complainant") {
      return `<td><strong style="color:var(--primary-text);">${escapeHTML(val || "Anonymous Consumer")}</strong></td>`;
    }

    // 4. Product Type badge
    if (col.key === "productType" && val) {
      return `<td><span style="display:inline-block;padding:2px 8px;background:#f3f4f6;border-radius:12px;font-size:11px;font-weight:600;color:#374151;white-space:nowrap;">${escapeHTML(val)}</span></td>`;
    }

    // 5. Facility Name link
    if (col.format === "bold" || col.key === "facilityName" || col.key === "name" || col.key === "outletVisited") {
      const isFacility = col.key === "facilityName" || col.key === "name" || col.key === "outletVisited" || col.format === "facility";
      if (isFacility && val) {
        return `<td><a href="#facilities?name=${encodeURIComponent(val)}" data-facility-link="${escapeHTML(val)}" class="hub-facility-link" title="Open facility profile dossier: ${escapeHTML(val)}">${escapeHTML(val)}</a></td>`;
      }
      return `<td><strong>${escapeHTML(val || "—")}</strong></td>`;
    }

    if (col.key === "address" || col.key === "facilityAddress") {
      return `<td><div style="min-width:200px;max-width:320px;font-size:12px;color:#475569;line-height:1.4;">${escapeHTML(val || "—")}</div></td>`;
    }

    if (col.key === "contact") {
      return `<td><div style="max-width:160px;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(val || "—")}</div></td>`;
    }

    if (col.key === "conclusion" || col.key === "remarks" || col.key === "actionTaken" || col.key === "observation" || col.key === "recommendation") {
      return `<td><div style="min-width:200px;max-width:300px;font-size:12px;color:#334155;line-height:1.4;">${escapeHTML(val || "—")}</div></td>`;
    }

    if (col.key === "companyFile") {
      return `<td><span style="display:inline-block;padding:2px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;font-family:monospace;font-size:11px;color:#475569;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHTML(val || '')}">${escapeHTML(val || "—")}</span></td>`;
    }

    // 6. Linked Alert Badge
    if (col.format === "alert" || col.key === "linkedAlertId") {
      if (!val) return `<td><span class="muted small">—</span></td>`;
      return `<td><span style="display:inline-block;padding:2px 8px;background:#fef3c7;border:1px solid #fde68a;border-radius:4px;font-family:monospace;font-weight:700;font-size:11px;color:#92400e;white-space:nowrap;">⚠️ ${escapeHTML(item.linkedAlertNo || val)}</span></td>`;
    }

    // 7. Semantic Badge Formatter
    if (col.format === "badge") {
      const str = String(val || cfg.defaultStatus || "Open").trim();
      const sLower = str.toLowerCase();
      let cls = "hub-status-pending";
      let icon = "● ";

      const isHighRisk = sLower.includes("cat c") || sLower.includes("high") || sLower.includes("default") || sLower.includes("not located") || sLower.includes("overdue") || sLower.includes("non-compliant");
      const isLowRisk = !isHighRisk && (sLower.includes("cat a") || sLower.includes("low") || sLower.includes("closed") || sLower.includes("active") || (sLower.includes("compliant") && !sLower.includes("non")) || (sLower.includes("submit") && !sLower.includes("await") && !sLower.includes("pend") && !sLower.includes("not") && !sLower.includes("yet")));
      const isInvestigation = sLower.includes("investig") || sLower.includes("cevi") || sLower.includes("enforce");

      if (isHighRisk) {
        cls = "hub-status-high";
        icon = "⚠ ";
      } else if (isLowRisk) {
        cls = "hub-status-low";
        icon = "✓ ";
      } else if (isInvestigation) {
        cls = "hub-status-investigation";
        icon = "⏳ ";
      } else if (sLower.includes("cat b") || sLower.includes("medium") || sLower.includes("open") || sLower.includes("pending")) {
        cls = "hub-status-medium";
        icon = "● ";
      } else if (sLower === "gsdp") {
        cls = "hub-status-pending";
        icon = "📋 ";
      }
      return `<td><span class="hub-status-badge ${cls}">${icon}${escapeHTML(str.toUpperCase())}</span></td>`;
    }

    if (col.format === "feedback") {
      if (item.feedbackIssued) {
        return `<td><span class="hub-status-badge hub-status-closed">✓ Feedback Issued (${escapeHTML(formatDate(item.feedbackDate, item.year))})</span></td>`;
      }
      return `<td><span class="hub-status-badge hub-status-ongoing">Pending Feedback</span></td>`;
    }

    if (col.format === "teams") {
      let folderUrl = item.teamsFolderUrl;
      if (!folderUrl && baseUrl) {
        const facName = item.facilityName || item.outletVisited || item.complainant || item.name || "";
        if (facName) {
          const sanitized = facName.replace(/[."*:<>?\/\\|]/g, "").trim();
          const cleanBase = baseUrl.replace(/\/+$/, "");
          const cleanFolder = cfg.teamsRootFolder.replace(/^\/+/, "");
          folderUrl = `${cleanBase}/${cleanFolder}/${encodeURIComponent(sanitized)}`;
        }
      }

      if (folderUrl) {
        return `
          <td style="white-space:nowrap;">
            <a href="${escapeHTML(folderUrl)}" target="_blank" rel="noopener" class="hub-teams-link">
              <svg style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Folder
            </a>
            <button class="hub-teams-edit" data-current="${escapeHTML(folderUrl)}" title="Override link">✎</button>
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
      return `<td style="white-space:nowrap;font-weight:600;font-size:12px;color:#334155;">${escapeHTML(formatDate(val, item.year))}</td>`;
    }

    if (col.format === "number") {
      return `<td><strong>${Number(val) || 0}</strong></td>`;
    }

    if (col.format === "boolean") {
      return `<td>${val ? '<span style="color:var(--danger);font-weight:700;">YES</span>' : "No"}</td>`;
    }

    return `<td>${escapeHTML((val !== null && val !== undefined && val !== "") ? val : "—")}</td>`;
  }

  // Filter application
  function applyRecordFilters() {
    const search = (root.querySelector("#hubSearchInput")?.value || "").toLowerCase();
    const yr = root.querySelector("#hubRecordsYearFilter")?.value || "ALL";
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
        const text = Object.values(item).map(v => (v && typeof v === "object" ? JSON.stringify(v) : String(v || ""))).join(" ").toLowerCase();
        return text.includes(search);
      });
    }

    currentFilteredItems = filtered;
    renderTableRows(filtered, config, sharepointBaseUrl);
  }

  root.querySelector("#hubSearchInput")?.addEventListener("input", debounce(applyRecordFilters, 200));

  // 7. Update Log Tab
  function updateLogTab(items, cfg) {
    const container = root.querySelector("#hubLogContainer");
    if (!container) return;

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

  // 8. Record Edit Modal
  function showRecordEditModal(item, cfg) {
    const modalMount = root.querySelector("#hubEditModalContainer");
    if (!modalMount) return;

    // Generate editable form fields based on config columns
    const editableCols = cfg.columns.filter(c => c.format !== "teams" && c.format !== "bold");
    const nameKey = cfg.columns.find(c => c.format === "bold")?.key || "facilityName";

    modalMount.innerHTML = `
      <div class="modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div class="card" style="width:100%;max-width:640px;max-height:90vh;overflow-y:auto;position:relative;background:#fff;border-radius:8px;padding:24px;box-shadow:0 10px 25px rgba(0,0,0,0.2);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #e2e8f0;padding-bottom:12px;">
            <h3 style="margin:0;font-size:18px;">Edit Directorate Record</h3>
            <button id="hubCloseEditModalBtn" class="secondary small" style="padding:4px 8px;">✕</button>
          </div>
          <form id="hubEditRecordForm">
            <div class="form-group" style="margin-bottom:12px;">
              <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">${escapeHTML(cfg.columns.find(c => c.key === nameKey)?.label || "Facility / Subject Name")}</label>
              <input type="text" name="${nameKey}" value="${escapeHTML(item[nameKey] || "")}" required style="width:100%;">
            </div>

            ${cfg.columns.map(c => {
              if (c.key === nameKey || c.format === "teams") return "";
              const val = item[c.key] || "";
              if (c.format === "badge" && cfg.statuses) {
                return `
                  <div class="form-group" style="margin-bottom:12px;">
                    <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">${escapeHTML(c.label)}</label>
                    <select name="${c.key}" style="width:100%;">
                      ${cfg.statuses.map(st => `<option value="${escapeHTML(st)}" ${String(val).toLowerCase() === st.toLowerCase() ? "selected" : ""}>${escapeHTML(st)}</option>`).join("")}
                    </select>
                  </div>
                `;
              }
              if (c.key === "caseInfo" || c.key === "findings" || c.key === "actionTaken" || c.key === "remarks" || c.key === "observation" || c.key === "recommendation" || c.key === "address") {
                return `
                  <div class="form-group" style="margin-bottom:12px;">
                    <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">${escapeHTML(c.label)}</label>
                    <textarea name="${c.key}" rows="2" style="width:100%;font-size:13px;">${escapeHTML(val)}</textarea>
                  </div>
                `;
              }
              return `
                <div class="form-group" style="margin-bottom:12px;">
                  <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">${escapeHTML(c.label)}</label>
                  <input type="${c.format === 'date' ? 'text' : 'text'}" name="${c.key}" value="${escapeHTML(val)}" placeholder="${c.format === 'date' ? 'YYYY-MM-DD' : ''}" style="width:100%;">
                </div>
              `;
            }).join("")}

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:16px;">
              <button type="button" id="hubCancelEditBtn" class="secondary">Cancel</button>
              <button type="submit" class="success" id="hubSaveEditBtn">Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const closeBtn = modalMount.querySelector("#hubCloseEditModalBtn");
    const cancelBtn = modalMount.querySelector("#hubCancelEditBtn");
    const form = modalMount.querySelector("#hubEditRecordForm");

    const closeModal = () => { modalMount.innerHTML = ""; };
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const saveBtn = form.querySelector("#hubSaveEditBtn");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      const formData = new FormData(form);
      const updates = {};
      for (const [k, v] of formData.entries()) {
        updates[k] = v.trim();
      }

      try {
        await setDoc(doc(db, cfg.collection, item._id), updates, { merge: true });
        Object.assign(item, updates);
        applyRecordFilters();
        closeModal();
      } catch (err) {
        console.error("Error updating record:", err);
        alert("Failed to save changes: " + err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Changes";
      }
    };
  }

  // CSV Export
  root.querySelector("#hubExportCsvBtn").onclick = () => {
    exportActivityCSV(currentFilteredItems.length ? currentFilteredItems : cachedItems, config);
  };

  // Refresh
  root.querySelector("#hubRefreshBtn").onclick = loadData;

  // Initial load
  await loadData();
}

// ─── Continuous Complaint Docket Renderer ───────────────────────────────────────
async function renderComplaintDocket(container, complaints, cfg, baseUrl) {
  if (!complaints || complaints.length === 0) {
    container.innerHTML = `<div class="muted" style="padding:40px;text-align:center;">Loading complaint dockets...</div>`;
    return;
  }

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
  const intakeBox = container.querySelector("#hubDocketIntakeForm");
  const mount = container.querySelector("#hubIntakeFormMount");

  newBtn.onclick = () => {
    const isHidden = intakeBox.style.display === "none";
    intakeBox.style.display = isHidden ? "block" : "none";
    newBtn.textContent = isHidden ? "✕ Close Intake Form" : "+ Log New Complaint Intake";
    if (isHidden) {
      renderStandardLogForm(mount, cfg, () => {
        intakeBox.style.display = "none";
        newBtn.textContent = "+ Log New Complaint Intake";
        renderActivityHub(container.closest(".hub-page")?.parentElement || document.getElementById("app"), cfg);
      });
    }
  };

  // Render individual Complaint Case Docket Cards
  const list = container.querySelector("#hubDocketList");
  complaints.forEach(c => {
    const ref = c.referenceCode || `${c.year || 2026}/CC/INTAKE`;
    const casesLinked = linkedReports.filter(r => (r.complaintRefCode && r.complaintRefCode === ref) || (c.outletVisited && r.facilityName && r.facilityName.toLowerCase() === c.outletVisited.toLowerCase()));

    const card = document.createElement("div");
    card.className = "hub-case-card card";
    card.dataset.complaintId = escapeHTML(c._id);
    card.style.marginBottom = "20px";
    card.style.borderLeft = c.status === "Closed" ? "4px solid #10b981" : "4px solid #f59e0b";

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-family:monospace;font-weight:700;font-size:13px;padding:3px 8px;background:#eff6ff;color:#1e40af;border-radius:4px;">${escapeHTML(ref)}</span>
            <span class="hub-status-badge ${c.status === "Closed" ? "hub-status-closed" : "hub-status-open"}">${escapeHTML(c.status || "Open")}</span>
            <span class="muted small">${escapeHTML(formatDate(c.dateReceived, c.year))}</span>
          </div>
          <h3 style="margin:8px 0 2px;">${escapeHTML(c.product || c.caseInfo || "Untitled Complaint")}</h3>
          <div class="muted small">Complainant: <strong>${escapeHTML(c.complainant || "Anonymous Consumer")}</strong></div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="secondary small hub-investigate-btn" data-ref="${escapeHTML(ref)}" data-target="${escapeHTML(c.outletVisited || '')}">+ Conduct Field Inspection</button>
        </div>
      </div>

      <div style="background:#f8fafc;padding:14px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:16px;">
        <div style="font-weight:700;font-size:12px;color:#475569;margin-bottom:4px;">Case Allegation & Intake Details:</div>
        <div style="font-size:13px;line-height:1.5;">${escapeHTML(c.caseInfo || c.complaint || "No case description provided.")}</div>
        ${c.outletVisited ? `<div style="margin-top:8px;font-size:12px;color:var(--secondary-text);"><strong>Suspected Purchase Location:</strong> <a href="#facilities?name=${encodeURIComponent(c.outletVisited)}" class="hub-facility-link" data-facility-link="${escapeHTML(c.outletVisited)}">${escapeHTML(c.outletVisited)}</a></div>` : ""}
        ${c.actionTaken ? `<div style="margin-top:6px;font-size:12px;color:#334155;"><strong>Initial Action:</strong> ${escapeHTML(c.actionTaken)}</div>` : ""}
        ${c.remarks ? `<div style="margin-top:6px;font-size:12px;color:#64748b;"><strong>Remarks:</strong> ${escapeHTML(c.remarks)}</div>` : ""}
      </div>

      <div style="border-top:1px solid #e2e8f0;padding-top:14px;">
        <h4 style="font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.03em;color:#64748b;">Investigation & Action Timeline (${casesLinked.length} Linked Audits)</h4>
        <div class="hub-timeline">
          <div class="hub-timeline-item">
            <div class="hub-timeline-marker"></div>
            <div class="hub-timeline-content">
              <strong>Complaint Logged</strong>
              <div class="muted small">${escapeHTML(formatDate(c.dateReceived, c.year))}</div>
            </div>
          </div>
          ${casesLinked.map(r => `
            <div class="hub-timeline-item">
              <div class="hub-timeline-marker" style="background:#2563eb;"></div>
              <div class="hub-timeline-content">
                <strong>Field Audit: ${escapeHTML(r.facilityName || "Target Outlet")}</strong>
                <div class="small" style="margin-top:2px;">${escapeHTML(r.actionTaken || r.findings || "Inspection logged.")}</div>
                <div class="muted small" style="display:flex;gap:12px;margin-top:4px;">
                  <span>${escapeHTML(formatDate(r.inspectionDate))}</span>
                  ${(r.inspectorNames || r.inspectors) ? `<span>Inspectors: ${escapeHTML(r.inspectorNames || r.inspectors)}</span>` : ""}
                </div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;background:#fff;border-top:1px solid #e2e8f0;padding-top:14px;margin-top:14px;">
        <div>
          ${c.feedbackIssued ? `
            <span style="color:#059669;font-weight:700;font-size:12px;">✓ Feedback Delivered on ${escapeHTML(formatDate(c.feedbackDate, c.year))}</span>
          ` : `
            <span class="muted small">Awaiting Desk Officer closure and complainant notification.</span>
          `}
        </div>
        <button class="hub-feedback-btn ${c.feedbackIssued ? 'secondary' : 'success'}" data-id="${escapeHTML(c._id)}" style="font-size:12px;">
          ${c.feedbackIssued ? "Update Closure Remarks" : "Issue Feedback & Close Docket"}
        </button>
      </div>
    `;

    // Bind Field Inspection redirection
    card.querySelector(".hub-investigate-btn").onclick = () => {
      sessionStorage.setItem("wizardComplaintRef", ref);
      if (c.outletVisited) sessionStorage.setItem("wizardPreselectFacility", c.outletVisited);
      navigate("report");
    };

    // Bind Feedback Modal
    card.querySelector(".hub-feedback-btn").onclick = () => {
      showFeedbackModal(c, cfg, container);
    };

    list.appendChild(card);
  });
}

function showFeedbackModal(complaint, cfg, container) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.background = "rgba(0,0,0,0.5)";
  modal.style.zIndex = "9999";
  modal.style.display = "flex";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.style.padding = "16px";

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:500px;background:#fff;border-radius:8px;padding:24px;">
      <h3 style="margin-top:0;">Close Complaint & Issue Feedback</h3>
      <p class="muted small">Log regulatory closure communication with the complainant.</p>
      <form id="hubFeedbackForm">
        <div class="form-group" style="margin-bottom:12px;">
          <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">Date Feedback Issued</label>
          <input type="date" name="feedbackDate" value="${new Date().toISOString().split('T')[0]}" required style="width:100%;">
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">Closing Remarks & Resolution Summary</label>
          <textarea name="remarks" rows="3" placeholder="Details delivered to complainant (e.g. facility fined, product mopped off, sample satisfactory)..." required style="width:100%;font-size:13px;">${escapeHTML(complaint.remarks || "")}</textarea>
        </div>
        <div class="form-group" style="margin-bottom:16px;">
          <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">Final Status</label>
          <select name="status" style="width:100%;">
            <option value="Closed" selected>Closed (Feedback Issued)</option>
            <option value="Under Investigation">Under Investigation</option>
          </select>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="secondary" id="hubCancelFeedbackBtn">Cancel</button>
          <button type="submit" class="success">Save Closure</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#hubCancelFeedbackBtn").onclick = () => modal.remove();

  modal.querySelector("#hubFeedbackForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const dateVal = fd.get("feedbackDate");
    const remarksVal = fd.get("remarks");
    const statusVal = fd.get("status");

    try {
      await setDoc(doc(db, cfg.collection, complaint._id), {
        feedbackIssued: true,
        feedbackDate: dateVal,
        remarks: remarksVal,
        status: statusVal
      }, { merge: true });

      modal.remove();
      renderActivityHub(container.closest(".hub-page")?.parentElement || document.getElementById("app"), cfg);
    } catch (err) {
      alert("Could not update feedback: " + err.message);
    }
  };
}

// ─── Standard Activity Intake Form Renderer ──────────────────────────────────
function renderStandardLogForm(container, cfg, onSaved) {
  if (!cfg.logFields) {
    container.innerHTML = `<div class="muted">No form configuration found.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="card" style="max-width:800px;margin:auto;">
      <h3 style="margin-top:0;">Log New ${escapeHTML(cfg.title)} Entry</h3>
      <form id="hubStandardForm" class="hub-form">
        ${cfg.logFields.map(field => {
          if (field.type === "select") {
            return `
              <div class="form-group" style="margin-bottom:14px;">
                <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">${escapeHTML(field.label)}</label>
                <select name="${escapeHTML(field.name)}" ${field.required ? "required" : ""} style="width:100%;">
                  ${field.options.map(opt => `<option value="${escapeHTML(opt)}" ${opt === field.default ? "selected" : ""}>${escapeHTML(opt)}</option>`).join("")}
                </select>
              </div>
            `;
          }
          if (field.type === "textarea") {
            return `
              <div class="form-group" style="margin-bottom:14px;">
                <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">${escapeHTML(field.label)}</label>
                <textarea name="${escapeHTML(field.name)}" rows="${field.rows || 2}" ${field.required ? "required" : ""} style="width:100%;font-size:13px;"></textarea>
              </div>
            `;
          }
          return `
            <div class="form-group" style="margin-bottom:14px;">
              <label style="display:block;font-weight:700;font-size:12px;margin-bottom:4px;">${escapeHTML(field.label)}</label>
              <input type="${field.type || 'text'}" name="${escapeHTML(field.name)}" ${field.required ? "required" : ""} style="width:100%;">
            </div>
          `;
        }).join("")}

        <div style="margin-top:24px;">
          <button type="submit" class="success" style="padding:12px 28px;font-size:15px;">Save Record to Directorate Ledger</button>
        </div>
      </form>
    </div>
  `;

  const form = container.querySelector("#hubStandardForm");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {};
    for (const [k, v] of fd.entries()) {
      data[k] = v.trim();
    }
    data.createdAt = serverTimestamp();
    data.loggedBy = currentUser ? (currentUser.displayName || currentUser.email) : "Inspector";
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
      let val = item[c.key];
      if (c.format === "date") {
        val = formatDate(val, item.year);
      } else if (c.format === "feedback") {
        val = item.feedbackIssued ? `Feedback Issued (${formatDate(item.feedbackDate, item.year)})` : "Pending Feedback";
      } else if (c.format === "boolean") {
        val = val ? "YES" : "NO";
      } else if (c.format === "badge") {
        val = val || cfg.defaultStatus || "Open";
      } else if (typeof val === "object") {
        val = JSON.stringify(val);
      }
      return `"${String(val || '').replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;
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

function formatDate(d, fallbackYear) {
  if (!d) return fallbackYear ? String(fallbackYear) : "—";
  if (d.toDate && typeof d.toDate === "function") {
    d = d.toDate();
  }
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return fallbackYear ? String(fallbackYear) : "—";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }
  const str = String(d).trim();
  const ymd = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${String(parseInt(ymd[3], 10)).padStart(2, '0')} ${months[parseInt(ymd[2], 10) - 1]} ${ymd[1]}`;
  }
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dmy) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let yr = dmy[3];
    if (yr.length === 2) yr = "20" + yr;
    return `${String(parseInt(dmy[1], 10)).padStart(2, '0')} ${months[parseInt(dmy[2], 10) - 1]} ${yr}`;
  }
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const mIdx = monthNames.findIndex(m => str.toLowerCase().includes(m));
  if (mIdx >= 0) {
    const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${shortMonths[mIdx]} ${fallbackYear || ""}`.trim();
  }
  if (str.length > 20 || str.includes("DATE") || str.includes("COSMETIC") || str.includes("COMPLAINT")) {
    return fallbackYear ? String(fallbackYear) : "—";
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
