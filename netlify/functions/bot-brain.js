// ─── Teams Bot Brain — Netlify Function ──────────────────────────────────────
// Receives messages from Power Automate, manages conversation state in
// Firestore, and submits final reports when the wizard completes.
const { admin, db } = require('./firebase-admin-init');
const { processStep, STEPS } = require('./bot-processor');
const { getActivityCode, getFolderConfig } = require('./bot-constants');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Bot-Secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{"error":"Method Not Allowed"}' };

  // Simple secret check
  const secret = (event.headers['x-bot-secret'] || event.headers['X-Bot-Secret'] || '');
  if (secret !== (process.env.BOT_SECRET || '')) {
    return { statusCode: 401, headers: CORS, body: '{"error":"Unauthorized"}' };
  }

  try {
    const { senderId, senderName, message } = JSON.parse(event.body);
    if (!senderId) return { statusCode: 400, headers: CORS, body: '{"error":"senderId required"}' };

    const msg = (message || '').trim();

    // ── Load or create conversation state ──────────────────────────────────
    const stateRef = db.collection('botConversations').doc(senderId);
    const stateSnap = await stateRef.get();
    let state = stateSnap.exists ? stateSnap.data() : { step: STEPS.IDLE };

    // ── Reset commands ─────────────────────────────────────────────────────
    if (['cancel', 'reset', 'start over', 'restart'].includes(msg.toLowerCase())) {
      await stateRef.set({ step: STEPS.IDLE, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return respond(200, { reply: '🔄 Session reset. Type "log" to start a new activity log.' });
    }

    // ── Trigger start ──────────────────────────────────────────────────────
    if (state.step === STEPS.IDLE) {
      if (!['log','start','begin'].includes(msg.toLowerCase())) {
        return respond(200, { reply: null });
      }
      state = { step: STEPS.ASK_COUNT, senderName: senderName || senderId };
    }

    // ── Process the current step ───────────────────────────────────────────
    const { newState, reply } = processStep(state, msg);

    // ── If DONE, submit all reports ────────────────────────────────────────
    if (newState.step === STEPS.DONE) {
      const result = await submitReports(newState, senderId, senderName);
      await stateRef.set({ step: STEPS.IDLE, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return respond(200, { reply: result });
    }

    // ── Save state and reply ───────────────────────────────────────────────
    await stateRef.set({ ...newState, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return respond(200, { reply });

  } catch (err) {
    console.error('Bot brain error:', err);
    return respond(500, { error: err.message, reply: '⚠️ Something went wrong. Type "reset" to start over.' });
  }
};

// ─── Submit all facility reports to Firestore ────────────────────────────────
async function submitReports(state, senderId, senderName) {
  const submissionId = 'bot_' + Date.now();
  const inspectors = state.sameTeam ? state.sharedInspectors : null;
  let successCount = 0;

  // Load webhook URL from settings
  let webhookUrl = '';
  let cmWebhookUrl = '';
  try {
    const settingsSnap = await db.collection('settings').doc('kpiTargets').get();
    if (settingsSnap.exists) {
      webhookUrl = settingsSnap.data().webhookUrl || '';
      cmWebhookUrl = settingsSnap.data().consultativeMeetingWebhookUrl || webhookUrl;
    }
  } catch (e) { console.error('Failed to load settings:', e); }

  for (const fac of state.facilities) {
    const finalInspectors = inspectors || fac.inspectorNames || [];
    const dateObj = fac.inspectionDate ? new Date(fac.inspectionDate) : new Date();

    const reportData = {
      submissionId,
      inspectorNames: finalInspectors,
      mainProductType: fac.mainProductType || null,
      productTypes: fac.productTypes || [],
      inspectionDate: admin.firestore.Timestamp.fromDate(dateObj),
      area: fac.area || '',
      facilityName: fac.facilityName || '',
      facilityAddress: fac.facilityAddress || '',
      activityType: fac.activityType || '',
      actionTaken: fac.actionTaken || '',
      sanctionGiven: fac.sanctionGiven || false,
      sanctionDocUrl: '',
      mopUp: fac.mopUp || false,
      mopUpCount: fac.mopUpCount || 0,
      mopUpCounts: { drugs: fac.mopUpDrugs||0, cosmetics: fac.mopUpCosmetics||0, medicalDevices: fac.mopUpMedicalDevices||0, food: fac.mopUpFood||0 },
      hold: fac.hold || false,
      holdCount: fac.holdCount || 0,
      holdCounts: { drugs: fac.holdDrugs||0, cosmetics: fac.holdCosmetics||0, medicalDevices: fac.holdMedicalDevices||0, food: fac.holdFood||0 },
      gsdpSubActivity: fac.gsdpSubActivity || '',
      companyEmail: fac.companyEmail || '',
      Samples: (parseInt(fac.Samplescount)||0) > 0,
      Samplescount: parseInt(fac.Samplescount) || 0,
      consultativeMeetingCategory: fac.consultativeMeetingCategory || '',
      consultativeProductType: fac.consultativeProductType || '',
      createdBy: `teams:${senderId}`,
      createdByName: senderName || '',
      source: 'teams-bot',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('facilityReports').add(reportData);
    successCount++;

    // Trigger Teams folder creation webhook
    const folderActivities = ['Routine Surveillance','Consumer Complaint','GSDP','GLSI','COLD CHAIN Monitoring'];
    if (folderActivities.includes(reportData.activityType) && webhookUrl) {
      try { await triggerWebhook(webhookUrl, reportData); } catch (e) { console.error('Webhook error:', e); }
    }
    if (reportData.activityType === 'Consultative Meeting' && cmWebhookUrl) {
      try { await triggerCMWebhook(cmWebhookUrl, reportData); } catch (e) { console.error('CM webhook error:', e); }
    }
  }

  // Log submission
  await db.collection('submissions').add({
    id: submissionId, createdBy: `teams:${senderId}`, createdByName: senderName || '',
    source: 'teams-bot', createdAt: admin.firestore.FieldValue.serverTimestamp(), count: successCount
  });

  return `🎉 *Success!* ${successCount} report${successCount > 1 ? 's' : ''} submitted.\nFolders are being created on Teams.\n\nType "log" to submit another.`;
}

// ─── Webhook triggers (mirrors wizard.js logic) ─────────────────────────────
async function triggerWebhook(url, report) {
  const dateObj = report.inspectionDate.toDate ? report.inspectionDate.toDate() : new Date(report.inspectionDate);
  const year = dateObj.getFullYear().toString();
  const month = dateObj.toLocaleString('default', { month: 'long' }).toUpperCase();
  const activityCode = getActivityCode(report.activityType);
  const reportId = `${activityCode}-${year}-${Date.now()}`;
  const deadline = new Date(); deadline.setDate(deadline.getDate() + 2); deadline.setHours(23,59,59,0);
  const folderConfig = getFolderConfig(report.activityType, report.productTypes, report.mainProductType);
  const sanitized = (report.facilityName||'').trim().replace(/["*:<>?/\\|]/g, '').replace(/\.+$/, '').trim();

  const payload = {
    reportId, lookupKey: `${sanitized}_${report.activityType}`, facilityName: sanitized,
    area: report.area, inspectionDate: dateObj.toISOString().split('T')[0],
    inspectors: (report.inspectorNames||[]).join(', '), activity: report.activityType,
    year, month, productType: folderConfig.productType, rootFolder: folderConfig.rootFolder,
    subfolders: folderConfig.subfolders, deadline: deadline.toISOString(),
    gsdpSubActivity: report.gsdpSubActivity || null, companyEmail: report.companyEmail || null
  };

  const https = require('https');
  return httpPost(url, payload);
}

async function triggerCMWebhook(url, report) {
  const dateObj = report.inspectionDate.toDate ? report.inspectionDate.toDate() : new Date(report.inspectionDate);
  const year = dateObj.getFullYear().toString();
  const month = dateObj.toLocaleString('default', { month: 'long' }).toUpperCase();
  const sanitized = (report.facilityName||'').trim().replace(/["*:<>?/\\|]/g, '').replace(/\.+$/, '').trim();
  const inspectors = report.inspectorNames || [];
  const folderConfig = getFolderConfig(report.consultativeMeetingCategory || 'Routine Surveillance', []);
  const reportId = `CM-${year}-${Date.now()}`;
  const deadline = new Date(dateObj); deadline.setDate(deadline.getDate()+3); deadline.setHours(23,59,59,0);

  const payload = {
    activity: 'Consultative Meeting', lookupKey: `${sanitized}_Consultative Meeting`,
    facilityName: sanitized, area: report.area||'', year, month, meetingDate: dateObj.toISOString().split('T')[0],
    meetingInspectors: inspectors.join(', '), meetingInspectorsArray: inspectors, meetingInspectorCount: inspectors.length,
    remarks: report.actionTaken||'', consultativeMeetingCategory: report.consultativeMeetingCategory||'',
    consultativeCategory: report.consultativeMeetingCategory||'', consultativeProductType: report.consultativeProductType||'',
    reportId, rootFolder: folderConfig.rootFolder, subfolders: ['Consultative_Meeting','Extra_Data'],
    inspectors: inspectors.join(', '), inspectionDate: dateObj.toISOString().split('T')[0], deadline: deadline.toISOString()
  };

  return httpPost(url, payload);
}

function httpPost(url, body) {
  const https = require('https');
  const data = JSON.stringify(body);
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let b=''; res.on('data', c => b+=c); res.on('end', () => resolve(b)); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function respond(code, body) {
  if (body && typeof body.reply === 'string') {
    body.reply = body.reply.replace(/\n/g, '<br/>');
  }
  return { statusCode: code, headers: CORS, body: JSON.stringify(body) };
}
