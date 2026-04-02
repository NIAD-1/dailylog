import { db, collection, getDocs, addDoc, query, where } from "./db.js";

/**
 * Normalizes a name for matching purposes.
 */
export function normalizeFacilityName(name) {
    if (!name) return "";
    let n = name.trim().toUpperCase();
    
    // Remove common suffixes
    const noise = [
        ' LIMITED', ' LTD', ' PLC', ' NIG', ' NIGERIA',
        ' ENTERPRISES', ' ENTERPRISE', ' ENT', ' COMPANY', ' CO',
        ' INTERNATIONAL', ' INTL', ' INCORPORATED', ' INC',
        ' PHARMACY', ' PHARMACARE', ' PHARMACEUTICAL', ' PHARMACEUTICALS', ' PHARM',
        ' CHEMIST', ' CHEMISTS', ' DRUGSTORE', ' DRUGSTORES',
        ' VENTURES', ' VENTURE', ' GLOBAL', ' SERVICES', ' SERVICE',
        ' STORES', ' STORE', ' SUPERMARKET', ' SUPERSTORES', ' SUPERSTORE',
        ' INDUSTRIES', ' INDUSTRY', ' TRADING', ' INVESTMENT', ' INVESTMENTS',
        ' HEALTHCARE', ' HEALTH CARE', ' HEALTH', ' MEDICAL', ' MEDICALS',
        ' DISTRIBUTOR', ' DISTRIBUTORS', ' DISTRIBUTION', ' LOGISTICS',
        ' AND SONS', ' & SONS', ' AND CO', ' & CO',
    ];
    
    // Sort by length descending to replace longer ones first
    const sortedNoise = [...noise].sort((a, b) => b.length - a.length);
    for (const suffix of sortedNoise) {
        if (n.endsWith(suffix)) {
            n = n.slice(0, -suffix.length).trim();
        }
    }
    
    // Remove non-alphanumeric for strict core matching
    return n.replace(/[^A-Z0-9]/g, "");
}

/**
 * Normalize an address for comparison.
 */
export function normalizeAddress(addr) {
    if (!addr) return "";
    return addr.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 30);
}

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i - 1] === a[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Fuzzy match: returns true if two normalized names are within
 * a small edit distance relative to their length.
 * e.g. "AFUNCHENNA" vs "AFUCHENNA" → distance 1 → match
 */
export function fuzzyMatch(normA, normB) {
    if (!normA || !normB) return false;
    if (normA === normB) return true;
    
    // If one starts with the other (prefix match)
    if (normA.startsWith(normB) || normB.startsWith(normA)) return true;
    
    const maxLen = Math.max(normA.length, normB.length);
    if (maxLen < 4) return normA === normB; // Too short for fuzzy
    
    const dist = levenshtein(normA, normB);
    // Allow 1 edit for names 4-8 chars, 2 edits for 9-15, 3 for 16+
    const threshold = maxLen <= 8 ? 1 : maxLen <= 15 ? 2 : 3;
    return dist <= threshold;
}

/**
 * Attempts to find an existing facility by name (fuzzy) or ID.
 * Returns the facility document or null.
 */
export async function findExistingFacility(name, address = "") {
    const norm = normalizeFacilityName(name);
    if (!norm) return null;

    // 1. Try exact name match
    const q1 = query(collection(db, "facilities"), where("name", "==", name.trim()));
    const s1 = await getDocs(q1);
    if (!s1.empty) return { ...s1.docs[0].data(), _docId: s1.docs[0].id };

    // 2. Try normalized name match (if we had a field for it, but we don't yet)
    // For now, we'll fetch a small batch or just rely on the smart picker's hidden IDs
    // But for the wizard/ETL, we might need a more robust check.
    
    // Fallback: If we can't find it exactly, but we have an address, try that?
    // (Skipping for now to keep it simple and safe)
    
    return null;
}

/**
 * Resolves a facility (finds or creates) and returns unified info.
 */
export async function resolveFacility(name, address, source = "system", activityType = null) {
    const existing = await findExistingFacility(name, address);
    
    if (existing) {
        // Update existing facility stats
        const updates = {
            totalVisits: (existing.totalVisits || 0) + 1,
            lastActivityDate: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Add activityType if provided and not already in the list
        if (activityType) {
            const currentActivities = existing.activityTypes || [];
            if (!currentActivities.includes(activityType)) {
                updates.activityTypes = [...currentActivities, activityType];
            }
        }

        await setDoc(doc(db, "facilities", existing._docId), updates, { merge: true });

        return { 
            facilityId: existing.id, 
            facilityName: existing.name, 
            docId: existing._docId, 
            isNew: false 
        };
    }

    // Create new
    const newFacility = {
        id: name.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_" + Date.now(),
        name: name.trim(),
        address: address || "",
        status: "Active",
        activityTypes: activityType ? [activityType] : [],
        totalVisits: 1,
        totalFinesIssued: 0,
        outstandingFines: 0,
        source: source,
        lastActivityDate: new Date().toISOString(),
        createdAt: new Date().toISOString()
    };

    const docRef = await addDoc(collection(db, "facilities"), newFacility);
    return { 
        facilityId: newFacility.id, 
        facilityName: newFacility.name, 
        docId: docRef.id, 
        isNew: true 
    };
}
