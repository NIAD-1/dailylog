import { db, collection, getDocs, addDoc, doc, setDoc, query, where } from "./db.js";
import { resolveFacility } from "./facility-utils.js";

/* ─── Smart Loggers Module ───────────────────────────────────────────────── */
/* Standalone forms for logging complaints and sanctions with intelligent
   facility matching — auto-links to existing facilities or creates new ones. */

let cachedFacilities = null;

async function getFacilities() {
    if (cachedFacilities) return cachedFacilities;
    const snap = await getDocs(collection(db, "facilities"));
    cachedFacilities = [];
    snap.forEach(d => {
        const data = d.data();
        data._docId = d.id;
        cachedFacilities.push(data);
    });
    cachedFacilities.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return cachedFacilities;
}

function invalidateCache() { cachedFacilities = null; }

/* ─── Smart Facility Picker Component ────────────────────────────────────── */

function renderFacilityPicker(inputId, resultsId, hiddenId, label = "Facility / Outlet") {
    return `
    <div class="form-group sl-picker-wrap">
        <label>${label}</label>
        <div style="position: relative;">
            <input type="text" id="${inputId}" autocomplete="off" placeholder="Start typing facility name...">
            <div id="${resultsId}" class="sl-picker-results"></div>
            <input type="hidden" id="${hiddenId}">
        </div>
        <div id="${inputId}_status" class="sl-picker-status"></div>
    </div>`;
}

function bindFacilityPicker(inputId, resultsId, hiddenId, facilities) {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    const hidden = document.getElementById(hiddenId);
    const status = document.getElementById(inputId + "_status");
    if (!input || !results || !hidden) return;

    input.addEventListener("input", () => {
        const q = input.value.trim().toUpperCase();
        hidden.value = "";

        if (q.length < 2) {
            results.innerHTML = "";
            results.classList.remove("visible");
            status.innerHTML = "";
            return;
        }

        const matches = facilities.filter(f =>
            (f.name || "").toUpperCase().includes(q) ||
            (f.address || "").toUpperCase().includes(q)
        ).slice(0, 10);

        let html = matches.map(f => `
            <div class="sl-picker-item" data-id="${f.id}" data-name="${f.name}" data-docid="${f._docId}">
                <div class="sl-picker-item-name">${highlightMatch(f.name, q)}</div>
                <div class="sl-picker-item-meta">${f.address || ""} ${f.zone ? `· ${f.zone}` : ""}</div>
            </div>
        `).join("");

        // Always add "Create new" option
        html += `
            <div class="sl-picker-item sl-picker-new" data-id="__NEW__" data-name="${input.value.trim()}">
                <div class="sl-picker-item-name" style="color: var(--fp-green); font-weight: 600;">
                    + Create new facility: "${input.value.trim()}"
                </div>
            </div>`;

        results.innerHTML = html;
        results.classList.add("visible");

        results.querySelectorAll(".sl-picker-item").forEach(el => {
            el.addEventListener("click", () => {
                if (el.dataset.id === "__NEW__") {
                    hidden.value = "__NEW__";
                    input.value = el.dataset.name;
                    status.innerHTML = `<span style="color: var(--fp-green);">✨ New facility will be created on save</span>`;
                } else {
                    hidden.value = el.dataset.id;
                    hidden.dataset.docId = el.dataset.docid;
                    input.value = el.dataset.name;
                    status.innerHTML = `<span style="color: #1565C0;">✓ Linked to existing facility</span>`;
                }
                results.innerHTML = "";
                results.classList.remove("visible");
            });
        });
    });

    // Close on outside click
    document.addEventListener("click", (e) => {
        if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${resultsId}`)) {
            results.innerHTML = "";
            results.classList.remove("visible");
        }
    });
}

function highlightMatch(text, query) {
    if (!text || !query) return text || "";
    const idx = text.toUpperCase().indexOf(query);
    if (idx === -1) return text;
    return text.slice(0, idx) + `<mark>${text.slice(idx, idx + query.length)}</mark>` + text.slice(idx + query.length);
}

// Helper from utility
async function resolveOrCreateFacilityWrapper(nameInputId, hiddenId, addressInputId) {
    const hidden = document.getElementById(hiddenId);
    const nameInput = document.getElementById(nameInputId);
    const name = nameInput.value.trim();
    const address = addressInputId ? (document.getElementById(addressInputId)?.value?.trim() || "") : "";

    if (!name) throw new Error("Facility name is required");

    // Existing facility matched via Picker
    if (hidden.value && hidden.value !== "__NEW__") {
        return { facilityId: hidden.value, facilityName: name, docId: hidden.dataset.docId, isNew: false };
    }

    // Fallback or New: Use centralized resolver
    return await resolveFacility(name, address, "smart_logger");
}

/* ─── Consumer Complaint Page ────────────────────────────────────────────── */

export function renderComplaintLoggerPage(root) {
    root.innerHTML = `
    <section class="sl-page">
        <div class="sl-page-header">
            <h2>📋 Log Consumer Complaint</h2>
            <p>Record a new consumer complaint. The system will automatically link it to the correct facility.</p>
        </div>

        <div class="sl-form-card">
            <div class="sl-section-title">Complainant Details</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Complainant Name</label>
                    <input type="text" id="slComplainantName" placeholder="Full name">
                </div>
                <div class="form-group">
                    <label>Phone Number</label>
                    <input type="tel" id="slComplainantPhone" placeholder="08012345678">
                </div>
            </div>

            <div class="sl-section-title" style="margin-top: 24px;">Product Information</div>
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Product Name</label>
                    <input type="text" id="slProductName" placeholder="e.g. Paracetamol 500mg Tablets">
                </div>
                <div class="form-group">
                    <label>Product Type</label>
                    <select id="slProductType">
                        <option value="Drug">Drug</option>
                        <option value="Food">Food</option>
                        <option value="Cosmetic">Cosmetic</option>
                        <option value="Medical Device">Medical Device</option>
                        <option value="Chemical">Chemical</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Batch Number (if available)</label>
                    <input type="text" id="slBatchNo" placeholder="e.g. BN2025-001">
                </div>
                <div class="form-group">
                    <label>NAFDAC Reg. No. (if available)</label>
                    <input type="text" id="slRegNo" placeholder="e.g. A4-1234">
                </div>
            </div>

            <div class="sl-section-title" style="margin-top: 24px;">Outlet / Place of Purchase</div>
            ${renderFacilityPicker("slOutletName", "slOutletResults", "slOutletId", "Outlet / Place of Purchase")}
            <div class="form-group">
                <label>Outlet Address (if new)</label>
                <input type="text" id="slOutletAddress" placeholder="Address of the outlet">
            </div>

            <div class="sl-section-title" style="margin-top: 24px;">Manufacturer / Company</div>
            ${renderFacilityPicker("slMfgName", "slMfgResults", "slMfgId", "Manufacturer / Importer")}

            <div class="sl-section-title" style="margin-top: 24px;">Complaint Details</div>
            <div class="form-group">
                <label>Nature of Complaint</label>
                <select id="slComplaintNature">
                    <option value="Adverse Reaction">Adverse Reaction</option>
                    <option value="Substandard">Substandard Product</option>
                    <option value="Counterfeit">Suspected Counterfeit</option>
                    <option value="Wrong Labelling">Wrong Labelling</option>
                    <option value="Discolouration">Discolouration</option>
                    <option value="Expired Product">Expired Product</option>
                    <option value="Foreign Matter">Foreign Matter</option>
                    <option value="Unregistered">Unregistered Product</option>
                    <option value="Other">Other</option>
                </select>
            </div>
            <div class="form-group">
                <label>Complaint Description</label>
                <textarea id="slComplaintDesc" rows="4" placeholder="Detailed description of the complaint..."></textarea>
            </div>
            <div class="form-group">
                <label>Action Taken</label>
                <textarea id="slActionTaken" rows="3" placeholder="e.g. Sample collected, product sealed, warning letter issued..."></textarea>
            </div>
            <div class="form-group">
                <label>Outcome / Status</label>
                <select id="slOutcome">
                    <option value="Under Investigation">Under Investigation</option>
                    <option value="Resolved">Resolved</option>
                    <option value="Referred">Referred to HQ</option>
                    <option value="Product Recalled">Product Recalled</option>
                    <option value="Closed">Closed</option>
                </select>
            </div>

            <div class="sl-form-actions">
                <button class="secondary" onclick="window.location.hash='facilities'">Cancel</button>
                <button class="success" id="slSubmitComplaint">
                    <span id="slSubmitText">Submit Complaint</span>
                </button>
            </div>
        </div>

        <div id="slSuccessMsg" class="sl-success hidden"></div>
    </section>`;

    // Bind pickers after DOM render
    initComplaintPage();
}

async function initComplaintPage() {
    try {
        const facilities = await getFacilities();
        bindFacilityPicker("slOutletName", "slOutletResults", "slOutletId", facilities);
        bindFacilityPicker("slMfgName", "slMfgResults", "slMfgId", facilities);
    } catch (e) {
        console.error("Error loading facilities for picker:", e);
    }

    document.getElementById("slSubmitComplaint").addEventListener("click", handleSubmitComplaint);
}

async function handleSubmitComplaint() {
    const btn = document.getElementById("slSubmitComplaint");
    const text = document.getElementById("slSubmitText");
    btn.disabled = true;
    text.textContent = "Saving...";

    try {
        // Resolve or create outlet facility
        let outletInfo = { facilityId: "", facilityName: "", isNew: false };
        if (document.getElementById("slOutletName").value.trim()) {
            outletInfo = await resolveOrCreateFacilityWrapper("slOutletName", "slOutletId", "slOutletAddress");
        }

        // Resolve or create manufacturer
        let mfgInfo = { facilityId: "", facilityName: "", isNew: false };
        if (document.getElementById("slMfgName").value.trim()) {
            mfgInfo = await resolveOrCreateFacilityWrapper("slMfgName", "slMfgId", null);
        }

        const complaint = {
            complainantName: document.getElementById("slComplainantName").value.trim(),
            complainantPhone: document.getElementById("slComplainantPhone").value.trim(),
            product: document.getElementById("slProductName").value.trim(),
            productType: document.getElementById("slProductType").value,
            batchNumber: document.getElementById("slBatchNo").value.trim(),
            regNumber: document.getElementById("slRegNo").value.trim(),
            outletFacilityId: outletInfo.facilityId,
            outletName: outletInfo.facilityName,
            manufacturerFacilityId: mfgInfo.facilityId,
            manufacturerName: mfgInfo.facilityName,
            facilityId: outletInfo.facilityId || mfgInfo.facilityId, // primary link
            facilityName: outletInfo.facilityName || mfgInfo.facilityName,
            complaintNature: document.getElementById("slComplaintNature").value,
            complaint: document.getElementById("slComplaintDesc").value.trim(),
            actionTaken: document.getElementById("slActionTaken").value.trim(),
            outcome: document.getElementById("slOutcome").value,
            year: new Date().getFullYear(),
            dateLogged: new Date().toISOString().split("T")[0],
            source: "smart_logger"
        };

        await addDoc(collection(db, "complaints"), complaint);

        // If manufacturer is different from outlet, also create a linked complaint for manufacturer
        if (mfgInfo.facilityId && mfgInfo.facilityId !== outletInfo.facilityId) {
            const mfgComplaint = { ...complaint, facilityId: mfgInfo.facilityId, facilityName: mfgInfo.facilityName, linkType: "manufacturer" };
            await addDoc(collection(db, "complaints"), mfgComplaint);
        }

        // Show success
        document.getElementById("slSuccessMsg").classList.remove("hidden");
        document.getElementById("slSuccessMsg").innerHTML = `
            <div style="text-align: center; padding: 32px;">
                <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
                <h3 style="color: var(--fp-green); margin-bottom: 8px;">Complaint Logged Successfully</h3>
                <p style="color: #718096; margin-bottom: 24px;">
                    ${outletInfo.isNew ? `New facility "${outletInfo.facilityName}" was created. ` : ""}
                    ${mfgInfo.isNew ? `New manufacturer "${mfgInfo.facilityName}" was created. ` : ""}
                    The complaint is now visible on the facility profile(s).
                </p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button class="secondary" onclick="window.location.hash='log-complaint'">Log Another</button>
                    <button class="primary" style="background: var(--fp-green); color: white; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer;" onclick="window.location.hash='facilities'">View Facilities</button>
                </div>
            </div>`;

        document.querySelector(".sl-form-card").style.display = "none";

    } catch (e) {
        console.error(e);
        alert("Error submitting complaint: " + e.message);
        btn.disabled = false;
        text.textContent = "Submit Complaint";
    }
}

/* ─── Sanction Logger Page ───────────────────────────────────────────────── */

export function renderSanctionLoggerPage(root) {
    root.innerHTML = `
    <section class="sl-page">
        <div class="sl-page-header">
            <h2>💰 Log Sanction / Fine</h2>
            <p>Record a new administrative sanction or fine against a facility.</p>
        </div>

        <div class="sl-form-card">
            <div class="sl-section-title">Facility</div>
            ${renderFacilityPicker("slSanctionFacility", "slSanctionResults", "slSanctionFacId", "Facility Name")}
            <div class="form-group">
                <label>Facility Address (if new)</label>
                <input type="text" id="slSanctionFacAddr" placeholder="Address of the facility (for new entries)">
            </div>

            <div class="sl-section-title" style="margin-top: 24px;">Sanction Details</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                    <label>Year</label>
                    <input type="number" id="slSanctionYear" value="${new Date().getFullYear()}" min="2016" max="${new Date().getFullYear()}">
                </div>
                <div class="form-group">
                    <label>Amount (₦)</label>
                    <input type="number" id="slSanctionAmount" placeholder="e.g. 50000">
                </div>
            </div>
            <div class="form-group">
                <label>Offence / Reason</label>
                <textarea id="slSanctionOffence" rows="3" placeholder="Describe the offence..."></textarea>
            </div>
            <div class="form-group">
                <label>Payment Status</label>
                <select id="slSanctionStatus">
                    <option value="UNPAID">Unpaid</option>
                    <option value="PAID">Paid</option>
                    <option value="PARTIAL">Partial</option>
                </select>
            </div>

            <div class="sl-form-actions">
                <button class="secondary" onclick="window.location.hash='facilities'">Cancel</button>
                <button class="success" id="slSubmitSanction">
                    <span id="slSanctionSubmitText">Submit Sanction</span>
                </button>
            </div>
        </div>

        <div id="slSanctionSuccessMsg" class="sl-success hidden"></div>
    </section>`;

    initSanctionPage();
}

async function initSanctionPage() {
    try {
        const facilities = await getFacilities();
        bindFacilityPicker("slSanctionFacility", "slSanctionResults", "slSanctionFacId", facilities);
    } catch (e) {
        console.error("Error loading facilities:", e);
    }

    document.getElementById("slSubmitSanction").addEventListener("click", handleSubmitSanction);
}

async function handleSubmitSanction() {
    const btn = document.getElementById("slSubmitSanction");
    const text = document.getElementById("slSanctionSubmitText");
    btn.disabled = true;
    text.textContent = "Saving...";

    try {
        const facInfo = await resolveOrCreateFacilityWrapper("slSanctionFacility", "slSanctionFacId", "slSanctionFacAddr");

        const sanction = {
            facilityId: facInfo.facilityId,
            facilityName: facInfo.facilityName,
            year: parseInt(document.getElementById("slSanctionYear").value) || new Date().getFullYear(),
            amount: parseFloat(document.getElementById("slSanctionAmount").value) || 0,
            offence: document.getElementById("slSanctionOffence").value.trim(),
            paymentStatus: document.getElementById("slSanctionStatus").value,
            dateLogged: new Date().toISOString().split("T")[0],
            source: "smart_logger"
        };

        await addDoc(collection(db, "sanctions"), sanction);

        document.getElementById("slSanctionSuccessMsg").classList.remove("hidden");
        document.getElementById("slSanctionSuccessMsg").innerHTML = `
            <div style="text-align: center; padding: 32px;">
                <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
                <h3 style="color: var(--fp-green); margin-bottom: 8px;">Sanction Recorded</h3>
                <p style="color: #718096; margin-bottom: 24px;">
                    ${facInfo.isNew ? `New facility "${facInfo.facilityName}" was created. ` : ""}
                    ₦${sanction.amount.toLocaleString()} sanction logged for ${facInfo.facilityName}.
                </p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button class="secondary" onclick="window.location.hash='log-sanction'">Log Another</button>
                    <button class="primary" style="background: var(--fp-green); color: white; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer;" onclick="window.location.hash='facilities'">View Facilities</button>
                </div>
            </div>`;

        document.querySelector(".sl-form-card").style.display = "none";

    } catch (e) {
        console.error(e);
        alert("Error submitting sanction: " + e.message);
        btn.disabled = false;
        text.textContent = "Submit Sanction";
    }
}
