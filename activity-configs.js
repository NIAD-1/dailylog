/**
 * Directorate Activities Domain Configurations
 * Standardizes metadata, Firestore collections, table columns, KPI cards, charts, and forms.
 */

export const LAGOS_LGAS = [
  "Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa",
  "Badagry", "Epe", "Eti-Osa", "Ibeju-Lekki", "Ifako-Ijaiye",
  "Ikeja", "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland",
  "Mushin", "Ojo", "Oshodi-Isolo", "Shomolu", "Surulere"
];

// 1. ALERTS CONFIGURATION
export const ALERTS_CONFIG = {
  key: "alerts",
  title: "Regulatory Alerts",
  subtitle: "Track, record and investigate international and domestic product alerts",
  collection: "alerts",
  teamsRootFolder: "/ALERTS",
  defaultStatus: "Open",
  statuses: ["Open", "Under Investigation", "Closed"],
  columns: [
    { key: "alertNo", label: "Alert No.", format: "code" },
    { key: "dateReceived", label: "Date Received", format: "date" },
    { key: "source", label: "Source" },
    { key: "title", label: "Title / Product Details", format: "bold" },
    { key: "actionTaken", label: "Action Taken" },
    { key: "facilitiesVisited", label: "Facilities Visited" },
    { key: "findings", label: "Findings / Remarks" },
    { key: "status", label: "Status", format: "badge" },
    { key: "teamsFolderUrl", label: "Teams Folder", format: "teams" }
  ],
  kpis: [
    { id: "totalAlerts", label: "Total Alerts", color: "accent-green", calc: (items) => items.length },
    { id: "openAlerts", label: "Open Alerts", color: "accent-amber", calc: (items) => items.filter(a => (a.status || "Open").toLowerCase() === "open").length },
    { id: "investigatingAlerts", label: "Under Investigation", color: "accent-blue", calc: (items) => items.filter(a => (a.status || "").toLowerCase().includes("investig")).length },
    { id: "closedAlerts", label: "Resolved / Closed", color: "accent-green", calc: (items) => items.filter(a => (a.status || "").toLowerCase() === "closed").length }
  ],
  charts: [
    {
      id: "chartAlertsByMonth",
      type: "bar",
      title: "Alerts Received by Month",
      generate: (items) => {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const counts = Array(12).fill(0);
        items.forEach(item => {
          const d = item.dateReceived ? new Date(item.dateReceived) : null;
          if (d && !isNaN(d.getMonth())) {
            counts[d.getMonth()]++;
          } else if (item.month) {
            const mIdx = months.findIndex(m => m.toLowerCase() === String(item.month).substring(0, 3).toLowerCase());
            if (mIdx >= 0) counts[mIdx]++;
          }
        });
        return {
          labels: months,
          datasets: [{
            label: "Alerts Received",
            data: counts,
            backgroundColor: "#008751",
            borderRadius: 4
          }]
        };
      }
    },
    {
      id: "chartAlertsStatus",
      type: "doughnut",
      title: "Status Breakdown",
      generate: (items) => {
        const open = items.filter(a => (a.status || "Open").toLowerCase() === "open").length;
        const investigating = items.filter(a => (a.status || "").toLowerCase().includes("investig")).length;
        const closed = items.filter(a => (a.status || "").toLowerCase() === "closed").length;
        return {
          labels: ["Open", "Under Investigation", "Closed"],
          datasets: [{
            data: [open, investigating, closed],
            backgroundColor: ["#f59e0b", "#3b82f6", "#10b981"]
          }]
        };
      }
    }
  ],
  generateInsights: (items) => {
    const insights = [];
    const total = items.length;
    if (total === 0) return ["No alert records available for this period."];
    
    const open = items.filter(a => (a.status || "Open").toLowerCase() === "open").length;
    insights.push(`Currently tracking ${total} total alerts, with ${open} cases actively pending mop-up.`);

    const sourceCounts = {};
    items.forEach(a => {
      const src = (a.source || "Unknown").trim();
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    });
    const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0];
    if (topSource) {
      insights.push(`Primary alert origin: ${topSource[0]} (${topSource[1]} alerts registered).`);
    }

    const currentYear = new Date().getFullYear();
    const currentYearAlerts = items.filter(a => String(a.year) === String(currentYear) || (a.dateReceived && String(a.dateReceived).includes(String(currentYear))));
    insights.push(`${currentYearAlerts.length} alerts logged in current year ${currentYear}.`);

    return insights;
  },
  logFields: [
    { name: "alertNo", label: "Alert Number (e.g., ALT/2026/001)", type: "text", required: true },
    { name: "dateReceived", label: "Date Received", type: "date", required: true },
    { name: "source", label: "Source of Alert (e.g., WHO, PMS HQ, Public)", type: "text", required: true },
    { name: "title", label: "Alert Title / Product Details", type: "textarea", required: true, rows: 2 },
    { name: "facilitiesVisited", label: "Target / Initial Outlets Identified", type: "textarea", rows: 2 },
    { name: "actionTaken", label: "Action Taken / Directives Issued", type: "textarea", rows: 2 },
    { name: "findings", label: "Findings & Remarks", type: "textarea", rows: 2 },
    { name: "status", label: "Current Status", type: "select", options: ["Open", "Under Investigation", "Closed"], default: "Open" }
  ]
};

// 2. CONSUMER COMPLAINTS CONFIGURATION
export const COMPLAINTS_CONFIG = {
  key: "complaints",
  title: "Consumer Complaints",
  subtitle: "Continuous docket: Intake → Field Investigation → Regulatory Action → Complainant Feedback & Closure",
  collection: "complaints",
  isDocket: true, // triggers specialized case docket view
  teamsRootFolder: "/CONSUMER COMPLAINT",
  defaultStatus: "Open",
  statuses: ["Open", "Under Investigation", "Enforcement in Progress", "Closed"],
  columns: [
    { key: "referenceCode", label: "Ref Code", format: "code" },
    { key: "dateReceived", label: "Date", format: "date" },
    { key: "complainant", label: "Complainant" },
    { key: "caseInfo", label: "Product & Case Details", format: "bold" },
    { key: "productType", label: "Product Type" },
    { key: "actionTaken", label: "Enforcement Action" },
    { key: "status", label: "Status", format: "badge" },
    { key: "feedbackIssued", label: "Feedback Status", format: "feedback" },
    { key: "teamsFolderUrl", label: "Teams Folder", format: "teams" }
  ],
  kpis: [
    { id: "totalComplaints", label: "Total Complaints", color: "accent-blue", calc: (items) => items.length },
    { id: "openComplaints", label: "Open (Intake)", color: "accent-amber", calc: (items) => items.filter(c => (c.status || "Open").toLowerCase() === "open").length },
    { id: "activeInvestigation", label: "Active Investigation", color: "accent-blue", calc: (items) => items.filter(c => (c.status || "").toLowerCase().includes("investig") || (c.status || "").toLowerCase().includes("enforce")).length },
    { id: "closedComplaints", label: "Feedback Issued & Closed", color: "accent-green", calc: (items) => items.filter(c => (c.status || "").toLowerCase() === "closed" || c.feedbackIssued).length }
  ],
  charts: [
    {
      id: "chartComplaintsByMonth",
      type: "bar",
      title: "Complaints Received by Month",
      generate: (items) => {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const counts = Array(12).fill(0);
        items.forEach(item => {
          const d = item.dateReceived ? new Date(item.dateReceived) : (item.dateLogged ? new Date(item.dateLogged) : null);
          if (d && !isNaN(d.getMonth())) {
            counts[d.getMonth()]++;
          }
        });
        return {
          labels: months,
          datasets: [{
            label: "Complaints Received",
            data: counts,
            backgroundColor: "#2563eb",
            borderRadius: 4
          }]
        };
      }
    },
    {
      id: "chartComplaintsProductType",
      type: "doughnut",
      title: "Complaints by Product Type",
      generate: (items) => {
        const types = {};
        items.forEach(c => {
          const pt = (c.productType || "General Food/Drug").trim();
          types[pt] = (types[pt] || 0) + 1;
        });
        const labels = Object.keys(types);
        const data = Object.values(types);
        return {
          labels: labels.length ? labels : ["None"],
          datasets: [{
            data: data.length ? data : [1],
            backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"]
          }]
        };
      }
    }
  ],
  generateInsights: (items) => {
    const insights = [];
    const total = items.length;
    if (total === 0) return ["No consumer complaint records found."];

    const openCount = items.filter(c => (c.status || "Open").toLowerCase() === "open").length;
    const closedCount = items.filter(c => (c.status || "").toLowerCase() === "closed" || c.feedbackIssued).length;
    const resolutionRate = total > 0 ? Math.round((closedCount / total) * 100) : 0;

    insights.push(`Overall resolution rate: ${resolutionRate}% (${closedCount} of ${total} complaints resolved with feedback issued).`);
    insights.push(`${openCount} complaints currently awaiting field surveillance assignment.`);

    const productCounts = {};
    items.forEach(c => {
      const prod = (c.product || c.caseInfo || "").split(" ")[0].trim();
      if (prod && prod.length > 2) productCounts[prod] = (productCounts[prod] || 0) + 1;
    });
    const sortedProds = Object.entries(productCounts).sort((a, b) => b[1] - a[1]);
    if (sortedProds.length > 0 && sortedProds[0][1] > 1) {
      insights.push(`Frequent complaint subject: "${sortedProds[0][0]}" referenced in ${sortedProds[0][1]} separate complaints.`);
    }

    return insights;
  },
  logFields: [
    { name: "referenceCode", label: "Reference Code (e.g. 2026/CCF/022/LAG)", type: "text", required: true },
    { name: "dateReceived", label: "Date Received", type: "date", required: true },
    { name: "complainant", label: "Complainant Name & Contact Info", type: "text", required: true },
    { name: "product", label: "Product Name / Brand Involved", type: "text", required: true },
    { name: "productType", label: "Product Category", type: "select", options: ["Food", "Drugs", "Medical Devices", "Cosmetics", "Chemicals", "Herbals", "Other"], default: "Food" },
    { name: "caseInfo", label: "Case Description & Allegation", type: "textarea", required: true, rows: 3 },
    { name: "outletVisited", label: "Suspected Outlet / Point of Purchase", type: "text" },
    { name: "actionTaken", label: "Initial Administrative Action Taken", type: "textarea", rows: 2 },
    { name: "status", label: "Initial Status", type: "select", options: ["Open", "Under Investigation", "Closed"], default: "Open" }
  ]
};

// 3. GSDP (GOOD STORAGE & DISTRIBUTION PRACTICES) CONFIGURATION
function isCatA(item) {
  const r = ((item && item.riskCategory) || (item && item.findings) || "").toLowerCase();
  return r.includes("category a") || r.includes("low") || /\bcat\s*a\b/.test(r) || /\(a\)/.test(r);
}

function isCatB(item) {
  const r = ((item && item.riskCategory) || (item && item.findings) || "").toLowerCase();
  return !isCatA(item) && (r.includes("category b") || r.includes("medium") || /\bcat\s*b\b/.test(r) || /\(b\)/.test(r));
}

function isCatC(item) {
  const r = ((item && item.riskCategory) || (item && item.findings) || "").toLowerCase();
  return !isCatA(item) && !isCatB(item) && (r.includes("category c") || r.includes("high") || /\bcat\s*c\b/.test(r) || /\(c\)/.test(r) || r.includes("©"));
}

export const GSDP_CONFIG = {
  key: "gsdp",
  title: "Good Storage & Distribution Practice (GSDP)",
  subtitle: "Inspected facilities, Risk Categorization (A/B/C), and CAPA compliance tracking",
  collection: "gsdp_inspections",
  teamsRootFolder: "/GSDP (GOOD STORAGE AND DISTRIBUTION PRACTICE)/GSDP COMPANY FILES",
  defaultStatus: "Active",
  columns: [
    { key: "facilityName", label: "Name of Manufacturer / Facility", format: "bold" },
    { key: "address", label: "Location Address" },
    { key: "contact", label: "Contact Person / Phone" },
    { key: "inspectionType", label: "Type (GSDP/CEVI)", format: "badge" },
    { key: "inspectionDate", label: "Date of Inspection", format: "date" },
    { key: "riskCategory", label: "Risk Category (A/B/C)", format: "badge" },
    { key: "capaIssuedDate", label: "CAPA Issued Date", format: "date" },
    { key: "capaSubmitted", label: "CAPA Status", format: "badge" },
    { key: "conclusion", label: "Conclusion / Remarks" },
    { key: "companyFile", label: "Company File", format: "code" },
    { key: "teamsFolderUrl", label: "Teams Folder", format: "teams" }
  ],
  kpis: [
    { id: "totalInspected", label: "Inspected Facilities", color: "accent-green", calc: (items) => items.length },
    { id: "categoryA", label: "Low Risk (Cat A)", color: "accent-green", calc: (items) => items.filter(isCatA).length },
    { id: "categoryB", label: "Medium Risk (Cat B)", color: "accent-amber", calc: (items) => items.filter(isCatB).length },
    { id: "categoryC", label: "High Risk (Cat C)", color: "accent-red", calc: (items) => items.filter(isCatC).length }
  ],
  charts: [
    {
      id: "chartGsdpRisk",
      type: "doughnut",
      title: "Risk Categorization Distribution",
      generate: (items) => {
        const catA = items.filter(isCatA).length;
        const catB = items.filter(isCatB).length;
        const catC = items.filter(isCatC).length;
        const unassigned = items.length - (catA + catB + catC);
        return {
          labels: ["Category A (Low)", "Category B (Medium)", "Category C (High)", "Pending Classification"],
          datasets: [{
            data: [catA, catB, catC, Math.max(0, unassigned)],
            backgroundColor: ["#10b981", "#f59e0b", "#ef4444", "#9ca3af"]
          }]
        };
      }
    },
    {
      id: "chartGsdpCapa",
      type: "bar",
      title: "CAPA Compliance Progress",
      generate: (items) => {
        const submitted = items.filter(g => (g.capaSubmitted || "").toLowerCase().includes("yes") || (g.capaSubmitted || "").toLowerCase().includes("submitt") || (g.capaSubmitted || "").toLowerCase().includes("closed")).length;
        const pending = items.filter(g => (g.capaSubmitted || "").toLowerCase().includes("pend") || (g.capaSubmitted || "").toLowerCase().includes("await") || (g.capaSubmitted || "").toLowerCase().includes("no") || (g.capaSubmitted || "").toLowerCase().includes("overdue")).length;
        const notIssued = items.length - (submitted + pending);
        return {
          labels: ["CAPA Submitted/Closed", "CAPA Awaiting Submission", "No Directives Issued"],
          datasets: [{
            label: "Facilities Count",
            data: [submitted, pending, Math.max(0, notIssued)],
            backgroundColor: ["#10b981", "#f59e0b", "#6b7280"],
            borderRadius: 4
          }]
        };
      }
    }
  ],
  generateInsights: (items) => {
    const insights = [];
    const total = items.length;
    if (total === 0) return ["No GSDP inspection records found."];

    const catC = items.filter(isCatC).length;
    insights.push(`Audited ${total} distribution facilities; ${catC} facilities classified as High Risk (Category C) requiring priority follow-up.`);

    const capaPending = items.filter(g => (g.capaSubmitted || "").toLowerCase().includes("pend") || (g.capaSubmitted || "").toLowerCase().includes("no") || (g.capaSubmitted || "").toLowerCase().includes("overdue")).length;
    insights.push(`${capaPending} facilities have pending or overdue CAPA submissions.`);

    return insights;
  },
  logFields: [
    { name: "facilityName", label: "Manufacturer / Facility Name", type: "text", required: true },
    { name: "address", label: "Facility Address", type: "textarea", required: true, rows: 2 },
    { name: "contact", label: "Contact Person / Phone / Email", type: "text" },
    { name: "inspectionType", label: "Inspection Type", type: "select", options: ["GSDP", "CEVI"], default: "GSDP" },
    { name: "inspectionDate", label: "Date of Inspection", type: "date", required: true },
    { name: "riskCategory", label: "Risk Categorization", type: "select", options: ["Category A (Low)", "Category B (Medium)", "Category C (High)", "Under Evaluation"], default: "Under Evaluation" },
    { name: "capaIssuedDate", label: "Date CAPA / Directive Issued", type: "date" },
    { name: "capaSubmitted", label: "CAPA Submission Status", type: "select", options: ["Pending", "Submitted", "Closed", "Overdue", "N/A"], default: "Pending" },
    { name: "conclusion", label: "Inspection Conclusion", type: "text" },
    { name: "remarks", label: "Findings & Recommendations", type: "textarea", rows: 2 },
    { name: "expectedNextInspection", label: "Expected Next Inspection Date", type: "date" },
    { name: "companyFile", label: "Company File Reference", type: "text" }
  ]
};

// 4. ROUTINE SURVEILLANCE CONFIGURATION
export const SURVEILLANCE_CONFIG = {
  key: "surveillance",
  title: "Routine Surveillance",
  subtitle: "Physical market and outlet surveillance across all Lagos local government areas",
  collection: "facilityReports",
  activityFilter: "Routine Surveillance",
  teamsRootFolder: "/ROUTINE SURVEILLANCE",
  columns: [
    { key: "facilityName", label: "Facility Name", format: "bold" },
    { key: "facilityAddress", label: "Location Address" },
    { key: "area", label: "LGA Area" },
    { key: "inspectionDate", label: "Inspection Date", format: "date" },
    { key: "mainProductType", label: "Product Line" },
    { key: "actionTaken", label: "Observations & Actions" },
    { key: "mopUpCount", label: "Mop-up Qty", format: "number" },
    { key: "holdCount", label: "Hold Qty", format: "number" },
    { key: "sanctionGiven", label: "Sanction", format: "boolean" },
    { key: "linkedAlertId", label: "Linked Alert", format: "alert" },
    { key: "teamsFolderUrl", label: "Teams Folder", format: "teams" }
  ],
  kpis: [
    { id: "totalVisits", label: "Total Surveillance Visits", color: "accent-green", calc: (items) => items.length },
    { id: "uniqueFacilities", label: "Unique Facilities Audited", color: "accent-blue", calc: (items) => new Set(items.map(i => i.facilityName)).size },
    { id: "totalMopUps", label: "Total Products Mopped Up", color: "accent-amber", calc: (items) => items.reduce((acc, i) => acc + (Number(i.mopUpCount) || 0), 0) },
    { id: "totalSanctions", label: "Sanctions Recommended", color: "accent-red", calc: (items) => items.filter(i => i.sanctionGiven).length }
  ],
  charts: [
    {
      id: "chartSurveillanceLga",
      type: "bar",
      title: "Visits by Local Government Area (LGA)",
      generate: (items) => {
        const lgas = {};
        items.forEach(i => {
          const a = i.area || "Unspecified";
          lgas[a] = (lgas[a] || 0) + 1;
        });
        const sorted = Object.entries(lgas).sort((a, b) => b[1] - a[1]).slice(0, 8);
        return {
          labels: sorted.map(s => s[0]),
          datasets: [{
            label: "Visits",
            data: sorted.map(s => s[1]),
            backgroundColor: "#008751",
            borderRadius: 4
          }]
        };
      }
    },
    {
      id: "chartSurveillanceProducts",
      type: "doughnut",
      title: "Surveillance by Main Product Line",
      generate: (items) => {
        const prods = {};
        items.forEach(i => {
          const p = i.mainProductType || "Drugs";
          prods[p] = (prods[p] || 0) + 1;
        });
        return {
          labels: Object.keys(prods),
          datasets: [{
            data: Object.values(prods),
            backgroundColor: ["#008751", "#2563eb", "#d97706", "#dc2626", "#8b5cf6", "#059669"]
          }]
        };
      }
    }
  ],
  generateInsights: (items) => {
    const insights = [];
    const total = items.length;
    if (total === 0) return ["No routine surveillance reports found."];

    const mopped = items.reduce((acc, i) => acc + (Number(i.mopUpCount) || 0), 0);
    insights.push(`Completed ${total} routine surveillance visits across Lagos State; ${mopped} non-compliant units mopped up.`);

    const alertsLinked = items.filter(i => i.linkedAlertId || i.regulatoryAlertEncountered).length;
    if (alertsLinked > 0) {
      insights.push(`Regulatory alert products intercepted in ${alertsLinked} routine inspections.`);
    }

    return insights;
  },
  useWizardForLog: true // Redirects to Start New Log
};

// 5. GLSI (GLOBAL LABORATORY SAMPLE / RECEPTIVITY INSPECTIONS) CONFIGURATION
export const GLSI_CONFIG = {
  key: "glsi",
  title: "GLSI Monitoring",
  subtitle: "Good Laboratory Practice and Sample Inspection Records across Lagos State LGAs",
  collection: "glsi_records",
  teamsRootFolder: "/GLSI MONITORING",
  defaultStatus: "Active",
  columns: [
    { key: "facilityName", label: "Facility Name", format: "bold" },
    { key: "address", label: "Location Address" },
    { key: "area", label: "LGA / Zone" },
    { key: "dateOfVisit", label: "Date of Visit", format: "date" },
    { key: "observation", label: "Observation" },
    { key: "actionTaken", label: "Action Taken" },
    { key: "recommendation", label: "Recommendation" },
    { key: "status", label: "Status", format: "badge" },
    { key: "teamsFolderUrl", label: "Teams Folder", format: "teams" }
  ],
  kpis: [
    { id: "totalGlsi", label: "Total Facilities Monitored", color: "accent-green", calc: (items) => items.length },
    { id: "compliantGlsi", label: "Compliant / Monitored", color: "accent-blue", calc: (items) => items.filter(g => (g.status || "").toLowerCase().includes("compliant") || (g.status || "").toLowerCase().includes("monitored") || (g.status || "").toLowerCase() === "active").length },
    { id: "actionGlsi", label: "Action Taken / Lapses", color: "accent-amber", calc: (items) => items.filter(g => (g.status || "").toLowerCase().includes("non-compliant") || (g.status || "").toLowerCase().includes("action") || (g.status || "").toLowerCase().includes("default")).length },
    { id: "notLocatedGlsi", label: "Not Located Outlets", color: "accent-red", calc: (items) => items.filter(g => (g.status || "").toLowerCase().includes("not located")).length }
  ],
  charts: [
    {
      id: "chartGlsiStatus",
      type: "doughnut",
      title: "Facility Operational & Compliance Status",
      generate: (items) => {
        const action = items.filter(g => (g.status || "").toLowerCase().includes("non-compliant") || (g.status || "").toLowerCase().includes("action") || (g.status || "").toLowerCase().includes("default")).length;
        const compliant = items.filter(g => (g.status || "").toLowerCase().includes("compliant") || (g.status || "").toLowerCase().includes("monitored") || (g.status || "").toLowerCase() === "active").length;
        const notLocated = items.filter(g => (g.status || "").toLowerCase().includes("not located")).length;
        const other = items.length - (action + compliant + notLocated);
        return {
          labels: ["Action Taken / Lapses", "Compliant / Monitored", "Not Located", "Other"],
          datasets: [{
            data: [action, compliant, notLocated, Math.max(0, other)],
            backgroundColor: ["#f59e0b", "#10b981", "#ef4444", "#6b7280"]
          }]
        };
      }
    },
    {
      id: "chartGlsiLga",
      type: "bar",
      title: "GLSI Inspections by LGA / Zone",
      generate: (items) => {
        const lgas = {};
        items.forEach(g => {
          const a = g.area || g.zone || "Unspecified";
          lgas[a] = (lgas[a] || 0) + 1;
        });
        const top = Object.entries(lgas).sort((a, b) => b[1] - a[1]).slice(0, 7);
        return {
          labels: top.map(t => t[0]),
          datasets: [{
            label: "Facilities Inspected",
            data: top.map(t => t[1]),
            backgroundColor: "#008751",
            borderRadius: 4
          }]
        };
      }
    }
  ],
  generateInsights: (items) => {
    const insights = [];
    const total = items.length;
    if (total === 0) return ["No GLSI records found."];

    const actionCount = items.filter(g => (g.status || "").toLowerCase().includes("non-compliant") || (g.status || "").toLowerCase().includes("action") || (g.status || "").toLowerCase().includes("default")).length;
    if (actionCount > 0) {
      insights.push(`${actionCount} facilities required regulatory interventions, inventory mop-up, or consultative sanctions.`);
    }

    const notLocated = items.filter(g => (g.status || "").toLowerCase().includes("not located")).length;
    if (notLocated > 0) {
      insights.push(`Flagged ${notLocated} facilities as "Not Located" requiring surveillance verification.`);
    }

    insights.push(`Total active GLSI monitoring portfolio: ${total} facilities recorded across Lagos LGAs.`);
    return insights;
  },
  logFields: [
    { name: "facilityName", label: "Facility Name", type: "text", required: true },
    { name: "address", label: "Location Address", type: "textarea", required: true, rows: 2 },
    { name: "area", label: "Local Government Area (LGA)", type: "select", options: LAGOS_LGAS, default: "Ikeja" },
    { name: "dateOfVisit", label: "Date of Visit", type: "date", required: true },
    { name: "observation", label: "Observation & Findings", type: "textarea", rows: 2 },
    { name: "actionTaken", label: "Action Taken", type: "textarea", rows: 2 },
    { name: "recommendation", label: "Recommendation", type: "textarea", rows: 2 },
    { name: "status", label: "Facility Status", type: "select", options: ["Active", "Defaulter", "Not Located", "Suspended"], default: "Active" }
  ]
};
