// ─── Constants mirrored from wizard.js ───────────────────────────────────────
const LAGOS_LGAs = ["Agege","Ajeromi-Ifelodun","Alimosho","Amuwo-Odofin","Apapa","Badagry","Epe","Eti-Osa","Ibeju-Lekki","Ifako-Ijaiye","Ikeja","Ikorodu","Kosofe","Lagos Island","Lagos Mainland","Mushin","Ojo","Oshodi-Isolo","Shomolu","Surulere"];
const INSPECTORS_LIST = ["Dr Regina K. Garba","Pharm. Mmamel Victor","Pharm. Adesanya Oluwaseun","Mr Omotuwa Adebayo","Mrs Bisola Robert","Mr Ifeanyi Okeke","Dr Saad Abubakar","Mr Enilama Emmanuel","Mr Solomon Emeje Ileanwa","Ms Mary Adegbite","Mr Adekunle Adeniran"];
const ACTIVITY_TYPES = ["Consultative Meeting","GLSI","Routine Surveillance","GSDP","Consumer Complaint","RASFF","Survey","Laboratory Analysis","COLD CHAIN Monitoring"];
const PRODUCT_TYPES = ["Drugs","Food","Medical Devices","Cosmetics","Vaccines & Biologics","Herbals","Service Drugs","Donated Items/Drugs","Orphan Drugs"];

// ─── Wizard step identifiers ─────────────────────────────────────────────────
const STEPS = {
  IDLE: 'idle',
  ASK_COUNT: 'ask_count',
  ASK_SAME_TEAM: 'ask_same_team',
  ASK_SHARED_INSPECTORS: 'ask_shared_inspectors',
  ASK_DATE: 'ask_date',
  ASK_AREA: 'ask_area',
  ASK_ACTIVITY: 'ask_activity',
  ASK_FACILITY_NAME: 'ask_facility_name',
  ASK_FACILITY_ADDRESS: 'ask_facility_address',
  ASK_PRODUCT_TYPES: 'ask_product_types',
  ASK_GSDP_SUB: 'ask_gsdp_sub',
  ASK_COMPANY_EMAIL: 'ask_company_email',
  ASK_SAMPLES: 'ask_samples',
  ASK_MOP_UP: 'ask_mop_up',
  ASK_MOP_UP_COUNTS: 'ask_mop_up_counts',
  ASK_HOLD: 'ask_hold',
  ASK_HOLD_COUNTS: 'ask_hold_counts',
  ASK_CM_CATEGORY: 'ask_cm_category',
  ASK_CM_PRODUCT_TYPE: 'ask_cm_product_type',
  ASK_SANCTION: 'ask_sanction',
  ASK_ACTION_TAKEN: 'ask_action_taken',
  ASK_INSPECTORS: 'ask_inspectors',
  CONFIRM: 'confirm',
  DONE: 'done'
};

// ─── Helper: numbered list formatter ─────────────────────────────────────────
function numberedList(arr) {
  return arr.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

function getActivityCode(activity) {
  const codes = { 'Routine Surveillance':'RS','Consumer Complaint':'CC','GSDP':'GSDP','GLSI':'GLSI','COLD CHAIN Monitoring':'CCM','Consultative Meeting':'CM','Laboratory Analysis':'LA','RASFF':'RASFF','Survey':'SRV' };
  return codes[activity] || 'OTH';
}

function getFolderConfig(activityType, productTypes) {
  const specialDrugs = ['Service Drugs','Donated Items/Drugs','Orphan Drugs'];
  const hasSpecial = (productTypes || []).some(pt => specialDrugs.includes(pt));
  switch (activityType) {
    case 'Routine Surveillance':
      if (hasSpecial) return { rootFolder: '/DONATED DRUGS, SERVICE DRUGS AND ORPHAN DRUGS', productType: (productTypes||[]).join(', '), subfolders: ['Surveillance_Report','Consultative_Meeting','Extra_Data'] };
      return { rootFolder: '/ROUTINE SURVEILLANCE/DRUGS', productType: 'Drugs', subfolders: ['Surveillance_Report','Consultative_Meeting','Extra_Data'] };
    case 'Consumer Complaint':
      return { rootFolder: '/CONSUMER COMPLAINT', productType: (productTypes||[]).join(', ')||null, subfolders: ['Inspection_Report','Consultative_Meeting','Investigation_Data'] };
    case 'GSDP':
      return { rootFolder: '/GSDP (GOOD STORAGE AND DISTRIBUTION PRACTICE)/GSDP COMPANY FILES', productType: null, subfolders: ['GSDP/Inspection_Report','GSDP/Compliance_Directives','GSDP/CAPA_Template','GSDP/Risk_Categorization','CEVI/Inspection_Report','CEVI/Compliance_Directives','CEVI/CAPA_Template','CEVI/Risk_Categorization','Company_Submissions'] };
    case 'GLSI':
      return { rootFolder: '/GLSI MONITORING', productType: null, subfolders: ['Inspection_Report','Consultative_Meeting','Inspection_Data'] };
    case 'COLD CHAIN Monitoring':
      return { rootFolder: '/COLD-CHAIN-MONITORING', productType: null, subfolders: ['Inspection_Report','Consultative_Meeting','Inspection_Field_Data'] };
    default:
      return { rootFolder: '/OTHER', productType: null, subfolders: [] };
  }
}

module.exports = { LAGOS_LGAs, INSPECTORS_LIST, ACTIVITY_TYPES, PRODUCT_TYPES, STEPS, numberedList, getActivityCode, getFolderConfig };
