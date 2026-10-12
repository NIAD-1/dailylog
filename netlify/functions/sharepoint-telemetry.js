// ─── SharePoint Telemetry Webhook Receiver ───────────────────────────────────
// Receives incoming HTTP POST events from Power Automate when files are
// uploaded to facility folders in SharePoint Online.
//
// Power Automate Flow Setup:
//   Trigger:  "When a file is created in a folder" (SharePoint)
//   Action:   "HTTP" → POST to https://<domain>/.netlify/functions/sharepoint-telemetry
//   Body:     See payload schema below
//
// Payload Schema:
//   {
//     "secretToken": "optional-shared-secret",
//     "facilityName": "FACILITY NAME",
//     "lookupKey": "FACILITY NAME_GSDP",
//     "activityType": "GSDP",
//     "folderType": "Inspection_Report" | "CAPA_Template" | "Compliance_Directives" | "Risk_Categorization" | "Company_Submissions" | "Surveillance_Report" | "Investigation_Data",
//     "fileName": "Inspection_Report_Sept2026.pdf",
//     "fileUrl": "https://nafdacng.sharepoint.com/sites/PMSLAGOS/...",
//     "uploadedBy": "officer@nafdac.gov.ng",
//     "uploadedAt": "2026-09-29T12:00:00Z"
//   }
// ──────────────────────────────────────────────────────────────────────────────

const { db } = require('./firebase-admin-init');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// ─── Mapping: folderType → Firestore field updates ───────────────────────────
const FOLDER_TYPE_UPDATES = {
  'Inspection_Report': (payload) => ({
    hasInspectionReport: true,
    inspectionReportUrl: payload.fileUrl,
    inspectionReportFileName: payload.fileName,
    inspectionReportUploadedBy: payload.uploadedBy || '',
    inspectionReportDate: payload.uploadedAt || new Date().toISOString(),
    documentStatus: 'Report Uploaded'
  }),
  'Surveillance_Report': (payload) => ({
    hasSurveillanceReport: true,
    surveillanceReportUrl: payload.fileUrl,
    surveillanceReportFileName: payload.fileName,
    surveillanceReportUploadedBy: payload.uploadedBy || '',
    surveillanceReportDate: payload.uploadedAt || new Date().toISOString(),
    documentStatus: 'Report Uploaded'
  }),
  'CAPA_Template': (payload) => ({
    capaSubmitted: 'Submitted',
    capaStatus: 'CAPA Under Review',
    capaUrl: payload.fileUrl,
    capaFileName: payload.fileName,
    capaSubmittedBy: payload.uploadedBy || '',
    capaSubmittedDate: payload.uploadedAt || new Date().toISOString()
  }),
  'Compliance_Directives': (payload) => ({
    hasComplianceDirective: true,
    complianceDirectiveUrl: payload.fileUrl,
    complianceDirectiveFileName: payload.fileName,
    complianceDirectiveDate: payload.uploadedAt || new Date().toISOString()
  }),
  'Risk_Categorization': (payload) => ({
    hasRiskCategorization: true,
    riskCategorizationUrl: payload.fileUrl,
    riskCategorizationFileName: payload.fileName,
    riskCategorizationDate: payload.uploadedAt || new Date().toISOString()
  }),
  'Company_Submissions': (payload) => ({
    hasCompanySubmission: true,
    companySubmissionUrl: payload.fileUrl,
    companySubmissionFileName: payload.fileName,
    companySubmissionDate: payload.uploadedAt || new Date().toISOString()
  }),
  'Investigation_Data': (payload) => ({
    hasInvestigationData: true,
    investigationDataUrl: payload.fileUrl,
    investigationDataFileName: payload.fileName,
    investigationDataDate: payload.uploadedAt || new Date().toISOString()
  }),
  'Inspection Reports': (payload) => ({
    hasInspectionReport: true,
    inspectionReportUrl: payload.fileUrl,
    inspectionReportFileName: payload.fileName,
    inspectionReportUploadedBy: payload.uploadedBy || '',
    inspectionReportDate: payload.uploadedAt || new Date().toISOString(),
    documentStatus: 'Report Uploaded'
  }),
  'Inspection_Reports': (payload) => ({
    hasInspectionReport: true,
    inspectionReportUrl: payload.fileUrl,
    inspectionReportFileName: payload.fileName,
    inspectionReportUploadedBy: payload.uploadedBy || '',
    inspectionReportDate: payload.uploadedAt || new Date().toISOString(),
    documentStatus: 'Report Uploaded'
  }),
  'Advert Data and Evidence': (payload) => ({
    hasAdvertEvidence: true,
    advertEvidenceUrl: payload.fileUrl,
    advertEvidenceFileName: payload.fileName,
    advertEvidenceDate: payload.uploadedAt || new Date().toISOString(),
    documentStatus: 'Evidence Uploaded'
  }),
  'Advert_Data_and_Evidence': (payload) => ({
    hasAdvertEvidence: true,
    advertEvidenceUrl: payload.fileUrl,
    advertEvidenceFileName: payload.fileName,
    advertEvidenceDate: payload.uploadedAt || new Date().toISOString(),
    documentStatus: 'Evidence Uploaded'
  }),
  'Consultative Meetings': (payload) => ({
    hasConsultativeMeetingDoc: true,
    consultativeMeetingUrl: payload.fileUrl,
    consultativeMeetingFileName: payload.fileName,
    consultativeMeetingDate: payload.uploadedAt || new Date().toISOString()
  }),
  'Consultative_Meetings': (payload) => ({
    hasConsultativeMeetingDoc: true,
    consultativeMeetingUrl: payload.fileUrl,
    consultativeMeetingFileName: payload.fileName,
    consultativeMeetingDate: payload.uploadedAt || new Date().toISOString()
  })
};

// ─── Mapping: activityType → primary Firestore collection ────────────────────
const ACTIVITY_COLLECTIONS = {
  'GSDP': 'gsdp_inspections',
  'Routine Surveillance': 'facilityReports',
  'Special Surveillance': 'facilityReports',
  'Consumer Complaint': 'complaints',
  'GLSI': 'glsi_records',
  'Advert': 'facilityReports',
  'COLD CHAIN Monitoring': 'facilityReports'
};

// ─── Normalize facility name for matching ────────────────────────────────────
function normalizeName(name) {
  return String(name || '')
    .trim()
    .toUpperCase()
    .replace(/[."*:<>?/\\|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bLTD\.?\b/gi, 'LTD')
    .replace(/\bLIMITED\b/gi, 'LTD')
    .replace(/\bPHARMACY\b/gi, 'PHARM')
    .replace(/\bPHARMACIES\b/gi, 'PHARM')
    .replace(/\bNIGERIA\b/gi, 'NIG')
    .replace(/\bNIG\.?\b/gi, 'NIG')
    .replace(/\.+$/, '')
    .trim();
}

exports.handler = async function (event) {
  // ── CORS preflight ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');

    // ── Validate required fields ─────────────────────────────────────────────
    const { facilityName, activityType, folderType, fileUrl } = payload;

    if (!facilityName || !activityType || !folderType || !fileUrl) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Missing required fields',
          required: ['facilityName', 'activityType', 'folderType', 'fileUrl'],
          received: { facilityName: !!facilityName, activityType: !!activityType, folderType: !!folderType, fileUrl: !!fileUrl }
        })
      };
    }

    // ── Optional secret token verification ───────────────────────────────────
    const expectedToken = process.env.SHAREPOINT_TELEMETRY_SECRET;
    if (expectedToken && payload.secretToken !== expectedToken) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Invalid or missing secretToken' })
      };
    }

    // ── Determine Firestore field updates based on folderType ─────────────────
    const updateFn = FOLDER_TYPE_UPDATES[folderType];
    if (!updateFn) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: `Unknown folderType: "${folderType}"`,
          validTypes: Object.keys(FOLDER_TYPE_UPDATES)
        })
      };
    }

    const firestoreUpdates = updateFn(payload);
    firestoreUpdates._telemetryReceivedAt = new Date().toISOString();
    firestoreUpdates._telemetrySource = 'sharepoint-power-automate';

    // ── Determine collection to query ────────────────────────────────────────
    const collectionName = ACTIVITY_COLLECTIONS[activityType];
    if (!collectionName) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: `Unknown activityType: "${activityType}"`,
          validTypes: Object.keys(ACTIVITY_COLLECTIONS)
        })
      };
    }

    // ── Find matching record(s) in Firestore ─────────────────────────────────
    const normalizedTarget = normalizeName(facilityName);
    let updatedCount = 0;
    const updatedDocIds = [];

    // Strategy 1: Try lookupKey exact match first (most reliable)
    if (payload.lookupKey) {
      const lookupSnap = await db.collection(collectionName)
        .where('lookupKey', '==', payload.lookupKey)
        .limit(5)
        .get();

      for (const doc of lookupSnap.docs) {
        await doc.ref.update(firestoreUpdates);
        updatedDocIds.push(doc.id);
        updatedCount++;
      }
    }

    // Strategy 2: Facility name match (if lookupKey found nothing)
    if (updatedCount === 0) {
      const nameSnap = await db.collection(collectionName)
        .where('facilityName', '==', facilityName.trim())
        .limit(10)
        .get();

      for (const doc of nameSnap.docs) {
        await doc.ref.update(firestoreUpdates);
        updatedDocIds.push(doc.id);
        updatedCount++;
      }
    }

    // Strategy 3: Normalized fuzzy match (last resort)
    if (updatedCount === 0) {
      const allSnap = await db.collection(collectionName).limit(500).get();
      for (const doc of allSnap.docs) {
        const docName = normalizeName(doc.data().facilityName || doc.data().outletVisited || doc.data().name || '');
        if (docName === normalizedTarget) {
          await doc.ref.update(firestoreUpdates);
          updatedDocIds.push(doc.id);
          updatedCount++;
        }
      }
    }

    // ── Also update the master facilities collection ─────────────────────────
    let facilityUpdated = false;
    const facSnap = await db.collection('facilities')
      .where('name', '==', facilityName.trim())
      .limit(3)
      .get();

    if (!facSnap.empty) {
      const facilityDocUpdate = {
        [`documents.${folderType}`]: {
          url: fileUrl,
          fileName: payload.fileName || '',
          uploadedBy: payload.uploadedBy || '',
          uploadedAt: payload.uploadedAt || new Date().toISOString(),
          activityType: activityType
        },
        lastDocumentUpdate: new Date().toISOString()
      };

      for (const facDoc of facSnap.docs) {
        await facDoc.ref.update(facilityDocUpdate);
      }
      facilityUpdated = true;
    }

    // ── Log telemetry event for audit trail ───────────────────────────────────
    await db.collection('telemetry_events').add({
      type: 'sharepoint_file_upload',
      facilityName: facilityName,
      activityType: activityType,
      folderType: folderType,
      fileName: payload.fileName || '',
      fileUrl: fileUrl,
      uploadedBy: payload.uploadedBy || '',
      uploadedAt: payload.uploadedAt || new Date().toISOString(),
      matchedCollection: collectionName,
      matchedDocuments: updatedDocIds,
      matchedCount: updatedCount,
      facilityCollectionUpdated: facilityUpdated,
      receivedAt: new Date().toISOString()
    });

    // ── Response ─────────────────────────────────────────────────────────────
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        message: `Telemetry processed: ${updatedCount} record(s) updated in '${collectionName}'`,
        details: {
          facility: facilityName,
          activity: activityType,
          folderType: folderType,
          fileName: payload.fileName,
          documentsUpdated: updatedDocIds,
          facilityDossierUpdated: facilityUpdated
        }
      })
    };

  } catch (error) {
    console.error('[SharePoint Telemetry] Error:', error);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Internal server error processing telemetry event',
        message: error.message
      })
    };
  }
};
