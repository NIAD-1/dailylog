import { db, collection, getDocs, query, where, doc, getDoc, setDoc, addDoc } from "./db.js";
import { clearRoot } from "./ui.js";

let allFacilities = [];
let facilityCache = {};
let currentUserRole = null;
let dirState = { letter: 'All', activity: 'All', zone: 'All', status: 'All', year: 'All' };

export const setFacilityProfileUser = (user, role) => {
    currentUserRole = role;
};

async function loadAllFacilities() {
    if (allFacilities.length > 0) return allFacilities;
    try {
        const snap = await getDocs(collection(db, "facilities"));
        allFacilities = [];
        snap.forEach(d => {
            const data = d.data();
            data._docId = d.id;
            allFacilities.push(data);
        });
        allFacilities.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } catch (err) {
        console.error("Error loading facilities:", err);
    }
    return allFacilities;
}


export async function renderFacilityProfilePage(root) {
    clearRoot(root);
    root.innerHTML = `
    <section class="fp-page">
        <div class="fp-search-container">
            <div class="fp-search-box">
                <svg class="fp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input type="text" id="fpSearch" class="fp-search-input"
                       placeholder="Search facilities by name, address, or file number..."
                       autocomplete="off">
                <div id="fpSearchCount" class="fp-search-count"></div>
            </div>
            <div id="fpResults" class="fp-search-results"></div>
        </div>
        <div id="fpProfileArea"></div>
    </section>`;

    const searchInput = document.getElementById("fpSearch");
    const resultsDiv = document.getElementById("fpResults");
    const countDiv = document.getElementById("fpSearchCount");
    const profileArea = document.getElementById("fpProfileArea");

    searchInput.disabled = true;
    searchInput.placeholder = "Loading facility database...";
    const facilities = await loadAllFacilities();
    searchInput.disabled = false;
    searchInput.placeholder = "Search facilities by name, address, or file number...";
    countDiv.textContent = `${facilities.length.toLocaleString()} facilities`;

    renderOverview(profileArea, facilities);

    let debounce = null;
    searchInput.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            const q = searchInput.value.trim().toUpperCase();
            if (q.length < 2) {
                resultsDiv.innerHTML = "";
                resultsDiv.classList.remove("visible");
                renderOverview(profileArea, facilities);
                return;
            }
            const matches = facilities.filter(f => {
                const name = (f.name || "").toUpperCase();
                const addr = (f.address || "").toUpperCase();
                const file = (f.fileNumber || "").toUpperCase();
                const aliases = (f.aliases || []).join(" ").toUpperCase();
                return name.includes(q) || addr.includes(q) || file.includes(q) || aliases.includes(q);
            }).slice(0, 20);

            if (matches.length === 0) {
                resultsDiv.innerHTML = `<div class="fp-no-results">No facilities found matching "${searchInput.value}"</div>`;
                resultsDiv.classList.add("visible");
                return;
            }

            resultsDiv.innerHTML = matches.map(f => `
                <div class="fp-result-item" data-id="${f.id}">
                    <div class="fp-result-name">${highlight(f.name, q)}</div>
                    <div class="fp-result-meta">
                        ${f.address ? `<span>${highlight(f.address, q)}</span>` : ""}
                        ${f.fileNumber ? `<span class="fp-result-file">${f.fileNumber}</span>` : ""}
                    </div>
                </div>
            `).join("");
            resultsDiv.classList.add("visible");

            resultsDiv.querySelectorAll(".fp-result-item").forEach(el => {
                el.addEventListener("click", () => {
                    const fac = facilities.find(f => f.id === el.dataset.id);
                    if (fac) {
                        resultsDiv.classList.remove("visible");
                        searchInput.value = fac.name;
                        renderProfile(profileArea, fac);
                    }
                });
            });
        }, 200);
    });


    document.addEventListener("click", (e) => {
        if (!e.target.closest(".fp-search-container")) {
            resultsDiv.classList.remove("visible");
        }
    });
}

function highlight(text, query) {
    if (!query || !text) return text || "";
    const idx = text.toUpperCase().indexOf(query);
    if (idx === -1) return text;
    return text.slice(0, idx) + `<mark>${text.slice(idx, idx + query.length)}</mark>` + text.slice(idx + query.length);
}



function renderOverview(container, facilities) {
    const total = facilities.length;
    const withFines = facilities.filter(f => f.totalFinesIssued > 0).length;
    const outstanding = facilities.filter(f => f.outstandingFines > 0).length;
    const notLocated = facilities.filter(f => f.status === "Not Located").length;

    const byType = {};
    facilities.forEach(f => {
        (f.activityTypes || []).forEach(at => {
            byType[at] = (byType[at] || 0) + 1;
        });
    });

    container.innerHTML = `
    <div class="fp-overview">
        <div class="fp-overview-header">
            <h2>Facility Database</h2>
            <p>Select a facility from the search above to view its complete profile.</p>
        </div>
        <div class="fp-stats-grid fp-stats-overview">
            <div class="fp-stat-card">
                <div class="fp-stat-icon" style="background: var(--fp-green-light); color: var(--fp-green);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                </div>
                <div class="fp-stat-label">Total Facilities</div>
                <div class="fp-stat-value">${total.toLocaleString()}</div>
            </div>
            <div class="fp-stat-card">
                <div class="fp-stat-icon" style="background: #FFF3E0; color: #E65100;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                </div>
                <div class="fp-stat-label">Fines Issued</div>
                <div class="fp-stat-value">${withFines.toLocaleString()}</div>
            </div>
            <div class="fp-stat-card">
                <div class="fp-stat-icon" style="background: #FFEBEE; color: #C62828;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                </div>
                <div class="fp-stat-label">Outstanding Fines</div>
                <div class="fp-stat-value">${outstanding.toLocaleString()}</div>
            </div>
            <div class="fp-stat-card">
                <div class="fp-stat-icon" style="background: #E3F2FD; color: #1565C0;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                </div>
                <div class="fp-stat-label">Not Located</div>
                <div class="fp-stat-value">${notLocated.toLocaleString()}</div>
            </div>
        </div>
        <div id="fpDirectoryArea"></div>
    </div>`;

    renderDirectoryArea(facilities);
}

function renderDirectoryArea(facilities) {
    const dirArea = document.getElementById("fpDirectoryArea");
    if (!dirArea) return;

    // Get unique options for filters
    const activities = [...new Set(facilities.flatMap(f => f.activityTypes || []))].filter(Boolean).sort();
    const zones = [...new Set(facilities.map(f => f.zone ? f.zone.trim() : ""))].filter(Boolean).sort();
    const statuses = [...new Set(facilities.map(f => f.status ? f.status.trim() : ""))].filter(Boolean).sort();
    const years = [...new Set(facilities.map(f => {
        if (!f.lastVisitDate) return null;
        return f.lastVisitDate.substring(0, 4);
    }).filter(Boolean))].sort((a, b) => b.localeCompare(a)); // Descending

    const letters = "ALL,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,#".split(",");

    dirArea.innerHTML = `
    <div class="fp-directory-section">
        <div class="fp-overview-header" style="margin-bottom: 16px;">
            <h3 style="margin:0; font-size: 20px; color: #2d3748;">A-Z Directory</h3>
        </div>
        
        <div class="fp-az-bar">
            ${letters.map(l => `<button class="fp-az-btn ${dirState.letter === l ? 'active' : ''}" data-letter="${l}">${l}</button>`).join('')}
        </div>

        <div class="fp-filters-bar">
            <div class="fp-filter-wrapper">
                <label>Activity</label>
                <select id="dirFilterActivity" class="fp-filter-select">
                    <option value="All">All Activities</option>
                    ${activities.map(a => `<option value="${a}" ${dirState.activity === a ? 'selected' : ''}>${a}</option>`).join('')}
                </select>
            </div>
            <div class="fp-filter-wrapper">
                <label>Zone / Region</label>
                <select id="dirFilterZone" class="fp-filter-select">
                    <option value="All">All Zones</option>
                    ${zones.map(z => `<option value="${z}" ${dirState.zone === z ? 'selected' : ''}>${z}</option>`).join('')}
                </select>
            </div>
            <div class="fp-filter-wrapper">
                <label>Status</label>
                <select id="dirFilterStatus" class="fp-filter-select">
                    <option value="All">All Statuses</option>
                    ${statuses.map(s => `<option value="${s}" ${dirState.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            </div>
            <div class="fp-filter-wrapper">
                <label>Last Visited</label>
                <select id="dirFilterYear" class="fp-filter-select">
                    <option value="All">Any Year</option>
                    ${years.map(y => `<option value="${y}" ${dirState.year === y ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
            </div>
        </div>

        <div id="fpDirResults" class="fp-dir-grid"></div>
    </div>`;

    // Bind A-Z buttons
    dirArea.querySelectorAll(".fp-az-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            dirState.letter = btn.dataset.letter;
            renderDirectoryArea(facilities); // re-render filters & nav
        });
    });

    // Bind Filters
    const bindFilter = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", () => {
            dirState[key] = el.value;
            renderDirectoryResults(facilities);
        });
    };
    bindFilter("dirFilterActivity", "activity");
    bindFilter("dirFilterZone", "zone");
    bindFilter("dirFilterStatus", "status");
    bindFilter("dirFilterYear", "year");

    // Render initial results
    renderDirectoryResults(facilities);
}

function renderDirectoryResults(facilities) {
    const grid = document.getElementById("fpDirResults");
    if (!grid) return;

    // Filter logic
    let filtered = facilities.filter(f => {
        const name = (f.name || "").trim().toUpperCase();
        if (!name) return false;

        // Letter filter
        if (dirState.letter !== "All") {
            if (dirState.letter === "#") {
                if (!/^[0-9]/.test(name)) return false;
            } else {
                if (!name.startsWith(dirState.letter)) return false;
            }
        }

        // Activity filter
        if (dirState.activity !== "All") {
            if (!(f.activityTypes || []).includes(dirState.activity)) return false;
        }

        // Zone filter
        if (dirState.zone !== "All") {
            if (f.zone !== dirState.zone) return false;
        }

        // Status filter
        if (dirState.status !== "All") {
            if (f.status !== dirState.status) return false;
        }

        // Year filter
        if (dirState.year !== "All") {
            const y = f.lastVisitDate ? f.lastVisitDate.substring(0, 4) : null;
            if (y !== dirState.year) return false;
        }

        return true;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1 / -1;" class="fp-no-results">No facilities found matching the current filters.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(f => `
        <div class="fp-dir-card" data-id="${f.id}">
            <div class="fp-dir-card-title">${f.name || "Unknown"}</div>
            <div class="fp-dir-card-meta">
                ${f.address ? `<div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📍 ${f.address}</div>` : ""}
                ${f.lastVisitDate ? `<div style="margin-top:4px;">⏱️ Last Visit: ${f.lastVisitDate}</div>` : ""}
            </div>
            <div class="fp-dir-card-tags">
                ${f.zone ? `<span class="fp-tag fp-tag-zone">${f.zone}</span>` : ""}
                ${f.status ? `<span class="fp-status-badge fp-status-${(f.status || 'Active').toLowerCase().replace(/\s/g, '-')}" style="padding: 2px 6px; font-size: 10px;">${f.status}</span>` : ""}
            </div>
            <div class="fp-dir-card-tags">
                ${(f.activityTypes || []).slice(0, 2).map(at => `<span class="fp-tag fp-tag-activity">${at}</span>`).join("")}
                ${(f.activityTypes || []).length > 2 ? `<span class="fp-tag">+${f.activityTypes.length - 2}</span>` : ""}
            </div>
            <div class="fp-dir-card-footer">
                <div style="color: #718096;">Total Visits: <strong>${f.totalVisits || 0}</strong></div>
                <div style="color: var(--fp-green); font-weight: 600;">View Profile →</div>
            </div>
        </div>
    `).join("");

    // Bind clicks to open profile
    grid.querySelectorAll(".fp-dir-card").forEach(card => {
        card.addEventListener("click", () => {
            const fac = facilities.find(f => f.id === card.dataset.id);
            if (fac) {
                document.getElementById("fpSearch").value = fac.name;
                renderProfile(document.getElementById("fpProfileArea"), fac);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    });
}

/* ─── Facility Profile ───────────────────────────────────────────────────── */

async function renderProfile(container, facility) {
    const fid = facility.id;

    container.innerHTML = `
    <div class="fp-profile">
        <!-- Header -->
        <div class="fp-profile-header">
            <div class="fp-profile-header-top">
                <div>
                    <h2 class="fp-profile-name">${facility.name || "Unknown Facility"}</h2>
                    <div class="fp-profile-meta">
                        ${facility.address ? `<span class="fp-profile-address"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> ${facility.address}</span>` : ""}
                    </div>
                    <div class="fp-profile-tags">
                        ${facility.fileNumber ? `<span class="fp-tag fp-tag-file">${facility.fileNumber}</span>` : ""}
                        ${facility.zone ? `<span class="fp-tag fp-tag-zone">${facility.zone}</span>` : ""}
                        ${facility.lga ? `<span class="fp-tag fp-tag-lga">${facility.lga}</span>` : ""}
                        ${(facility.activityTypes || []).map(at => `<span class="fp-tag fp-tag-activity">${at}</span>`).join("")}
                    </div>
                </div>
            <!-- Header Top Right: Badges & Admin Actions -->
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                <div class="fp-status-badge fp-status-${(facility.status || 'Active').toLowerCase().replace(/\s/g, '-')}">
                    ${facility.status || "Active"}
                </div>
                ${currentUserRole === 'admin' ? `<button id="fpEditBtn" class="secondary" style="font-size: 13px; padding: 6px 12px;">✏️ Edit Profile</button>` : ""}
            </div>
        </div>

        <!-- Links Section -->
        <div class="fp-links-section" style="margin-top: 16px; border-top: 1px solid #e1e8ed; padding-top: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div style="font-weight: 500; font-size: 14px; display: flex; align-items: center; gap: 4px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                Teams Folders:
            </div>
            ${renderTeamsLinks(facility.teamsLinks)}
            ${currentUserRole === 'admin' ? `<button id="fpEditLinksBtn" class="secondary" style="font-size: 12px; padding: 4px 8px; border-radius: 4px; border: 1px dashed #ccc;">+ Add/Edit Links</button>` : ""}
        </div>
        
        ${facility.contactPerson || facility.phone || facility.email ? `
        <div class="fp-contact-row" style="margin-top: 16px;">
                ${facility.contactPerson ? `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${facility.contactPerson}</span>` : ""}
                ${facility.phone ? `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg> ${facility.phone}</span>` : ""}
                ${facility.email ? `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> ${facility.email}</span>` : ""}
            </div>` : ""}
        </div>

        <!-- Stats -->
        <div class="fp-stats-grid">
            <div class="fp-stat-card fp-stat-compact">
                <div class="fp-stat-icon fp-stat-icon-sm" style="background: var(--fp-green-light); color: var(--fp-green);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>
                </div>
                <div><div class="fp-stat-label">Total Inspections</div><div class="fp-stat-value">${facility.totalVisits || 0}</div></div>
            </div>
            <div class="fp-stat-card fp-stat-compact">
                <div class="fp-stat-icon fp-stat-icon-sm" style="background: #FFF3E0; color: #E65100;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                </div>
                <div><div class="fp-stat-label">Fines Issued</div><div class="fp-stat-value">₦${(facility.totalFinesIssued || 0).toLocaleString()}</div></div>
            </div>
            <div class="fp-stat-card fp-stat-compact">
                <div class="fp-stat-icon fp-stat-icon-sm" style="background: ${facility.outstandingFines > 0 ? '#FFEBEE' : '#E8F5E9'}; color: ${facility.outstandingFines > 0 ? '#C62828' : '#2E7D32'};">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8l-8 8M8 8l8 8"/></svg>
                </div>
                <div><div class="fp-stat-label">Outstanding</div><div class="fp-stat-value ${facility.outstandingFines > 0 ? 'fp-danger' : 'fp-success'}">₦${(facility.outstandingFines || 0).toLocaleString()}</div></div>
            </div>
            <div class="fp-stat-card fp-stat-compact">
                <div class="fp-stat-icon fp-stat-icon-sm" style="background: #E3F2FD; color: #1565C0;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                <div><div class="fp-stat-label">Last Visit</div><div class="fp-stat-value">${facility.lastVisitDate || "—"}</div></div>
            </div>
        </div>

        <!-- Tabs -->
        <div class="fp-tabs">
            <button class="fp-tab active" data-tab="inspections">Inspection History</button>
            <button class="fp-tab" data-tab="sanctions">Sanctions & Fines</button>
            <button class="fp-tab" data-tab="complaints">Consumer Complaints</button>
            <button class="fp-tab" data-tab="documents">Documents</button>
            <button class="fp-tab" data-tab="files">File Registry</button>
        </div>

        <!-- Tab Content -->
        <div class="fp-tab-content" id="fpTabContent">
            <div class="fp-loading">Loading data...</div>
        </div>
    </div>`;

    // Bind tabs
    container.querySelectorAll(".fp-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            container.querySelectorAll(".fp-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            loadTabContent(tab.dataset.tab, fid, facility.name);
        });
    });

    if (currentUserRole === 'admin') {
        const editBtn = container.querySelector("#fpEditBtn");
        if (editBtn) editBtn.addEventListener("click", () => showEditProfileModal(facility));

        const editLinksBtn = container.querySelector("#fpEditLinksBtn");
        if (editLinksBtn) editLinksBtn.addEventListener("click", () => showEditLinksModal(facility));
    }

    // Load first tab
    loadTabContent("inspections", fid, facility.name);
}

/* ─── Tab Data Loaders ───────────────────────────────────────────────────── */

async function loadTabContent(tab, facilityId, facilityName) {
    const contentDiv = document.getElementById("fpTabContent");
    contentDiv.innerHTML = `<div class="fp-loading"><div class="fp-spinner"></div> Loading ${tab}...</div>`;

    try {
        switch (tab) {
            case "inspections":
                await renderInspectionsTab(contentDiv, facilityId, facilityName);
                break;
            case "sanctions":
                await renderSanctionsTab(contentDiv, facilityId, facilityName);
                break;
            case "complaints":
                await renderComplaintsTab(contentDiv, facilityId, facilityName);
                break;
            case "documents":
                await renderDocumentsTab(contentDiv, facilityId, facilityName);
                break;
            case "files":
                await renderFilesTab(contentDiv, facilityId, facilityName);
                break;
        }
    } catch (err) {
        console.error(`Error loading ${tab}:`, err);
        contentDiv.innerHTML = `<div class="fp-empty">Error loading data. ${err.message}</div>`;
    }
}

async function renderInspectionsTab(container, facilityId, facilityName) {
    const snap = await getDocs(query(collection(db, "inspections"), where("facilityId", "==", facilityId)));
    const records = [];
    snap.forEach(d => records.push(d.data()));

    // Also check facilityReports (from wizard submissions)
    try {
        const repSnap = await getDocs(query(collection(db, "facilityReports"), where("facilityName", "==", facilityName)));
        repSnap.forEach(d => {
            const data = d.data();
            records.push({
                activityType: data.activityType,
                inspectionDate: data.inspectionDate?.toDate?.() ? data.inspectionDate.toDate().toISOString().split("T")[0] : "",
                observation: data.actionTaken || "",
                actionTaken: data.actionTaken || "",
                riskFinding: "",
                remark: "",
                status: "LOGGED",
                source: "wizard"
            });
        });
    } catch (e) { /* ignore permission errors */ }

    records.sort((a, b) => (b.inspectionDate || "").localeCompare(a.inspectionDate || ""));

    if (records.length === 0) {
        container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div class="fp-empty" style="margin: 0;">No inspection records found for this facility.</div>
            ${currentUserRole === 'admin' ? `<button id="fpAddRecordBtn" class="primary" style="font-size: 13px; padding: 6px 12px;">+ Add Record</button>` : ""}
        </div>`;
    } else {
        container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; font-size: 16px; color: #1a202c;">Inspection History</h3>
            ${currentUserRole === 'admin' ? `<button id="fpAddRecordBtn" class="primary" style="font-size: 13px; padding: 6px 12px; background: var(--fp-green); color: white; border: none; border-radius: 4px; cursor: pointer;">+ Add Record</button>` : ""}
        </div>
        <div class="fp-table-wrap">
            <table class="fp-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Activity</th>
                        <th>Observation / Findings</th>
                        <th>Action Taken</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${records.map(r => `
                    <tr>
                        <td class="fp-td-date">${r.inspectionDate || "—"}</td>
                        <td><span class="fp-activity-badge fp-activity-${(r.activityType || '').toLowerCase().replace(/\s/g, '-')}">${r.activityType || "—"}</span></td>
                        <td class="fp-td-text">${r.observation || r.riskFinding || "—"}</td>
                        <td class="fp-td-text">${r.actionTaken || r.recommendation || "—"}</td>
                        <td>${statusBadge(r.status || r.remark)}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
        <div class="fp-record-count">${records.length} record${records.length !== 1 ? 's' : ''}</div>`;
    }

    if (currentUserRole === 'admin') {
        const addBtn = container.querySelector("#fpAddRecordBtn");
        if (addBtn) addBtn.addEventListener("click", () => showAddInspectionModal(facilityId, facilityName));
    }
}

async function renderSanctionsTab(container, facilityId, facilityName) {
    const snap = await getDocs(query(collection(db, "sanctions"), where("facilityId", "==", facilityId)));
    const records = [];
    snap.forEach(d => records.push(d.data()));
    records.sort((a, b) => (b.year || 0) - (a.year || 0));

    const totalIssued = records.reduce((s, r) => s + (r.amount || 0), 0);
    const totalPaid = records.filter(r => r.paymentStatus === "PAID").reduce((s, r) => s + (r.amount || 0), 0);
    const totalOutstanding = totalIssued - totalPaid;

    if (records.length === 0) {
        container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div class="fp-empty" style="margin: 0;">No sanctions or fines on record for this facility.</div>
            ${currentUserRole === 'admin' ? `<button id="fpAddSanctionBtn" class="primary" style="font-size: 13px; padding: 6px 12px; background: var(--fp-green); color: white; border: none; border-radius: 4px; cursor: pointer;">+ Add Sanction</button>` : ""}
        </div>`;
    } else {
        container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; font-size: 16px; color: #1a202c;">Sanctions & Fines</h3>
            ${currentUserRole === 'admin' ? `<button id="fpAddSanctionBtn" class="primary" style="font-size: 13px; padding: 6px 12px; background: var(--fp-green); color: white; border: none; border-radius: 4px; cursor: pointer;">+ Add Sanction</button>` : ""}
        </div>
        <div class="fp-sanctions-summary">
            <div class="fp-sanction-metric">
                <span class="fp-sanction-metric-label">Total Issued</span>
                <span class="fp-sanction-metric-value">₦${totalIssued.toLocaleString()}</span>
            </div>
            <div class="fp-sanction-metric">
                <span class="fp-sanction-metric-label">Paid</span>
                <span class="fp-sanction-metric-value fp-success">₦${totalPaid.toLocaleString()}</span>
            </div>
            <div class="fp-sanction-metric">
                <span class="fp-sanction-metric-label">Outstanding</span>
                <span class="fp-sanction-metric-value ${totalOutstanding > 0 ? 'fp-danger' : 'fp-success'}">₦${totalOutstanding.toLocaleString()}</span>
            </div>
        </div>
        <div class="fp-table-wrap">
            <table class="fp-table">
                <thead>
                    <tr><th>Year</th><th>Offence</th><th>Amount</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${records.map(r => `
                    <tr>
                        <td>${r.year || "—"}</td>
                        <td class="fp-td-text">${r.offence || "—"}</td>
                        <td class="fp-td-amount">₦${(r.amount || 0).toLocaleString()}</td>
                        <td>${paymentBadge(r.paymentStatus)}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
        <div class="fp-record-count">${records.length} record${records.length !== 1 ? 's' : ''}</div>`;
    }

    if (currentUserRole === 'admin') {
        const addBtn = container.querySelector("#fpAddSanctionBtn");
        if (addBtn) addBtn.addEventListener("click", () => showAddSanctionModal(facilityId, facilityName));
    }
}

async function renderComplaintsTab(container, facilityId, facilityName) {
    const snap = await getDocs(query(collection(db, "complaints"), where("facilityId", "==", facilityId)));
    const records = [];
    snap.forEach(d => records.push(d.data()));
    records.sort((a, b) => (b.year || 0) - (a.year || 0));

    if (records.length === 0) {
        container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div class="fp-empty" style="margin: 0;">No consumer complaints linked to this facility.</div>
            ${currentUserRole === 'admin' ? `<button id="fpAddComplaintBtn" class="primary" style="font-size: 13px; padding: 6px 12px; background: var(--fp-green); color: white; border: none; border-radius: 4px; cursor: pointer;">+ Log Complaint</button>` : ""}
        </div>`;
    } else {
        container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; font-size: 16px; color: #1a202c;">Consumer Complaints</h3>
            ${currentUserRole === 'admin' ? `<button id="fpAddComplaintBtn" class="primary" style="font-size: 13px; padding: 6px 12px; background: var(--fp-green); color: white; border: none; border-radius: 4px; cursor: pointer;">+ Log Complaint</button>` : ""}
        </div>
        <div class="fp-table-wrap">
            <table class="fp-table">
                <thead><tr><th>Year</th><th>Product</th><th>Type</th><th>Complaint</th><th>Outcome</th></tr></thead>
                <tbody>
                    ${records.map(r => `
                    <tr>
                        <td>${r.year || "—"}</td>
                        <td class="fp-td-text">${r.product || "—"}</td>
                        <td>${r.productType || "—"}</td>
                        <td class="fp-td-text">${r.complaint || r.observation || "—"}</td>
                        <td>${statusBadge(r.outcome)}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
        <div class="fp-record-count">${records.length} record${records.length !== 1 ? 's' : ''}</div>`;
    }

    if (currentUserRole === 'admin') {
        const addBtn = container.querySelector("#fpAddComplaintBtn");
        if (addBtn) addBtn.addEventListener("click", () => showAddComplaintModal(facilityId, facilityName));
    }
}

async function renderDocumentsTab(container, facilityId) {
    // Documents are not always linked by facilityId — show a message
    const snap = await getDocs(query(collection(db, "documents"), where("facilityId", "==", facilityId)));
    const records = [];
    snap.forEach(d => records.push(d.data()));

    if (records.length === 0) {
        container.innerHTML = `<div class="fp-empty">No documents directly linked to this facility.<br><span class="fp-empty-hint">Documents are tracked by subject — some may reference this facility without being directly linked.</span></div>`;
        return;
    }

    container.innerHTML = `
    <div class="fp-table-wrap">
        <table class="fp-table">
            <thead><tr><th>Date</th><th>Direction</th><th>Subject</th><th>Sender</th><th>Remark</th></tr></thead>
            <tbody>
                ${records.map(r => `
                <tr>
                    <td class="fp-td-date">${r.date || "—"}</td>
                    <td><span class="fp-direction-badge fp-dir-${(r.direction || '').toLowerCase()}">${r.direction || "—"}</span></td>
                    <td class="fp-td-text">${r.subject || "—"}</td>
                    <td>${r.sender || "—"}</td>
                    <td class="fp-td-text">${r.remark || "—"}</td>
                </tr>`).join("")}
            </tbody>
        </table>
    </div>
    <div class="fp-record-count">${records.length} record${records.length !== 1 ? 's' : ''}</div>`;
}

async function renderFilesTab(container, facilityId) {
    const snap = await getDocs(query(collection(db, "file_registry"), where("facilityId", "==", facilityId)));
    const records = [];
    snap.forEach(d => records.push(d.data()));

    if (records.length === 0) {
        container.innerHTML = `<div class="fp-empty">No physical file records found for this facility.</div>`;
        return;
    }

    container.innerHTML = `
    <div class="fp-files-grid">
        ${records.map(r => `
        <div class="fp-file-card">
            <div class="fp-file-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="fp-file-info">
                <div class="fp-file-name">${r.fileName || "—"}</div>
                <div class="fp-file-number">${r.fileNumber || "—"}</div>
                <div class="fp-file-meta">
                    <span class="fp-tag fp-tag-activity">${r.fileCategory || "—"}</span>
                    ${r.volumeNumber ? `<span>Vol. ${r.volumeNumber}</span>` : ""}
                </div>
            </div>
        </div>`).join("")}
    </div>
    <div class="fp-record-count">${records.length} record${records.length !== 1 ? 's' : ''}</div>`;
}

/* ─── Badge Helpers ──────────────────────────────────────────────────────── */

function statusBadge(status) {
    if (!status) return `<span class="fp-badge fp-badge-neutral">—</span>`;
    const s = status.toUpperCase().trim();
    if (s.includes("CLOSED") || s.includes("CONCLUDED")) return `<span class="fp-badge fp-badge-success">${s}</span>`;
    if (s.includes("PENDING") || s.includes("OPEN")) return `<span class="fp-badge fp-badge-warning">${s}</span>`;
    if (s.includes("NOT_LOCATED") || s.includes("NOT LOCATED")) return `<span class="fp-badge fp-badge-danger">NOT LOCATED</span>`;
    return `<span class="fp-badge fp-badge-neutral">${s}</span>`;
}

function paymentBadge(status) {
    if (!status) return `<span class="fp-badge fp-badge-warning">PENDING</span>`;
    const s = status.toUpperCase().trim();
    if (s === "PAID") return `<span class="fp-badge fp-badge-success">PAID</span>`;
    if (s === "PARTIAL") return `<span class="fp-badge fp-badge-warning">PARTIAL</span>`;
    return `<span class="fp-badge fp-badge-danger">${s}</span>`;
}

function renderTeamsLinks(links) {
    if (!links || Object.keys(links).length === 0) {
        return `<span style="font-size: 13px; color: #718096; font-style: italic;">No links added yet</span>`;
    }
    return Object.entries(links).map(([key, url]) => {
        if (!url) return "";
        const labels = {
            routineVisits: "Routine Vis.",
            gsdp: "GSDP",
            glsi: "GLSI",
            complaints: "Complaints"
        };
        const label = labels[key] || key;
        return `<a href="${url}" target="_blank" class="fp-tag fp-tag-zone" style="text-decoration: none; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            ${label}
        </a>`;
    }).join("");
}

/* ─── Admin Edit Modals ──────────────────────────────────────────────────── */

function showEditProfileModal(facility) {
    const modalContainer = document.getElementById("modalContainer");
    modalContainer.innerHTML = `
    <div class="modal open">
        <div class="modal-content" style="max-width: 500px;">
            <h3 style="margin-bottom: 20px;">Edit Facility Profile</h3>
            <div class="form-group">
                <label>Facility Name</label>
                <input type="text" id="editFacName" value="${facility.name || ""}">
            </div>
            <div class="form-group">
                <label>Address</label>
                <input type="text" id="editFacAddress" value="${facility.address || ""}">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>File Number</label>
                    <input type="text" id="editFacFile" value="${facility.fileNumber || ""}">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select id="editFacStatus">
                        <option value="Active" ${facility.status === "Active" ? "selected" : ""}>Active</option>
                        <option value="Inactive" ${facility.status === "Inactive" ? "selected" : ""}>Inactive</option>
                        <option value="Closed" ${facility.status === "Closed" ? "selected" : ""}>Closed</option>
                        <option value="Not Located" ${facility.status === "Not Located" ? "selected" : ""}>Not Located</option>
                    </select>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Zone</label>
                    <input type="text" id="editFacZone" value="${facility.zone || ""}">
                </div>
                <div class="form-group">
                    <label>LGA</label>
                    <input type="text" id="editFacLGA" value="${facility.lga || ""}">
                </div>
            </div>
            <div class="controls" style="margin-top: 24px;">
                <button class="secondary" onclick="document.getElementById('modalContainer').innerHTML=''">Cancel</button>
                <button class="success" id="saveFacProfileBtn">Save Changes</button>
            </div>
        </div>
    </div>`;

    document.getElementById("saveFacProfileBtn").onclick = async () => {
        const btn = document.getElementById("saveFacProfileBtn");
        btn.disabled = true;
        btn.textContent = "Saving...";
        try {
            const updates = {
                name: document.getElementById("editFacName").value.trim(),
                address: document.getElementById("editFacAddress").value.trim(),
                fileNumber: document.getElementById("editFacFile").value.trim(),
                status: document.getElementById("editFacStatus").value,
                zone: document.getElementById("editFacZone").value.trim(),
                lga: document.getElementById("editFacLGA").value.trim()
            };
            await setDoc(doc(db, "facilities", facility._docId), updates, { merge: true });

            // Update local object & re-render
            Object.assign(facility, updates);
            modalContainer.innerHTML = '';
            renderProfile(document.getElementById("fpProfileArea"), facility);
        } catch (e) {
            console.error(e);
            alert("Error saving profile: " + e.message);
            btn.disabled = false;
            btn.textContent = "Save Changes";
        }
    };
}

function showEditLinksModal(facility) {
    const modalContainer = document.getElementById("modalContainer");
    const links = facility.teamsLinks || {};

    modalContainer.innerHTML = `
    <div class="modal open">
        <div class="modal-content" style="max-width: 600px;">
            <h3 style="margin-bottom: 20px;">Edit Teams Folders Links</h3>
            <p class="muted" style="margin-bottom: 20px; font-size: 13px;">Paste the exact SharePoint/Teams folder URLs for this facility.</p>
            
            <div class="form-group">
                <label>Routine Surveillance Folder (URL)</label>
                <input type="url" id="linkRoutine" value="${links.routineVisits || ""}" placeholder="https://teams.microsoft.com/...">
            </div>
            <div class="form-group">
                <label>GSDP Folder (URL)</label>
                <input type="url" id="linkGsdp" value="${links.gsdp || ""}" placeholder="https://teams.microsoft.com/...">
            </div>
            <div class="form-group">
                <label>GLSI Folder (URL)</label>
                <input type="url" id="linkGlsi" value="${links.glsi || ""}" placeholder="https://teams.microsoft.com/...">
            </div>
            <div class="form-group">
                <label>Consumer Complaints Folder (URL)</label>
                <input type="url" id="linkComplaint" value="${links.complaints || ""}" placeholder="https://teams.microsoft.com/...">
            </div>
            
            <div class="controls" style="margin-top: 24px;">
                <button class="secondary" onclick="document.getElementById('modalContainer').innerHTML=''">Cancel</button>
                <button class="success" id="saveFacLinksBtn">Save Links</button>
            </div>
        </div>
    </div>`;

    document.getElementById("saveFacLinksBtn").onclick = async () => {
        const btn = document.getElementById("saveFacLinksBtn");
        btn.disabled = true;
        btn.textContent = "Saving...";
        try {
            const updates = {
                teamsLinks: {
                    routineVisits: document.getElementById("linkRoutine").value.trim(),
                    gsdp: document.getElementById("linkGsdp").value.trim(),
                    glsi: document.getElementById("linkGlsi").value.trim(),
                    complaints: document.getElementById("linkComplaint").value.trim()
                }
            };

            await setDoc(doc(db, "facilities", facility._docId), updates, { merge: true });

            // Update local & re-render
            facility.teamsLinks = updates.teamsLinks;
            modalContainer.innerHTML = '';
            renderProfile(document.getElementById("fpProfileArea"), facility);
        } catch (e) {
            console.error(e);
            alert("Error saving links: " + e.message);
            btn.disabled = false;
            btn.textContent = "Save Links";
        }
    };
}

function showAddSanctionModal(facilityId, facilityName) {
    const modalContainer = document.getElementById("modalContainer");
    const currentYear = new Date().getFullYear();

    modalContainer.innerHTML = `
    <div class="modal open">
        <div class="modal-content" style="max-width: 500px;">
            <h3 style="margin-bottom: 20px;">Add Sanction / Fine</h3>
            <p class="muted" style="margin-bottom: 20px; font-size: 13px;">Record a new sanction for <strong>${facilityName}</strong>.</p>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Year</label>
                    <input type="number" id="addSanctionYear" value="${currentYear}" min="2016" max="${currentYear}">
                </div>
                <div class="form-group">
                    <label>Amount (₦)</label>
                    <input type="number" id="addSanctionAmount" placeholder="e.g. 50000">
                </div>
            </div>
            <div class="form-group">
                <label>Offence / Reason</label>
                <textarea id="addSanctionOffence" rows="3" placeholder="Describe the offence..."></textarea>
            </div>
            <div class="form-group">
                <label>Payment Status</label>
                <select id="addSanctionStatus">
                    <option value="UNPAID">Unpaid</option>
                    <option value="PAID">Paid</option>
                    <option value="PARTIAL">Partial</option>
                </select>
            </div>

            <div class="controls" style="margin-top: 24px;">
                <button class="secondary" onclick="document.getElementById('modalContainer').innerHTML=''">Cancel</button>
                <button class="success" id="saveSanctionBtn">Save Sanction</button>
            </div>
        </div>
    </div>`;

    document.getElementById("saveSanctionBtn").onclick = async () => {
        const btn = document.getElementById("saveSanctionBtn");
        btn.disabled = true;
        btn.textContent = "Saving...";
        try {
            const newRecord = {
                facilityId: facilityId,
                facilityName: facilityName,
                year: parseInt(document.getElementById("addSanctionYear").value) || currentYear,
                amount: parseFloat(document.getElementById("addSanctionAmount").value) || 0,
                offence: document.getElementById("addSanctionOffence").value.trim(),
                paymentStatus: document.getElementById("addSanctionStatus").value,
                source: "manual_entry"
            };
            await addDoc(collection(db, "sanctions"), newRecord);
            modalContainer.innerHTML = '';
            loadTabContent("sanctions", facilityId, facilityName);
        } catch (e) {
            console.error(e);
            alert("Error adding sanction: " + e.message);
            btn.disabled = false;
            btn.textContent = "Save Sanction";
        }
    };
}

function showAddComplaintModal(facilityId, facilityName) {
    const modalContainer = document.getElementById("modalContainer");
    const currentYear = new Date().getFullYear();

    modalContainer.innerHTML = `
    <div class="modal open">
        <div class="modal-content" style="max-width: 500px;">
            <h3 style="margin-bottom: 20px;">Log Consumer Complaint</h3>
            <p class="muted" style="margin-bottom: 20px; font-size: 13px;">Record a consumer complaint against <strong>${facilityName}</strong>.</p>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Year</label>
                    <input type="number" id="addComplaintYear" value="${currentYear}" min="2016" max="${currentYear}">
                </div>
                <div class="form-group">
                    <label>Product Type</label>
                    <select id="addComplaintType">
                        <option value="Drug">Drug</option>
                        <option value="Food">Food</option>
                        <option value="Cosmetic">Cosmetic</option>
                        <option value="Device">Device</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Product Name</label>
                <input type="text" id="addComplaintProduct" placeholder="Enter product name...">
            </div>
            <div class="form-group">
                <label>Complaint Details</label>
                <textarea id="addComplaintDetails" rows="3" placeholder="Describe the complaint..."></textarea>
            </div>
            <div class="form-group">
                <label>Action Taken / Outcome</label>
                <textarea id="addComplaintOutcome" rows="2" placeholder="e.g. Product recalled, Warning letter issued..."></textarea>
            </div>

            <div class="controls" style="margin-top: 24px;">
                <button class="secondary" onclick="document.getElementById('modalContainer').innerHTML=''">Cancel</button>
                <button class="success" id="saveComplaintBtn">Save Complaint</button>
            </div>
        </div>
    </div>`;

    document.getElementById("saveComplaintBtn").onclick = async () => {
        const btn = document.getElementById("saveComplaintBtn");
        btn.disabled = true;
        btn.textContent = "Saving...";
        try {
            const newRecord = {
                facilityId: facilityId,
                facilityName: facilityName,
                year: parseInt(document.getElementById("addComplaintYear").value) || currentYear,
                productType: document.getElementById("addComplaintType").value,
                product: document.getElementById("addComplaintProduct").value.trim(),
                complaint: document.getElementById("addComplaintDetails").value.trim(),
                outcome: document.getElementById("addComplaintOutcome").value.trim(),
                source: "manual_entry"
            };
            await addDoc(collection(db, "complaints"), newRecord);
            modalContainer.innerHTML = '';
            loadTabContent("complaints", facilityId, facilityName);
        } catch (e) {
            console.error(e);
            alert("Error adding complaint: " + e.message);
            btn.disabled = false;
            btn.textContent = "Save Complaint";
        }
    };
}
