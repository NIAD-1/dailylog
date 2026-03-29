/**
 * PMS Lagos — Facility Deduplication & Merge Script
 * ==================================================
 * Scans the entire `facilities` collection in Firestore, groups facilities
 * by normalized name, and merges duplicates into a single canonical record.
 * 
 * All inspection/sanction/complaint/document records from duplicates are
 * re-linked to the surviving master facility.
 * 
 * Run:  node merge-facilities.js [--dry-run]
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore, collection, getDocs, doc, setDoc, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ─── Firebase Config (same as db.js) ────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyDKtEkK9rY7NLFLRjqexRjeUL2jj7tC6tY",
    authDomain: "enilama-system-app.firebaseapp.com",
    projectId: "enilama-system-app",
    storageBucket: "enilama-system-app.firebasestorage.app",
    messagingSenderId: "180395774893",
    appId: "1:180395774893:web:7bd017f2b1478f22264724",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ─── Name Normalization (mirrors facility-utils.js) ─────────────────────────
function normalizeFacilityName(name) {
    if (!name) return "";
    let n = name.trim().toUpperCase();
    const noise = [
        ' LIMITED', ' LTD', ' PLC', ' NIG', ' NIGERIA',
        ' ENTERPRISES', ' ENTERPRISE', ' ENT', ' COMPANY', ' CO',
        ' INTERNATIONAL', ' INTL', ' INCORPORATED', ' INC',
        ' PHARMACY', ' PHARMACEUTICAL', ' PHARMACEUTICALS', ' PHARM',
        ' VENTURES', ' VENTURE', ' GLOBAL', ' SERVICES', ' SERVICE',
        ' STORES', ' STORE', ' SUPERMARKET', ' SUPERSTORES'
    ];
    const sortedNoise = [...noise].sort((a, b) => b.length - a.length);
    for (const suffix of sortedNoise) {
        if (n.endsWith(suffix)) {
            n = n.slice(0, -suffix.length).trim();
        }
    }
    return n.replace(/[^A-Z0-9]/g, "");
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
    const isDryRun = typeof process !== "undefined" && process.argv?.includes("--dry-run");
    
    console.log("═".repeat(60));
    console.log("PMS LAGOS — Facility Deduplication & Merge");
    console.log(isDryRun ? "  MODE: DRY RUN (no writes)" : "  MODE: LIVE (writing to Firestore)");
    console.log("═".repeat(60));

    // 1. Load all facilities
    console.log("\n📥 Loading all facilities from Firestore...");
    const snap = await getDocs(collection(db, "facilities"));
    const allFacilities = [];
    snap.forEach(d => {
        const data = d.data();
        data._docId = d.id;
        // Skip already-merged records
        if (data.status === "MERGED" || data.deleted === true) return;
        allFacilities.push(data);
    });
    console.log(`  Found ${allFacilities.length} active facilities.`);

    // 2. Group by normalized name
    console.log("\n🔍 Grouping by normalized name...");
    const groups = {};
    allFacilities.forEach(f => {
        if (!f.name) return;
        const norm = normalizeFacilityName(f.name);
        if (!norm) return;
        if (!groups[norm]) groups[norm] = [];
        groups[norm].push(f);
    });

    // 3. Find duplicate clusters (groups with > 1 member)
    const duplicateClusters = Object.entries(groups)
        .filter(([, members]) => members.length > 1)
        .map(([norm, members]) => {
            // Pick master: most activity types → most visits → has file number → has address
            const sorted = [...members].sort((a, b) => {
                const aAct = (a.activityTypes || []).length;
                const bAct = (b.activityTypes || []).length;
                if (bAct !== aAct) return bAct - aAct;

                const aVis = a.totalVisits || 0;
                const bVis = b.totalVisits || 0;
                if (bVis !== aVis) return bVis - aVis;

                if (b.fileNumber && !a.fileNumber) return 1;
                if (a.fileNumber && !b.fileNumber) return -1;

                if (b.address && !a.address) return 1;
                if (a.address && !b.address) return -1;

                return 0;
            });
            return {
                norm,
                master: sorted[0],
                others: sorted.slice(1)
            };
        });

    const totalDupes = duplicateClusters.reduce((s, g) => s + g.others.length, 0);
    console.log(`  Found ${duplicateClusters.length} duplicate clusters containing ${totalDupes} redundant records.`);

    if (duplicateClusters.length === 0) {
        console.log("\n✅ No duplicates found — database is clean!");
        return;
    }

    // 4. Print preview
    console.log("\n" + "─".repeat(60));
    console.log("MERGE PREVIEW:");
    console.log("─".repeat(60));
    for (const g of duplicateClusters) {
        const masterTypes = (g.master.activityTypes || []).join(", ") || "unknown";
        console.log(`\n  ★ MASTER: "${g.master.name}" [${masterTypes}] (${g.master.totalVisits || 0} visits)`);
        for (const o of g.others) {
            const oTypes = (o.activityTypes || []).join(", ") || "unknown";
            console.log(`    ← MERGE: "${o.name}" [${oTypes}] (${o.totalVisits || 0} visits)`);
        }
    }
    console.log("\n" + "─".repeat(60));

    if (isDryRun) {
        console.log("\n🚫 DRY RUN — no changes were made. Remove --dry-run to execute.");
        return;
    }

    // 5. Execute merges
    console.log("\n🔧 Executing merges...");
    const LINKED_COLLECTIONS = ["inspections", "sanctions", "complaints", "documents", "file_registry", "facilityReports"];
    let mergedCount = 0;
    let relinkedRecords = 0;

    for (const group of duplicateClusters) {
        const master = group.master;
        const others = group.others;

        // Aggregate data into master
        let allActivities = new Set(master.activityTypes || []);
        let allAliases = new Set(master.aliases || []);
        let masterAddr = master.address || "";
        let masterContact = master.contactPerson || "";
        let masterPhone = master.phone || "";
        let masterEmail = master.email || "";
        let masterFileNum = master.fileNumber || "";
        let masterZone = master.zone || "";
        let masterLga = master.lga || "";
        let totalVisits = master.totalVisits || 0;
        let totalFinesIssued = master.totalFinesIssued || 0;
        let totalFinesPaid = master.totalFinesPaid || 0;
        let outstandingFines = master.outstandingFines || 0;
        let lastVisitDate = master.lastVisitDate || "";

        for (const other of others) {
            (other.activityTypes || []).forEach(at => allActivities.add(at));
            (other.aliases || []).forEach(al => allAliases.add(al));
            if (other.name !== master.name) allAliases.add(other.name);
            if (!masterAddr && other.address) masterAddr = other.address;
            if (!masterContact && other.contactPerson) masterContact = other.contactPerson;
            if (!masterPhone && other.phone) masterPhone = other.phone;
            if (!masterEmail && other.email) masterEmail = other.email;
            if (!masterFileNum && other.fileNumber) masterFileNum = other.fileNumber;
            if (!masterZone && other.zone) masterZone = other.zone;
            if (!masterLga && other.lga) masterLga = other.lga;
            totalVisits += other.totalVisits || 0;
            totalFinesIssued += other.totalFinesIssued || 0;
            totalFinesPaid += other.totalFinesPaid || 0;
            outstandingFines += other.outstandingFines || 0;
            if (other.lastVisitDate && other.lastVisitDate > lastVisitDate) {
                lastVisitDate = other.lastVisitDate;
            }
        }

        // Update master record
        await setDoc(doc(db, "facilities", master._docId), {
            activityTypes: [...allActivities],
            aliases: [...allAliases],
            address: masterAddr,
            contactPerson: masterContact,
            phone: masterPhone,
            email: masterEmail,
            fileNumber: masterFileNum,
            zone: masterZone,
            lga: masterLga,
            totalVisits,
            totalFinesIssued,
            totalFinesPaid,
            outstandingFines,
            lastVisitDate,
            lastUpdated: new Date().toISOString()
        }, { merge: true });

        // Re-link all sub-collection records from duplicates → master
        for (const collName of LINKED_COLLECTIONS) {
            for (const other of others) {
                try {
                    const q = query(collection(db, collName), where("facilityId", "==", other.id));
                    const snap = await getDocs(q);
                    for (const d of snap.docs) {
                        await setDoc(doc(db, collName, d.id), {
                            facilityId: master.id,
                            facilityName: master.name,
                            _mergedFrom: other.id
                        }, { merge: true });
                        relinkedRecords++;
                    }
                } catch (e) {
                    // Collection might not exist, skip silently
                }
            }
        }

        // Mark duplicates as MERGED
        for (const other of others) {
            await setDoc(doc(db, "facilities", other._docId), {
                status: "MERGED",
                mergedTo: master.id,
                deleted: true,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
        }

        mergedCount++;
        console.log(`  ✅ [${mergedCount}/${duplicateClusters.length}] Merged "${master.name}" ← ${others.length} duplicates`);
    }

    console.log("\n" + "═".repeat(60));
    console.log("🚀 MERGE COMPLETE");
    console.log(`  📊 Clusters merged:     ${mergedCount}`);
    console.log(`  🗑️  Duplicates removed:  ${totalDupes}`);
    console.log(`  🔗 Records re-linked:   ${relinkedRecords}`);
    console.log("═".repeat(60));
}

main().catch(e => {
    console.error("Fatal error:", e);
});
