/**
 * NAFDAC PMS Directorate Hub — Production Firestore Importer
 * Populates Firestore with verified datasets:
 * 1. alerts (492 docs)
 * 2. gsdp_inspections (349 docs)
 * 3. glsi_records (271 docs)
 * 4. complaints (357 clean dockets with dual schema compatibility)
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const serviceAccountPath = path.join(__dirname, 'netlify/functions/serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error("❌ Service account key not found at:", serviceAccountPath);
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function batchUpload(collectionName, items, transformFn) {
  console.log(`\n─── Uploading to '${collectionName}' (${items.length} records) ───`);
  const BATCH_SIZE = 400;
  let count = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const item of chunk) {
      const data = transformFn ? transformFn(item) : item;
      const ref = db.collection(collectionName).doc();
      batch.set(ref, {
        ...data,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    await batch.commit();
    count += chunk.length;
    console.log(`  ✓ Written ${count} / ${items.length} docs to ${collectionName}...`);
  }
  console.log(`✅ Completed ${collectionName}: ${count} docs created.`);
}

async function main() {
  console.log("🚀 Starting Directorate Hub Production Firestore Import...\n");

  // 1. ALERTS
  const alertsPath = path.join(__dirname, 'etl_output/alerts.json');
  if (fs.existsSync(alertsPath)) {
    const alerts = JSON.parse(fs.readFileSync(alertsPath, 'utf8'));
    await batchUpload('alerts', alerts, (a) => ({
      alertNo: a.alertNo || '',
      dateReceived: a.dateReceived || '',
      source: a.source || '',
      title: a.title || '',
      actionTaken: a.actionTaken || '',
      facilitiesVisited: a.facilitiesVisited || '',
      findings: a.findings || '',
      status: a.status || 'Open',
      year: parseInt(a.year) || 2026,
      sourceFile: a.sourceFile || ''
    }));
  }

  // 2. GSDP INSPECTIONS
  const gsdpPath = path.join(__dirname, 'etl_output/gsdp_inspections.json');
  if (fs.existsSync(gsdpPath)) {
    const gsdp = JSON.parse(fs.readFileSync(gsdpPath, 'utf8'));
    await batchUpload('gsdp_inspections', gsdp, (g) => ({
      facilityName: g.facilityName || '',
      address: g.address || '',
      contact: g.contact || '',
      inspectionType: g.inspectionType || 'GSDP',
      inspectionDate: g.inspectionDate || '',
      riskCategory: g.riskCategory || 'Category B (Medium)',
      findings: g.findings || '',
      capaIssuedDate: g.capaIssuedDate || '',
      capaSubmitted: g.capaSubmitted || 'Pending',
      conclusion: g.conclusion || '',
      remarks: g.remarks || '',
      expectedNextInspection: g.expectedNextInspection || '',
      companyFile: g.companyFile || '',
      year: parseInt(g.year) || 2026,
      sourceFile: g.sourceFile || ''
    }));
  }

  // 3. GLSI RECORDS
  const glsiPath = path.join(__dirname, 'etl_output/glsi_records.json');
  if (fs.existsSync(glsiPath)) {
    const glsi = JSON.parse(fs.readFileSync(glsiPath, 'utf8'));
    await batchUpload('glsi_records', glsi, (gl) => ({
      facilityName: gl.facilityName || '',
      address: gl.address || '',
      area: gl.area || 'Ikeja',
      zone: gl.zone || 'Lagos Central',
      dateOfVisit: gl.dateOfVisit || '',
      observation: gl.observation || '',
      actionTaken: gl.actionTaken || '',
      recommendation: gl.recommendation || '',
      status: gl.status || 'Active',
      year: parseInt(gl.year) || 2025,
      sourceFile: gl.sourceFile || ''
    }));
  }

  // 4. CONSUMER COMPLAINTS (Dual Schema for Activity Hub & Facility Profiles)
  const complaintsPath = path.join(__dirname, 'etl_output/complaints.json');
  if (fs.existsSync(complaintsPath)) {
    const complaints = JSON.parse(fs.readFileSync(complaintsPath, 'utf8'));
    await batchUpload('complaints', complaints, (c) => ({
      referenceCode: c.referenceCode || '',
      complainant: c.complainant || '',
      complainantName: c.complainant || '',
      caseInfo: c.caseInfo || '',
      complaint: c.caseInfo || '',
      observation: c.caseInfo || '',
      product: c.product || '',
      productType: c.productType || 'Food',
      dateReceived: c.dateReceived || '',
      dateLogged: c.dateReceived || '',
      actionTaken: c.actionTaken || '',
      outcome: c.actionTaken || '',
      remarks: c.remarks || '',
      status: c.status || 'Open',
      feedbackIssued: Boolean(c.feedbackIssued),
      feedbackDate: c.feedbackDate || null,
      year: parseInt(c.year) || 2026,
      sourceFile: c.sourceFile || ''
    }));
  }

  console.log("\n🎉 ALL DIRECTORATE HUB DATASETS IMPORTED TO PRODUCTION FIRESTORE!");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Import error:", err);
  process.exit(1);
});
