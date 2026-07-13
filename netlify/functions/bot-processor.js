const { LAGOS_LGAs, INSPECTORS_LIST, ACTIVITY_TYPES, PRODUCT_TYPES, MAIN_PRODUCT_TYPES, STEPS, numberedList } = require('./bot-constants');

// Process a message against the current conversation state, return { newState, reply }
function processStep(state, message) {
  const msg = (message || '').trim();
  const step = state.step || STEPS.IDLE;

  // ── IDLE / START ───────────────────────────────────────────────────────────
  if (step === STEPS.IDLE) {
    return {
      newState: { ...state, step: STEPS.ASK_COUNT },
      reply: '📋 *Daily Activity Log*\n\nHow many facilities did you visit today? (1-8)'
    };
  }

  // ── FACILITY COUNT ─────────────────────────────────────────────────────────
  if (step === STEPS.ASK_COUNT) {
    const count = parseInt(msg);
    if (isNaN(count) || count < 1 || count > 8) return { newState: state, reply: 'Please enter a number between 1 and 8.' };
    return {
      newState: { ...state, step: STEPS.ASK_SAME_TEAM, facilityCount: count, facilities: Array(count).fill(null).map(() => ({})), currentIndex: 0 },
      reply: `Got it, ${count} facilit${count > 1 ? 'ies' : 'y'}.\n\nWas the same inspection team present at all facilities?\n1. Yes\n2. No`
    };
  }

  // ── SAME TEAM? ─────────────────────────────────────────────────────────────
  if (step === STEPS.ASK_SAME_TEAM) {
    const yes = ['1','yes','y','yeah','yep'].includes(msg.toLowerCase());
    const no = ['2','no','n','nah','nope'].includes(msg.toLowerCase());
    if (!yes && !no) return { newState: state, reply: 'Please reply 1 for Yes or 2 for No.' };
    if (yes) {
      return {
        newState: { ...state, step: STEPS.ASK_SHARED_INSPECTORS, sameTeam: true },
        reply: `Who was on the team? Reply with numbers separated by commas:\n\n${numberedList(INSPECTORS_LIST)}\n\nOr type names directly if not listed.`
      };
    }
    return {
      newState: { ...state, step: STEPS.ASK_DATE, sameTeam: false },
      reply: `Facility 1 of ${state.facilityCount}:\n\nWhat date was the inspection? (e.g. 2026-07-05 or today)`
    };
  }

  // ── SHARED INSPECTORS ──────────────────────────────────────────────────────
  if (step === STEPS.ASK_SHARED_INSPECTORS) {
    const names = parseInspectorInput(msg);
    if (names.length === 0) return { newState: state, reply: 'Please select at least one inspector.' };
    return {
      newState: { ...state, step: STEPS.ASK_DATE, sharedInspectors: names },
      reply: `Team: ${names.join(', ')}\n\nFacility 1 of ${state.facilityCount}:\n\nWhat date was the inspection? (e.g. 2026-07-05 or today)`
    };
  }

  // ── PER-FACILITY: INSPECTORS (only if sameTeam=false) ─────────────────────
  if (step === STEPS.ASK_INSPECTORS) {
    const names = parseInspectorInput(msg);
    if (names.length === 0) return { newState: state, reply: 'Please select at least one inspector.' };
    const fac = { ...getCurrentFacility(state), inspectorNames: names };
    const s = setCurrentFacility(state, fac);
    return {
      newState: { ...s, step: STEPS.ASK_DATE },
      reply: `What date was the inspection? (e.g. 2026-07-05 or today)`
    };
  }

  // ── DATE ────────────────────────────────────────────────────────────────────
  if (step === STEPS.ASK_DATE) {
    const date = parseDate(msg);
    if (!date) return { newState: state, reply: 'Please enter a valid date (YYYY-MM-DD) or "today".' };
    const fac = { ...getCurrentFacility(state), inspectionDate: date };
    const s = setCurrentFacility(state, fac);
    return {
      newState: { ...s, step: STEPS.ASK_AREA },
      reply: `Which area (LGA)?\n\n${numberedList(LAGOS_LGAs)}\n\nReply with the number.`
    };
  }

  // ── AREA ────────────────────────────────────────────────────────────────────
  if (step === STEPS.ASK_AREA) {
    const idx = parseInt(msg) - 1;
    let area;
    if (idx >= 0 && idx < LAGOS_LGAs.length) { area = LAGOS_LGAs[idx]; }
    else { area = LAGOS_LGAs.find(a => a.toLowerCase() === msg.toLowerCase()); }
    if (!area) return { newState: state, reply: 'Please enter a valid LGA number or name.' };
    const fac = { ...getCurrentFacility(state), area };
    const s = setCurrentFacility(state, fac);
    return {
      newState: { ...s, step: STEPS.ASK_ACTIVITY },
      reply: `Activity type?\n\n${numberedList(ACTIVITY_TYPES)}\n\nReply with the number.`
    };
  }

  // ── ACTIVITY TYPE ──────────────────────────────────────────────────────────
  if (step === STEPS.ASK_ACTIVITY) {
    const idx = parseInt(msg) - 1;
    let activity;
    if (idx >= 0 && idx < ACTIVITY_TYPES.length) { activity = ACTIVITY_TYPES[idx]; }
    else { activity = ACTIVITY_TYPES.find(a => a.toLowerCase() === msg.toLowerCase()); }
    if (!activity) return { newState: state, reply: 'Please enter a valid activity number.' };
    const fac = { ...getCurrentFacility(state), activityType: activity };
    const s = setCurrentFacility(state, fac);

    // Branch based on activity
    if (activity === 'Consultative Meeting') {
      return { newState: { ...s, step: STEPS.ASK_CM_CATEGORY }, reply: 'What category is this consultative meeting for?\n\n1. Routine Surveillance\n2. GLSI\n3. Consumer Complaint\n4. GSDP\n5. Monitoring of Service/Orphan/Donated Drugs' };
    }
    return { newState: { ...s, step: STEPS.ASK_FACILITY_NAME }, reply: 'What is the facility name?' };
  }

  // ── CONSULTATIVE MEETING CATEGORY ──────────────────────────────────────────
  if (step === STEPS.ASK_CM_CATEGORY) {
    const cats = ['Routine Surveillance','GLSI','Consumer Complaint','GSDP','Monitoring'];
    const idx = parseInt(msg) - 1;
    const cat = (idx >= 0 && idx < cats.length) ? cats[idx] : null;
    if (!cat) return { newState: state, reply: 'Please enter a number 1-5.' };
    const fac = { ...getCurrentFacility(state), consultativeMeetingCategory: cat };
    const s = setCurrentFacility(state, fac);
    if (['Routine Surveillance','Consumer Complaint'].includes(cat)) {
      const types = cat === 'Routine Surveillance' ? ["Drugs","Food","Medical Devices","Cosmetics","Vaccines & Biologics","Herbals"] : ["Food","Drugs","Medical Devices","Herbals"];
      return { newState: { ...s, step: STEPS.ASK_CM_PRODUCT_TYPE }, reply: `Product type?\n\n${numberedList(types)}` };
    }
    return { newState: { ...s, step: STEPS.ASK_FACILITY_NAME }, reply: 'What is the facility name?' };
  }

  // ── CM PRODUCT TYPE ────────────────────────────────────────────────────────
  if (step === STEPS.ASK_CM_PRODUCT_TYPE) {
    const cat = getCurrentFacility(state).consultativeMeetingCategory;
    const types = cat === 'Routine Surveillance' ? ["Drugs","Food","Medical Devices","Cosmetics","Vaccines & Biologics","Herbals"] : ["Food","Drugs","Medical Devices","Herbals"];
    const idx = parseInt(msg) - 1;
    const pt = (idx >= 0 && idx < types.length) ? types[idx] : null;
    if (!pt) return { newState: state, reply: 'Please enter a valid number.' };
    const fac = { ...getCurrentFacility(state), consultativeProductType: pt };
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_FACILITY_NAME }, reply: 'What is the facility name?' };
  }

  // ── FACILITY NAME ──────────────────────────────────────────────────────────
  if (step === STEPS.ASK_FACILITY_NAME) {
    if (!msg) return { newState: state, reply: 'Please enter the facility name.' };
    const fac = { ...getCurrentFacility(state), facilityName: msg };
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_FACILITY_ADDRESS }, reply: 'What is the facility address?' };
  }

  // ── FACILITY ADDRESS ───────────────────────────────────────────────────────
  if (step === STEPS.ASK_FACILITY_ADDRESS) {
    const fac = { ...getCurrentFacility(state), facilityAddress: msg || '' };
    const s = setCurrentFacility(state, fac);
    return routeAfterAddress(s);
  }

  // ── MAIN PRODUCT TYPE (Routine Surveillance / Consumer Complaint) ──────────────
  if (step === STEPS.ASK_MAIN_PRODUCT_TYPE) {
    const selected = parseNumberedSelection(msg, MAIN_PRODUCT_TYPES);
    if (selected.length !== 1) return { newState: state, reply: `Please select exactly ONE main product type:\n\n${numberedList(MAIN_PRODUCT_TYPES)}` };
    const fac = { ...getCurrentFacility(state), mainProductType: selected[0] };
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_PRODUCT_TYPES }, reply: `Select sub-product types (comma-separated numbers):\n\n${numberedList(PRODUCT_TYPES)}` };
  }

  // ── SUB PRODUCT TYPES (Routine Surveillance / Consumer Complaint) ──────────────
  if (step === STEPS.ASK_PRODUCT_TYPES) {
    const selected = parseNumberedSelection(msg, PRODUCT_TYPES);
    if (selected.length === 0) return { newState: state, reply: `Select product types (comma-separated numbers):\n\n${numberedList(PRODUCT_TYPES)}` };
    const fac = { ...getCurrentFacility(state), productTypes: selected };
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_MOP_UP }, reply: 'Did you mop up?\n1. Yes\n2. No' };
  }

  // ── GSDP SUB-ACTIVITY ──────────────────────────────────────────────────────
  if (step === STEPS.ASK_GSDP_SUB) {
    const sub = ['1','gdp'].includes(msg.toLowerCase()) ? 'GDP' : ['2','cevi'].includes(msg.toLowerCase()) ? 'CEVI' : null;
    if (!sub) return { newState: state, reply: 'Please enter 1 for GDP or 2 for CEVI.' };
    const fac = { ...getCurrentFacility(state), gsdpSubActivity: sub };
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_COMPANY_EMAIL }, reply: 'Company email (M.D / Superintendent Pharmacist):' };
  }

  // ── COMPANY EMAIL ──────────────────────────────────────────────────────────
  if (step === STEPS.ASK_COMPANY_EMAIL) {
    const fac = { ...getCurrentFacility(state), companyEmail: msg };
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_ACTION_TAKEN }, reply: 'Action taken / remarks?' };
  }

  // ── SAMPLES ────────────────────────────────────────────────────────────────
  if (step === STEPS.ASK_SAMPLES) {
    const count = parseInt(msg) || 0;
    const fac = { ...getCurrentFacility(state), Samplescount: count };
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_ACTION_TAKEN }, reply: 'Action taken / remarks?' };
  }

  // ── MOP UP ─────────────────────────────────────────────────────────────────
  if (step === STEPS.ASK_MOP_UP) {
    const yes = ['1','yes','y'].includes(msg.toLowerCase());
    const no = ['2','no','n'].includes(msg.toLowerCase());
    if (!yes && !no) return { newState: state, reply: 'Please reply 1 for Yes or 2 for No.' };
    const fac = { ...getCurrentFacility(state), mopUp: yes };
    const s = setCurrentFacility(state, fac);
    if (yes) return { newState: { ...s, step: STEPS.ASK_MOP_UP_COUNTS }, reply: 'Enter mop-up counts as: Drugs, Cosmetics, Medical Devices, Food\n(e.g. 5, 0, 2, 0)' };
    return { newState: { ...s, step: STEPS.ASK_HOLD }, reply: 'Did you place any product on hold?\n1. Yes\n2. No' };
  }

  // ── MOP UP COUNTS ──────────────────────────────────────────────────────────
  if (step === STEPS.ASK_MOP_UP_COUNTS) {
    const nums = msg.split(',').map(n => parseInt(n.trim()) || 0);
    const fac = { ...getCurrentFacility(state), mopUpDrugs: nums[0]||0, mopUpCosmetics: nums[1]||0, mopUpMedicalDevices: nums[2]||0, mopUpFood: nums[3]||0 };
    fac.mopUpCount = fac.mopUpDrugs + fac.mopUpCosmetics + fac.mopUpMedicalDevices + fac.mopUpFood;
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_HOLD }, reply: 'Did you place any product on hold?\n1. Yes\n2. No' };
  }

  // ── HOLD ───────────────────────────────────────────────────────────────────
  if (step === STEPS.ASK_HOLD) {
    const yes = ['1','yes','y'].includes(msg.toLowerCase());
    const no = ['2','no','n'].includes(msg.toLowerCase());
    if (!yes && !no) return { newState: state, reply: 'Please reply 1 for Yes or 2 for No.' };
    const fac = { ...getCurrentFacility(state), hold: yes };
    const s = setCurrentFacility(state, fac);
    if (yes) return { newState: { ...s, step: STEPS.ASK_HOLD_COUNTS }, reply: 'Enter hold counts as: Drugs, Cosmetics, Medical Devices, Food\n(e.g. 3, 0, 1, 0)' };
    return { newState: { ...s, step: STEPS.ASK_ACTION_TAKEN }, reply: 'Action taken / remarks?' };
  }

  // ── HOLD COUNTS ────────────────────────────────────────────────────────────
  if (step === STEPS.ASK_HOLD_COUNTS) {
    const nums = msg.split(',').map(n => parseInt(n.trim()) || 0);
    const fac = { ...getCurrentFacility(state), holdDrugs: nums[0]||0, holdCosmetics: nums[1]||0, holdMedicalDevices: nums[2]||0, holdFood: nums[3]||0 };
    fac.holdCount = fac.holdDrugs + fac.holdCosmetics + fac.holdMedicalDevices + fac.holdFood;
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_ACTION_TAKEN }, reply: 'Action taken / remarks?' };
  }

  // ── SANCTION (Consultative Meeting) ────────────────────────────────────────
  if (step === STEPS.ASK_SANCTION) {
    const yes = ['1','yes','y'].includes(msg.toLowerCase());
    const fac = { ...getCurrentFacility(state), sanctionGiven: yes };
    const s = setCurrentFacility(state, fac);
    return { newState: { ...s, step: STEPS.ASK_ACTION_TAKEN }, reply: 'Action taken / remarks?' };
  }

  // ── ACTION TAKEN ───────────────────────────────────────────────────────────
  if (step === STEPS.ASK_ACTION_TAKEN) {
    const fac = { ...getCurrentFacility(state), actionTaken: msg || '' };
    const s = setCurrentFacility(state, fac);
    return advanceToNextFacilityOrConfirm(s);
  }

  // ── CONFIRM ────────────────────────────────────────────────────────────────
  if (step === STEPS.CONFIRM) {
    const yes = ['1','yes','y','submit','confirm'].includes(msg.toLowerCase());
    const no = ['2','no','n','cancel'].includes(msg.toLowerCase());
    if (!yes && !no) return { newState: state, reply: 'Reply 1 to Submit or 2 to Cancel.' };
    if (no) return { newState: { step: STEPS.IDLE }, reply: '❌ Submission cancelled. Type "log" to start again.' };
    return { newState: { ...state, step: STEPS.DONE }, reply: null }; // null = signal to submit
  }

  return { newState: state, reply: 'Something went wrong. Type "log" to start over.' };
}

// ─── Routing helpers ─────────────────────────────────────────────────────────

function routeAfterAddress(state) {
  const fac = getCurrentFacility(state);
  const act = fac.activityType;

  if (['Routine Surveillance','Consumer Complaint', 'Special Surveillance', 'Advert'].includes(act)) {
    return { newState: { ...state, step: STEPS.ASK_MAIN_PRODUCT_TYPE }, reply: `Select MAIN product type (reply with 1 number):\n\n${numberedList(MAIN_PRODUCT_TYPES)}` };
  }
  if (['GLSI','RASFF','COLD CHAIN Monitoring'].includes(act)) {
    return { newState: { ...state, step: STEPS.ASK_MOP_UP }, reply: 'Did you mop up?\n1. Yes\n2. No' };
  }
  if (act === 'Consultative Meeting') {
    return { newState: { ...state, step: STEPS.ASK_SANCTION }, reply: 'Was a sanction given?\n1. Yes\n2. No' };
  }
  if (act === 'GSDP') {
    return { newState: { ...state, step: STEPS.ASK_GSDP_SUB }, reply: 'GSDP sub-activity?\n1. GDP\n2. CEVI' };
  }
  if (act === 'Laboratory Analysis') {
    return { newState: { ...state, step: STEPS.ASK_SAMPLES }, reply: 'How many samples were taken?' };
  }
  return { newState: { ...state, step: STEPS.ASK_ACTION_TAKEN }, reply: 'Action taken / remarks?' };
}

function advanceToNextFacilityOrConfirm(state) {
  const next = state.currentIndex + 1;
  if (next < state.facilityCount) {
    const s = { ...state, currentIndex: next };
    // If different inspectors per facility, ask inspectors first
    if (!state.sameTeam) {
      return {
        newState: { ...s, step: STEPS.ASK_INSPECTORS },
        reply: `✅ Facility ${state.currentIndex + 1} saved.\n\nFacility ${next + 1} of ${state.facilityCount}:\n\nWho inspected this facility?\n\n${numberedList(INSPECTORS_LIST)}\n\nReply with numbers (comma-separated) or type names.`
      };
    }
    return {
      newState: { ...s, step: STEPS.ASK_DATE },
      reply: `✅ Facility ${state.currentIndex + 1} saved.\n\nFacility ${next + 1} of ${state.facilityCount}:\n\nWhat date was the inspection?`
    };
  }

  // All facilities done — build summary
  let summary = '📝 *Summary:*\n\n';
  const inspectors = state.sameTeam ? state.sharedInspectors : null;
  if (inspectors) summary += `Team: ${inspectors.join(', ')}\n\n`;

  state.facilities.forEach((f, i) => {
    summary += `*Facility ${i + 1}:* ${f.facilityName || '?'}\n`;
    summary += `  📅 ${f.inspectionDate} | 📍 ${f.area} | 🏷️ ${f.activityType}\n`;
    if (!state.sameTeam && f.inspectorNames) summary += `  👥 ${f.inspectorNames.join(', ')}\n`;
    summary += '\n';
  });

  summary += '1. ✅ Submit\n2. ❌ Cancel';

  return { newState: { ...state, step: STEPS.CONFIRM }, reply: summary };
}

// ─── Utility functions ───────────────────────────────────────────────────────

function getCurrentFacility(state) {
  return (state.facilities && state.facilities[state.currentIndex]) || {};
}

function setCurrentFacility(state, fac) {
  const facilities = [...(state.facilities || [])];
  facilities[state.currentIndex] = fac;
  return { ...state, facilities };
}

function parseInspectorInput(msg) {
  const parts = msg.split(',').map(p => p.trim()).filter(Boolean);
  const names = [];
  for (const part of parts) {
    const idx = parseInt(part) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < INSPECTORS_LIST.length) {
      names.push(INSPECTORS_LIST[idx]);
    } else if (part.length > 2) {
      names.push(part);
    }
  }
  return [...new Set(names)];
}

function parseNumberedSelection(msg, list) {
  const parts = msg.split(',').map(p => p.trim()).filter(Boolean);
  const result = [];
  for (const part of parts) {
    const idx = parseInt(part) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < list.length) result.push(list[idx]);
  }
  return [...new Set(result)];
}

function parseDate(msg) {
  const lower = msg.toLowerCase();
  if (lower === 'today') return new Date().toISOString().split('T')[0];
  if (lower === 'yesterday') { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0]; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(msg)) return msg;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(msg)) {
    const [d,m,y] = msg.split('/');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
}

module.exports = { processStep, STEPS };
