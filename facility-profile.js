import { db, collection, getDocs, query, where, doc, getDoc, setDoc, addDoc, writeBatch } from "./db.js";
import { normalizeFacilityName, fuzzyMatch, normalizeAddress } from "./facility-utils.js";
import { clearRoot } from "./ui.js";

let allFacilities = [];
let facilityCache = {};
let currentUserRole = null;
let dirState = { letter: "A", activity: "All", zone: "All", status: "All", year: "All" };
let selectedFacilities = new Set();
let isMergeMode = false;

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
    
    // Filter out logically deleted or merged facilities from the UI
    const activeFacilities = facilities.filter(f => !f.deleted && f.status !== "MERGED");
    
    searchInput.disabled = false;
    searchInput.placeholder = "Search facilities by name, address, or file number...";
    countDiv.textContent = `${activeFacilities.length.toLocaleString()} active facilities`;

    renderOverview(profileArea, activeFacilities);

    let debounce = null;
    searchInput.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            const q = searchInput.value.trim().toUpperCase();
            if (q.length < 2) {
                resultsDiv.innerHTML = "";
                resultsDiv.classList.remove("visible");
                renderOverview(profileArea, activeFacilities);
                return;
            }
            const matches = activeFacilities.filter(f => {
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
        const match = f.lastVisitDate.match(/\b(20\d{2})\b/);
        return match ? match[1] : null;
    }).filter(Boolean))].sort((a, b) => b.localeCompare(a)); // Descending

    const letters = "ALL,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,#".split(",");

    dirArea.innerHTML = `
    <div class="fp-directory-section">
        <div class="fp-overview-header" style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
            <h3 style="margin:0; font-size: 20px; color: #2d3748;">A-Z Directory</h3>
            ${currentUserRole === 'admin' ? `
                <div class="fp-admin-actions" style="display: flex; gap: 8px;">
                    <button id="autoMergeBtn" class="fp-btn-outline" style="border-style: dashed; font-size: 13px;" onclick="window.__autoMerge && window.__autoMerge()">
                        ✨ Auto-Consolidate
                    </button>
                    <button id="autoLinkBtn" class="fp-btn-outline" style="border-style: dashed; font-size: 13px;" onclick="window.__autoLink && window.__autoLink()">
                        🔗 Link Branches
                    </button>
                    <button id="toggleMergeMode" class="fp-btn-outline" style="font-size: 13px;">
                        ${isMergeMode ? 'Cancel Merge' : 'Merge Duplicates'}
                    </button>
                    ${isMergeMode && selectedFacilities.size >= 2 ? `
                        <button id="executeMerge" class="fp-btn-success" style="font-size: 13px;">
                            Merge ${selectedFacilities.size} Selected
                        </button>
                    ` : ''}
                </div>
            ` : ''}
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

    // Bind Merge Toggle
    const toggleMergeBtn = document.getElementById("toggleMergeMode");
    if (toggleMergeBtn) {
        toggleMergeBtn.onclick = () => {
            isMergeMode = !isMergeMode;
            if (!isMergeMode) selectedFacilities.clear();
            renderDirectoryArea(facilities);
        };
    }

    const executeMergeBtn = document.getElementById("executeMerge");
    if (executeMergeBtn) {
        executeMergeBtn.onclick = () => showMergeConfirmation(facilities);
    }

    const autoMergeBtn = document.getElementById("autoMergeBtn");
    if (autoMergeBtn) {
        console.log("[MERGE] Auto-merge button found and bound");
        window.__autoMerge = () => autoMergeFacilities(facilities);
        autoMergeBtn.onclick = () => {
            console.log("[MERGE] Auto-consolidate clicked!");
            autoMergeFacilities(facilities);
        };
    } else {
        console.log("[MERGE] Auto-merge button NOT found — role:", currentUserRole);
    }

    const autoLinkBtn = document.getElementById("autoLinkBtn");
    if (autoLinkBtn) {
        window.__autoLink = () => autoLinkFacilities(facilities);
        autoLinkBtn.onclick = () => autoLinkFacilities(facilities);
    }

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

        if (dirState.letter !== "ALL") {
            if (dirState.letter === "#") {
                if (!/^[0-9]/.test(name)) return false;
            } else if (!name.startsWith(dirState.letter)) {
                return false;
            }
        }
        if (dirState.activity !== "All" && !(f.activityTypes || []).includes(dirState.activity)) return false;
        if (dirState.zone !== "All" && f.zone !== dirState.zone) return false;
        if (dirState.status !== "All" && f.status !== dirState.status) return false;
        if (dirState.year !== "All") {
            if (!f.lastVisitDate) return false;
            const match = f.lastVisitDate.match(/\b(20\d{2})\b/);
            const y = match ? match[1] : null;
            if (y !== dirState.year) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1 / -1;" class="fp-no-results">No facilities found matching the current filters.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(f => `
        <div class="fp-dir-card ${selectedFacilities.has(f.id) ? 'selected' : ''}" data-id="${f.id}">
            ${isMergeMode ? `
                <div class="fp-card-selection">
                    <div class="fp-checkbox ${selectedFacilities.has(f.id) ? 'checked' : ''}">
                        ${selectedFacilities.has(f.id) ? '✓' : ''}
                    </div>
                </div>
            ` : ''}
            <div class="fp-dir-card-body">
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
                    <div style="color: var(--fp-green); font-weight: 600;">${isMergeMode ? 'Select' : 'View Profile →'}</div>
                </div>
            </div>
        </div>
    `).join("");

    // Bind clicks
    grid.querySelectorAll(".fp-dir-card").forEach(card => {
        card.addEventListener("click", () => {
            const id = card.dataset.id;
            if (isMergeMode) {
                if (selectedFacilities.has(id)) selectedFacilities.delete(id);
                else selectedFacilities.add(id);
                renderDirectoryArea(facilities);
            } else {
                showFacilityProfile(id);
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
            <button class="fp-tab" data-tab="branches">Branches</button>
        </div>

        <!-- Tab Content -->
        <div class="fp-tab-content" id="fpTabContent">
            <div class="fp-loading">Loading data...</div>
        </div>
    </div>`;

    // Bind tabs
    container.querySelectorAll(".fp-tab").forEach(btn => {
        btn.onclick = () => {
            container.querySelectorAll(".fp-tab").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const tabName = btn.dataset.tab;
            if (tabName === "branches") {
                renderBranchesTab(container, facility.id, facility.name);
            } else {
                loadTabContent(tabName, facility.id, facility.name);
            }
        };
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
        if (addBtn) addBtn.addEventListener("click", () => showAddInspectionModalFn(facilityId, facilityName));
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

function showAddInspectionModalFn(facilityId, facilityName) {
    const modalContainer = document.getElementById("modalContainer");
    const currentYear = new Date().getFullYear();

    modalContainer.innerHTML = `
    <div class="modal open">
        <div class="modal-content" style="max-width: 500px;">
            <h3 style="margin-bottom: 20px;">Add Inspection Record</h3>
            <p class="muted" style="margin-bottom: 20px; font-size: 13px;">Log a new inspection for <strong>${facilityName}</strong>.</p>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Activity Type</label>
                    <select id="addInspActivity">
                        <option value="Routine Surveillance">Routine Surveillance</option>
                        <option value="GSDP">GSDP</option>
                        <option value="GLSI">GLSI</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" id="addInspDate" value="${new Date().toISOString().split('T')[0]}">
                </div>
            </div>
            <div class="form-group">
                <label>Observation / Findings</label>
                <textarea id="addInspObs" rows="3" placeholder="What did the inspector find?"></textarea>
            </div>
            <div class="form-group">
                <label>Action Taken</label>
                <input type="text" id="addInspAction" placeholder="e.g. facility sealed, products mopped...">
            </div>

            <div class="controls" style="margin-top: 24px;">
                <button class="secondary" onclick="document.getElementById('modalContainer').innerHTML=''">Cancel</button>
                <button class="success" id="saveInspBtn">Save Record</button>
            </div>
        </div>
    </div>`;

    document.getElementById("saveInspBtn").onclick = async () => {
        const btn = document.getElementById("saveInspBtn");
        btn.disabled = true;
        btn.textContent = "Saving...";
        try {
            const newRecord = {
                facilityId: facilityId,
                facilityName: facilityName,
                activityType: document.getElementById("addInspActivity").value,
                inspectionDate: document.getElementById("addInspDate").value,
                year: parseInt(document.getElementById("addInspDate").value.substring(0, 4)) || currentYear,
                observation: document.getElementById("addInspObs").value.trim(),
                actionTaken: document.getElementById("addInspAction").value.trim(),
                status: "OPEN",
                source: "manual_entry"
            };
            await addDoc(collection(db, "inspections"), newRecord);
            modalContainer.innerHTML = '';
            loadTabContent("inspections", facilityId, facilityName);
        } catch (e) {
            console.error(e);
            alert("Error adding record: " + e.message);
            btn.disabled = false;
            btn.textContent = "Save Record";
        }
    };
}

function showFacilityProfile(id) {
    const fac = allFacilities.find(f => f.id === id);
    if (fac) {
        document.getElementById("fpSearch").value = fac.name;
        renderProfile(document.getElementById("fpProfileArea"), fac);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function showMergeConfirmation(facilities) {
    const selected = facilities.filter(f => selectedFacilities.has(f.id));
    if (selected.length < 2) return;

    const modalContainer = document.getElementById("modalContainer");
    modalContainer.innerHTML = `
    <div class="modal open">
        <div class="modal-content" style="max-width: 500px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin:0;">Merge Duplicates</h3>
                <span class="fp-modal-close" style="cursor:pointer; font-size:24px;" onclick="document.getElementById('modalContainer').innerHTML=''">&times;</span>
            </div>
            <div class="fp-modal-body">
                <p style="font-size: 14px; color: #4a5568; margin-bottom: 20px;">
                    Select the <strong>Master Record</strong>. All history from the others will be moved to it, and they will be marked as merged.
                </p>
                
                <div class="fp-merge-list" style="max-height: 300px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                    ${selected.map((f, i) => `
                        <label style="display: flex; gap: 12px; padding: 12px; border-bottom: 1px solid #f7fafc; cursor: pointer; background: ${i === 0 ? '#f0faf0' : 'white'};">
                            <input type="radio" name="masterFac" value="${f.id}" ${i === 0 ? 'checked' : ''}>
                            <div>
                                <div style="font-weight: 600; font-size: 14px; color: #2d3748;">${f.name}</div>
                                <div style="font-size: 12px; color: #718096;">📍 ${f.address || 'No address'}</div>
                                <div style="font-size: 12px; color: var(--fp-green);">${(f.activityTypes || []).join(', ')}</div>
                            </div>
                        </label>
                    `).join('')}
                </div>

                <div style="margin-top: 20px; padding: 12px; background: #FFF5F5; border: 1px solid #FED7D7; border-radius: 8px; color: #C53030; font-size: 12px;">
                    ⚠️ All inspection records, sanctions, and complaints from selected items will be linked to the Master.
                </div>
            </div>
            <div class="controls" style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px;">
                <button class="secondary" onclick="document.getElementById('modalContainer').innerHTML=''">Cancel</button>
                <button class="success" id="confirmMergeBtn">Execute Merge</button>
            </div>
        </div>
    </div>`;

    document.getElementById("confirmMergeBtn").addEventListener("click", async () => {
        const masterId = document.querySelector('input[name="masterFac"]:checked').value;
        const others = selected.filter(f => f.id !== masterId);
        
        const btn = document.getElementById("confirmMergeBtn");
        btn.disabled = true;
        btn.textContent = "Merging...";

        try {
            await executeFacilityMerge(masterId, others);
            document.getElementById('modalContainer').innerHTML = '';
            isMergeMode = false;
            selectedFacilities.clear();
            allFacilities = []; // force refresh
            renderFacilityProfilePage(document.getElementById('app'));
        } catch (e) {
            console.error(e);
            alert("Merge failed: " + e.message);
            btn.disabled = false;
            btn.textContent = "Execute Merge";
        }
    });
}

async function executeFacilityMerge(masterFacId, otherFacilities) {
    const masterData = allFacilities.find(f => f.id === masterFacId || f._docId === masterFacId);
    if (!masterData) throw new Error("Master facility data not found for ID: " + masterFacId);
    
    // 1. Collect all data to merge into master
    let allActivities = new Set(masterData.activityTypes || []);
    let allAliases = new Set(masterData.aliases || []);
    let masterAddr = masterData.address;
    
    for (const other of otherFacilities) {
        (other.activityTypes || []).forEach(at => allActivities.add(at));
        (other.aliases || []).forEach(al => allAliases.add(al));
        if (other.name !== masterData.name) allAliases.add(other.name);
        if (!masterAddr) masterAddr = other.address;
    }

    const batch = writeBatch(db);

    // 2. Update master record in Firestore
    batch.set(doc(db, "facilities", masterData._docId), {
        activityTypes: [...allActivities],
        aliases: [...allAliases],
        address: masterAddr || "",
        totalVisits: (masterData.totalVisits || 0) + otherFacilities.reduce((sum, f) => sum + (f.totalVisits || 0), 0),
        totalFinesIssued: (masterData.totalFinesIssued || 0) + otherFacilities.reduce((sum, f) => sum + (f.totalFinesIssued || 0), 0),
        lastUpdated: new Date().toISOString()
    }, { merge: true });

    // 3. Move sub-collection records (re-link facilityId)
    const collectionsToLink = ["inspections", "sanctions", "complaints", "facilityReports"];
    
    for (const collName of collectionsToLink) {
        for (const other of otherFacilities) {
            const oId = other.id || other._docId;
            // Find records by facilityId OR old name (for safety)
            const q = query(collection(db, collName), where("facilityId", "==", oId));
            const snap = await getDocs(q);
            
            for (const d of snap.docs) {
                batch.set(doc(db, collName, d.id), {
                    facilityId: masterFacId,
                    facilityName: masterData.name,
                    _mergedFrom: oId
                }, { merge: true });
            }
        }
    }

    // 4. Mark duplicates as merged/deleted
    for (const other of otherFacilities) {
        batch.set(doc(db, "facilities", other._docId), {
            status: "MERGED",
            mergedTo: masterFacId,
            deleted: true,
            lastUpdated: new Date().toISOString()
        }, { merge: true });
    }

    // Commit the entire group as a single atomic operation
    await batch.commit();
}

async function autoMergeFacilities(facilities) {
    console.log("[MERGE] autoMergeFacilities called with", facilities.length, "facilities");
    try {
    const modalContainer = document.getElementById("modalContainer");
    console.log("[MERGE] modalContainer:", modalContainer);
    modalContainer.innerHTML = `
    <div class="modal open">
        <div class="modal-content" style="max-width: 500px;">
            <div style="text-align:center; padding: 20px;">
                <div class="fp-spinner" style="margin: 0 auto 16px;"></div>
                <h4>Scanning for Duplicates...</h4>
                <p class="small muted">Analyzing ${facilities.length} facility records for name similarity.</p>
            </div>
        </div>
    </div>`;

    // 1. Prepare normalized names and addresses (skip already merged ones)
    const validFacilities = facilities.filter(f => !f.deleted && f.status !== "MERGED");
    const entries = validFacilities.filter(f => f.name).map((f, idx) => ({
        idx, fac: f,
        norm: normalizeFacilityName(f.name),
        addr: normalizeAddress(f.address)
    })).filter(e => e.norm);

    console.log(`[MERGE] Prepared ${entries.length} entries for matching`);

    // 2. Union-Find to merge overlapping groups
    const parent = entries.map((_, i) => i);
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function union(a, b) { parent[find(a)] = find(b); }

    // Layer 1: Exact normalized name match
    const nameMap = {};
    entries.forEach((e, i) => {
        if (nameMap[e.norm] !== undefined) union(i, nameMap[e.norm]);
        else nameMap[e.norm] = i;
    });

    // Layer 2: Fuzzy name match (Levenshtein)
    const normKeys = Object.keys(nameMap);
    for (let i = 0; i < normKeys.length; i++) {
        for (let j = i + 1; j < normKeys.length; j++) {
            if (fuzzyMatch(normKeys[i], normKeys[j])) {
                union(nameMap[normKeys[i]], nameMap[normKeys[j]]);
            }
        }
    }

    // Removed Layer 3 address matching as it was incorrectly grouping unrelated facilities in plazas.
    
    // 3. Build groups from union-find
    const groupMap = {};
    entries.forEach((e, i) => {
        const root = find(i);
        if (!groupMap[root]) groupMap[root] = [];
        groupMap[root].push(e.fac);
    });

    // 4. Filter groups with > 1 members and pick master
    const duplicateGroups = Object.values(groupMap)
        .filter(members => members.length > 1)
        .map(members => {
            const sorted = [...members].sort((a, b) => {
                const aAct = (a.activityTypes || []).length;
                const bAct = (b.activityTypes || []).length;
                if (bAct !== aAct) return bAct - aAct;
                if ((b.totalVisits || 0) !== (a.totalVisits || 0)) return (b.totalVisits || 0) - (a.totalVisits || 0);
                if (b.fileNumber && !a.fileNumber) return 1;
                if (a.fileNumber && !b.fileNumber) return -1;
                if (b.address && !a.address) return 1;
                if (a.address && !b.address) return -1;
                return 0;
            });
            return {
                norm: normalizeFacilityName(sorted[0].name),
                master: sorted[0],
                others: sorted.slice(1)
            };
        });

    console.log(`[MERGE] Found ${duplicateGroups.length} duplicate clusters`);

    if (duplicateGroups.length === 0) {
        modalContainer.innerHTML = `
        <div class="modal open">
            <div class="modal-content" style="max-width: 400px; text-align: center;">
                <div style="font-size: 40px; margin-bottom: 12px;">✅</div>
                <h4>No Duplicates Found</h4>
                <p class="small muted">The database appears to be lean and clean!</p>
                <div class="controls" style="margin-top: 20px;">
                    <button class="primary" onclick="document.getElementById('modalContainer').innerHTML=''">Great</button>
                </div>
            </div>
        </div>`;
        return;
    }

    showAutoMergePreview(duplicateGroups);
    } catch (err) {
        console.error("[MERGE] Error in autoMergeFacilities:", err);
        alert("Auto-consolidate error: " + err.message);
    }
}

function showAutoMergePreview(groups) {
    const modalContainer = document.getElementById("modalContainer");
    const totalOthers = groups.reduce((sum, g) => sum + g.others.length, 0);

    modalContainer.innerHTML = `
    <div class="modal open">
        <div class="modal-content" style="max-width: 600px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin:0;">Auto-Consolidation Preview</h3>
                <span style="font-size: 13px; background: #EBF8FF; color: #2B6CB0; padding: 4px 8px; border-radius: 4px;">Found ${groups.length} duplicate clusters</span>
            </div>
            
            <p style="font-size: 14px; color: #4a5568;">
                The system found <strong>${totalOthers}</strong> duplicate records that can be safely merged into their master profiles.
            </p>

            <div class="fp-auto-merge-list" style="margin-top: 16px; max-height: 350px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead style="background: #f7fafc; position: sticky; top: 0;">
                        <tr>
                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #edf2f7;">Master Facility</th>
                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #edf2f7;">Duplicates to Merge</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${groups.map(g => `
                            <tr style="border-bottom: 1px solid #f7fafc;">
                                <td style="padding: 10px; vertical-align: top;">
                                    <div style="font-weight: 600;">${g.master.name}</div>
                                    <div style="font-size: 11px; color: #718096;">📍 ${g.master.address || 'No address'}</div>
                                    <div style="margin-top:4px;">${(g.master.activityTypes || []).map(at => `<span class="fp-tag fp-tag-activity" style="font-size:9px; padding: 1px 4px;">${at}</span>`).join('')}</div>
                                </td>
                                <td style="padding: 10px; vertical-align: top; color: #718096;">
                                    ${g.others.map(o => `
                                        <div style="margin-bottom: 4px; padding: 4px; background: #FFF5F5; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                                            <span>${o.name} <span style="font-size: 10px;">(${(o.activityTypes || []).join(', ')})</span></span>
                                        </div>
                                    `).join('')}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div style="margin-top: 20px; padding: 12px; background: #fffaf0; border: 1px solid #feebc8; border-radius: 8px;">
                <p style="margin:0; font-size: 12px; color: #744210;">
                    <strong>Heuristic Merge:</strong> The system will select the profile with the most activity history as the master and link all inspection reports from duplicates to it.
                </p>
            </div>

            <div class="controls" style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px;">
                <button class="secondary" id="cancelAutoMergeBtn" onclick="document.getElementById('modalContainer').innerHTML=''">Cancel</button>
                <button class="success" id="executeAutoMergeBtn">✨ Merge All Duplicates</button>
            </div>
        </div>
    </div>`;

    document.getElementById("executeAutoMergeBtn").onclick = async () => {
        const btn = document.getElementById("executeAutoMergeBtn");
        const cancelBtn = document.getElementById("cancelAutoMergeBtn");
        btn.disabled = true;
        btn.textContent = "Merging... Please wait";
        
        let stopMerge = false;
        cancelBtn.textContent = "Stop Merging";
        cancelBtn.onclick = () => { stopMerge = true; cancelBtn.textContent = "Stopping..."; cancelBtn.disabled = true; };

        let successCount = 0;
        try {
            for (const group of groups) {
                if (stopMerge) break;
                const mId = group.master.id || group.master._docId;
                await executeFacilityMerge(mId, group.others);
                successCount++;
                btn.textContent = `Merging... (${successCount}/${groups.length})`;
            }

            if (stopMerge) {
                modalContainer.innerHTML = `
                <div class="modal open">
                    <div class="modal-content" style="max-width: 400px; text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 16px;">⏸️</div>
                        <h4 style="color: #d69e2e;">Merge Paused</h4>
                        <p class="small muted">Successfully merged <strong>${successCount} clusters</strong> before pausing.</p>
                        <p class="small muted" style="margin-top:8px;">You can safely close the app. When you return, the remaining duplicates will be detected automatically.</p>
                        <div class="controls" style="margin-top: 24px;">
                            <button class="primary" onclick="location.reload()">Refresh Directory</button>
                        </div>
                    </div>
                </div>`;
                return;
            }

            modalContainer.innerHTML = `
            <div class="modal open">
                <div class="modal-content" style="max-width: 400px; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🚀</div>
                    <h4 style="color: var(--fp-green);">Database Consolidated!</h4>
                    <p class="small muted">Successfully merged <strong>${groups.length} clusters</strong> and cleaned up <strong>${totalOthers} duplicate records</strong>.</p>
                    <div class="controls" style="margin-top: 24px;">
                        <button class="primary" onclick="location.reload()">Refresh Directory</button>
                    </div>
                </div>
            </div>`;
        } catch (e) {
            console.error(e);
            alert("Error during batch merge: " + e.message);
            btn.disabled = false;
            btn.textContent = "✨ Merge All Duplicates";
        }
    };
}


// ==========================================
// 🔗 AUTO-LINK BRANCHES (SAME ADDRESS)
// ==========================================

async function autoLinkFacilities(facilities) {
    console.log("[LINK] autoLinkFacilities called");
    try {
        const modalContainer = document.getElementById("modalContainer");
        modalContainer.innerHTML = `
        <div class="modal open">
            <div class="modal-content" style="max-width: 500px;">
                <div style="text-align:center; padding: 20px;">
                    <div class="fp-spinner" style="margin: 0 auto 16px;"></div>
                    <h4>Scanning for Co-located Branches...</h4>
                    <p class="small muted">Finding distinct businesses sharing the exact same address.</p>
                </div>
            </div>
        </div>`;

        // 1. Group by exact normalized address
        const addrMap = {};
        facilities.forEach(f => {
            if (f.status === "MERGED" || f.deleted) return;
            const addr = normalizeAddress(f.address);
            if (!addr || addr.length < 10) return; // ignore short/blank addresses
            if (!addrMap[addr]) addrMap[addr] = [];
            addrMap[addr].push(f);
        });

        const linkGroups = [];
        
        Object.values(addrMap).forEach(members => {
            if (members.length <= 1) return;
            
            // Inside this shared address, group by fuzzy name to separate ACTUAL branches from DUPLICATE entries
            const nameGroups = [];
            members.forEach(f => {
                const norm = normalizeFacilityName(f.name);
                let found = false;
                for (const ng of nameGroups) {
                    if (fuzzyMatch(ng.norm, norm)) {
                        ng.facilities.push(f);
                        found = true; break;
                    }
                }
                if (!found) nameGroups.push({ norm, facilities: [f] });
            });
            
            // If there's only 1 distinct name group at this address, they are just typos of each other. They should be Merged, not Linked.
            if (nameGroups.length <= 1) return;
            
            // Sort name groups by activity footprint to pick the Parent Head Store
            nameGroups.sort((a, b) => {
                const aScore = a.facilities.reduce((sum, f) => sum + (f.totalVisits || 0) + (f.activityTypes || []).length, 0);
                const bScore = b.facilities.reduce((sum, f) => sum + (f.totalVisits || 0) + (f.activityTypes || []).length, 0);
                return bScore - aScore;
            });
            
            const parentGroup = nameGroups[0];
            const branchGroups = nameGroups.slice(1);
            
            // Pick master of parent Group
            const parentMaster = parentGroup.facilities.sort((a, b) => ((b.totalVisits || 0) - (a.totalVisits || 0)))[0];
            const branchMasters = branchGroups.map(bg => bg.facilities.sort((a,b) => ((b.totalVisits || 0) - (a.totalVisits || 0)))[0]);
            
            // Ignore if parent already has branches mapped exactly (prevent re-running unecessarily)
            // Or if branches are already marked as branches
            const validBranches = branchMasters.filter(b => !b.isBranch);
            
            if (validBranches.length > 0) {
                linkGroups.push({
                    parent: parentMaster,
                    branches: validBranches,
                    address: parentMaster.address
                });
            }
        });

        if (linkGroups.length === 0) {
            modalContainer.innerHTML = `
            <div class="modal open">
                <div class="modal-content" style="max-width: 400px; text-align: center;">
                    <div style="font-size: 40px; margin-bottom: 12px;">✅</div>
                    <h4>No Co-located Branches Found</h4>
                    <p class="small muted">No distinct facilities were found sharing identical addresses.</p>
                    <div class="controls" style="margin-top: 20px;">
                        <button class="primary" onclick="document.getElementById('modalContainer').innerHTML=''">Great</button>
                    </div>
                </div>
            </div>`;
            return;
        }

        showAutoLinkPreview(linkGroups);
    } catch (err) {
        console.error("[LINK] Error:", err);
        alert("Link error: " + err.message);
    }
}

function showAutoLinkPreview(groups) {
    const modalContainer = document.getElementById("modalContainer");
    const totalBranches = groups.reduce((sum, g) => sum + g.branches.length, 0);

    modalContainer.innerHTML = `
    <div class="modal open">
        <div class="modal-content" style="max-width: 650px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin:0;">Auto-Link Branches Preview</h3>
                <span style="font-size: 13px; background: #EBF8FF; color: #2B6CB0; padding: 4px 8px; border-radius: 4px;">Found ${groups.length} locations</span>
            </div>
            
            <p style="font-size: 14px; color: #4a5568;">
                The system found <strong>${totalBranches}</strong> facilities operating at the exact same addresses as other major profiles. They will be linked under the <strong>Branches</strong> tab of the most active facility at that location.
            </p>

            <div class="fp-auto-merge-list" style="margin-top: 16px; max-height: 350px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead style="background: #f7fafc; position: sticky; top: 0;">
                        <tr>
                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #edf2f7; width:50%;">Parent (Head Store)</th>
                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #edf2f7;">Branches to Link</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${groups.map(g => `
                            <tr style="border-bottom: 1px solid #f7fafc;">
                                <td style="padding: 10px; vertical-align: top; background: #f0fff4; border-right: 1px solid #e2e8f0;">
                                    <div style="font-weight: 600; color: #276749;">${g.parent.name}</div>
                                    <div style="font-size: 11px; color: #718096; margin-top: 4px;">📍 ${g.address}</div>
                                </td>
                                <td style="padding: 10px; vertical-align: top; color: #718096;">
                                    ${g.branches.map(b => `
                                        <div style="margin-bottom: 6px; padding: 6px; background: #f7fafc; border: 1px dashed #cbd5e0; border-radius: 4px;">
                                            <div style="font-weight: 500; color: #4a5568;">↳ ${b.name}</div>
                                            <div style="font-size: 10px; margin-top: 4px;">
                                                ${(b.activityTypes || []).join(', ')}
                                            </div>
                                        </div>
                                    `).join('')}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="controls" style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px;">
                <button class="secondary" onclick="document.getElementById('modalContainer').innerHTML=''">Cancel</button>
                <button class="success" id="executeAutoLinkBtn">🔗 Link All Branches</button>
            </div>
        </div>
    </div>`;

    document.getElementById("executeAutoLinkBtn").onclick = async () => {
        const btn = document.getElementById("executeAutoLinkBtn");
        btn.disabled = true;
        btn.textContent = "Linking... Please wait";

        let successCount = 0;
        try {
            for (const group of groups) {
                const parentId = group.parent.id || group.parent._docId;
                await executeFacilityLink(parentId, group.branches);
                successCount++;
                btn.textContent = `Linking... (${successCount}/${groups.length})`;
            }

            modalContainer.innerHTML = `
            <div class="modal open">
                <div class="modal-content" style="max-width: 400px; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🏢</div>
                    <h4 style="color: var(--fp-green);">Branches Linked!</h4>
                    <p class="small muted">Successfully established relationships for <strong>${totalBranches} branches</strong> across <strong>${groups.length} locations</strong>.</p>
                    <div class="controls" style="margin-top: 24px;">
                        <button class="primary" onclick="location.reload()">Refresh Directory</button>
                    </div>
                </div>
            </div>`;
        } catch (e) {
            console.error(e);
            alert("Error during branch linking: " + e.message);
            btn.disabled = false;
            btn.textContent = "🔗 Link All Branches";
        }
    };
}

async function executeFacilityLink(parentFacId, branchFacilities) {
    const parentData = allFacilities.find(f => f.id === parentFacId || f._docId === parentFacId);
    if (!parentData) throw new Error("Parent not found");
    
    const batch = writeBatch(db);
    
    const existingBranches = new Set(parentData.branches || []);
    branchFacilities.forEach(b => existingBranches.add(b.id || b._docId));
    
    // Update parent
    batch.set(doc(db, "facilities", parentData._docId), {
        branches: [...existingBranches],
        lastUpdated: new Date().toISOString()
    }, { merge: true });
    
    // Update branches
    for (const b of branchFacilities) {
        batch.set(doc(db, "facilities", b._docId), {
            isBranch: true,
            parentFacilityId: parentFacId,
            parentFacilityName: parentData.name,
            lastUpdated: new Date().toISOString()
        }, { merge: true });
    }
    
    await batch.commit();
}

async function renderBranchesTab(container, facId, facName) {
    container.innerHTML = `<div class="fp-spinner" style="margin:40px auto;"></div>`;
    
    const fac = allFacilities.find(f => f.id === facId || f._docId === facId);
    if (!fac) return;
    
    let html = `<div style="padding: 20px;">
        <h4 style="margin-top:0; color: #2d3748; font-size: 18px;">Registered Branches & Co-located Stores</h4>
        <p class="small muted" style="margin-bottom: 24px; font-size: 13px;">Facilities operating at the same address or officially registered as branches under <strong>${facName}</strong>.</p>
    `;
    
    const branches = fac.branches || [];
    
    if (branches.length === 0 && !fac.isBranch) {
        html += `
        <div style="text-align: center; padding: 40px 20px; background: #f7fafc; border-radius: 8px; border: 1px dashed #e2e8f0;">
            <div style="font-size: 32px; margin-bottom: 12px; color: #cbd5e0;">🏢</div>
            <h5 style="color: #4a5568; margin: 0 0 8px;">No Branches Found</h5>
            <p class="muted small" style="margin: 0;">This facility has no registered branches or head office links.</p>
        </div>`;
    } else {
        html += `<div style="display: flex; flex-direction: column; gap: 12px;">`;
        
        // Emphasize the Parent Head Store if this is a branch
        if (fac.isBranch && fac.parentFacilityId) {
            const pf = allFacilities.find(f => f.id === fac.parentFacilityId || f._docId === fac.parentFacilityId);
            if (pf) {
                html += `
                <div style="padding: 16px; border: 2px solid #319795; border-radius: 8px; background: #e6fffa; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(49, 151, 149, 0.1);">
                    <div>
                        <div style="font-size: 11px; font-weight: 800; color: #319795; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.05em;">★ Head Store / Parent Facility</div>
                        <div style="font-weight: 700; font-size: 16px; color: #234e52; margin-bottom: 4px;">${pf.name}</div>
                        <div style="font-size: 13px; color: #285e61;">📍 ${pf.address}</div>
                    </div>
                </div>`;
            }
        }
        
        // List Sub-branches
        if (branches.length > 0) {
            html += `<h5 style="margin: 16px 0 8px; color: #4a5568; font-size: 12px; text-transform: uppercase;">Sub-Branches / Vendors (${branches.length})</h5>`;
            
            for (const bId of branches) {
                const b = allFacilities.find(f => f.id === bId || f._docId === bId);
                if (!b) continue;
                
                html += `
                <div style="padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s;">
                    <div>
                        <div style="font-weight: 600; font-size: 15px; color: #2d3748; margin-bottom: 4px;">↳ ${b.name}</div>
                        <div style="font-size: 12px; color: #718096; display: flex; gap: 12px;">
                            <span>📍 ${b.address}</span>
                            <span>📦 Visits: ${b.totalVisits || 0}</span>
                        </div>
                        <div style="margin-top: 8px;">
                            ${(b.activityTypes || []).map(at => `<span class="fp-tag fp-tag-activity" style="font-size: 10px; padding: 2px 6px;">${at}</span>`).join('')}
                        </div>
                    </div>
                </div>`;
            }
        }
        
        html += `</div>`;
    }
    
    html += `</div>`;
    container.innerHTML = html;
}
