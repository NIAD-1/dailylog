#!/usr/bin/env python3
"""
NAFDAC PMS Directorate Hub — Activity Datasets ETL
Extracts rich historical and active regulatory data from Excel spreadsheets:
1. Alerts (ALERTS (3).xlsx) -> etl_output/alerts.json
2. Consumer Complaints (CONSUMER COMPLAINTS LOG 2026.xlsx) -> etl_output/complaints.json
3. GSDP Inspected Facilities (2021-2026) -> etl_output/gsdp_inspections.json
4. GLSI Monitoring (Central, East, West, Defaulters, Not Located) -> etl_output/glsi_records.json
"""

import os
import re
import json
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXCEL_DIR = os.path.join(BASE_DIR, "EXCEL FOLDERS")
OUTPUT_DIR = os.path.join(BASE_DIR, "etl_output")
os.makedirs(OUTPUT_DIR, exist_ok=True)
MONTHS_MAP = {
    'jan': 1, 'january': 1,
    'feb': 2, 'february': 2, 'feruary': 2,
    'mar': 3, 'march': 3,
    'apr': 4, 'april': 4,
    'may': 5,
    'jun': 6, 'june': 6,
    'jul': 7, 'july': 7,
    'aug': 8, 'august': 8,
    'sep': 9, 'sept': 9, 'september': 9,
    'oct': 10, 'october': 10,
    'nov': 11, 'november': 11,
    'dec': 12, 'december': 12
}

def parse_excel_date(val):
    if not val:
        return ""
    val_str = str(val).strip()
    # 1. Excel serial number (e.g. 44642)
    if val_str.isdigit() and 30000 <= int(val_str) <= 65000:
        try:
            d = datetime(1899, 12, 30) + timedelta(days=int(val_str))
            return d.strftime("%Y-%m-%d")
        except:
            pass
    # 2. ISO date YYYY-MM-DD
    m_iso = re.match(r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$", val_str)
    if m_iso:
        yr, mo, dy = m_iso.groups()
        return f"{yr}-{int(mo):02d}-{int(dy):02d}"
    # 3. Standard date string DD/MM/YYYY
    m_dmy = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", val_str)
    if m_dmy:
        dy, mo, yr = m_dmy.groups()
        return f"{yr}-{int(mo):02d}-{int(dy):02d}"
    # 4. Text date e.g. "22nd March, 2022" or "16TH SEPTEMBER, 2019" or "2ND FERUARY 2024"
    m_text = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})", val_str, re.I)
    if m_text:
        dy, mon_str, yr = m_text.groups()
        mon = MONTHS_MAP.get(mon_str.lower()[:3]) or MONTHS_MAP.get(mon_str.lower())
        if mon:
            return f"{yr}-{mon:02d}-{int(dy):02d}"
    # 5. Month YYYY e.g. "March 2022"
    m_my = re.search(r"([A-Za-z]+),?\s+(\d{4})", val_str, re.I)
    if m_my:
        mon_str, yr = m_my.groups()
        mon = MONTHS_MAP.get(mon_str.lower()[:3]) or MONTHS_MAP.get(mon_str.lower())
        if mon:
            return f"{yr}-{mon:02d}-01"
    # 6. Year only
    m_y = re.search(r"\b(20\d{2})\b", val_str)
    if m_y:
        return f"{m_y.group(1)}-01-01"

    return val_str

def extract_year_from_date(date_str, fallback_year=2024):
    if not date_str:
        return fallback_year
    m = re.search(r"\b(20\d{2})\b", str(date_str))
    return int(m.group(1)) if m else fallback_year

def classify_gsdp_risk(raw_findings, conclusion=""):
    combined = (str(raw_findings or "") + " " + str(conclusion or "")).lower()
    cleaned = re.sub(r"\s+", " ", combined).strip()
    if not cleaned or cleaned in ["n/a", "none", "—"]:
        return "Pending Classification"
    if "low" in cleaned or "(a)" in cleaned or "category a" in cleaned or "cat a" in cleaned:
        return "Category A (Low)"
    if "high" in cleaned or "(c)" in cleaned or "©" in cleaned or "category c" in cleaned or "cat c" in cleaned:
        return "Category C (High)"
    if "med" in cleaned or "(b)" in cleaned or "category b" in cleaned or "cat b" in cleaned:
        return "Category B (Medium)"
    return "Pending Classification"

def read_sheet(xlsx_path, sheet_name=None):
    if not os.path.exists(xlsx_path):
        return []
    with zipfile.ZipFile(xlsx_path) as z:
        # 1. Load shared strings
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            ss_tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
            ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for si in ss_tree.findall('main:si', ns):
                texts = [t.text or '' for t in si.findall('.//main:t', ns)]
                shared_strings.append(''.join(texts))
        
        # 2. Map sheet relationships
        rels_tree = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        wb_tree = ET.fromstring(z.read('xl/workbook.xml'))
        ns_rels = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
        ns_wb = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
        rel_map = {elem.attrib['Id']: elem.attrib['Target'] for elem in rels_tree.findall('.//r:Relationship', ns_rels)}
        
        target_file = None
        for s in wb_tree.findall('.//main:sheet', ns_wb):
            if sheet_name is None or s.attrib['name'].strip().lower() == sheet_name.strip().lower():
                r_id = s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
                t = rel_map.get(r_id, '')
                target_file = t if t.startswith('xl/') else 'xl/' + t
                break
        
        if not target_file or target_file not in z.namelist():
            return []
        
        # 3. Parse rows
        ws_tree = ET.fromstring(z.read(target_file))
        ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        rows = []
        for r in ws_tree.findall('.//main:row', ns):
            row_dict = {}
            for c in r.findall('.//main:c', ns):
                ref = c.attrib.get('r', '')
                col = ''.join([ch for ch in ref if ch.isalpha()])
                t = c.attrib.get('t')
                v = c.find('main:v', ns)
                val = v.text if v is not None else ''
                if t == 's' and val.isdigit() and int(val) < len(shared_strings):
                    val = shared_strings[int(val)]
                row_dict[col] = (val or "").strip()
            if any(row_dict.values()):
                rows.append(row_dict)
        return rows

def get_all_sheet_names(xlsx_path):
    if not os.path.exists(xlsx_path):
        return []
    with zipfile.ZipFile(xlsx_path) as z:
        wb_tree = ET.fromstring(z.read('xl/workbook.xml'))
        ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        return [s.attrib['name'] for s in wb_tree.findall('.//main:sheet', ns)]

# ─── 1. EXTRACT ALERTS ────────────────────────────────────────────────────────
def extract_alerts():
    path = os.path.join(EXCEL_DIR, "ALERTS (3).xlsx")
    sheets = get_all_sheet_names(path)
    alerts = []
    
    for sheet in sheets:
        year_match = re.search(r"(20\d{2})", sheet)
        default_year = int(year_match.group(1)) if year_match else 2026
        rows = read_sheet(path, sheet)
        if len(rows) < 2:
            continue
        
        header_idx = -1
        for idx, r in enumerate(rows[:5]):
            line = " ".join(r.values()).lower()
            if "alert no" in line or "date received" in line or "title" in line:
                header_idx = idx
                break
        
        start_row = header_idx + 1 if header_idx >= 0 else 1
        
        for r in rows[start_row:]:
            alert_no = r.get('B') or r.get('A') or ""
            date_raw = r.get('C') or r.get('B') or ""
            source = r.get('D') or r.get('C') or ""
            title = r.get('E') or r.get('D') or ""
            action = r.get('F') or r.get('E') or ""
            facilities = r.get('G') or r.get('F') or ""
            findings = r.get('H') or r.get('G') or ""
            status_val = r.get('I') or "Open"
            
            if not title and not alert_no:
                continue
            if "alert no" in alert_no.lower() or "s/n" in str(alert_no).lower():
                continue
            
            date_cleaned = parse_excel_date(date_raw)
            status = "Open"
            if "close" in status_val.lower() or "conclude" in findings.lower():
                status = "Closed"
            elif "investig" in action.lower() or "mop" in action.lower():
                status = "Under Investigation"
            
            alerts.append({
                "alertNo": alert_no.replace("\n", " ").strip(),
                "dateReceived": date_cleaned,
                "source": source.strip(),
                "title": title.replace("\n", " ").strip(),
                "actionTaken": action.replace("\n", " ").strip(),
                "facilitiesVisited": facilities.replace("\n", " ").strip(),
                "findings": findings.replace("\n", " ").strip(),
                "status": status,
                "year": default_year,
                "sourceFile": "ALERTS (3).xlsx"
            })
            
    out_file = os.path.join(OUTPUT_DIR, "alerts.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(alerts, f, indent=2, ensure_ascii=False)
    print(f"✓ Alerts extracted: {len(alerts)} records -> {out_file}")

# ─── 2. EXTRACT CONSUMER COMPLAINTS ──────────────────────────────────────────
def extract_complaints():
    path = os.path.join(EXCEL_DIR, "CONSUMER COMPLAINTS LOG 2026.xlsx")
    sheets = get_all_sheet_names(path)
    complaints = []
    
    for sheet in sheets:
        year_match = re.search(r"(20\d{2})", sheet)
        default_year = int(year_match.group(1)) if year_match else 2026
        rows = read_sheet(path, sheet)
        if len(rows) < 2:
            continue
            
        header_idx = -1
        for idx, r in enumerate(rows[:5]):
            line = " ".join(r.values()).lower()
            if "reference" in line or "product" in line or "complainant" in line or "outlet" in line:
                header_idx = idx
                break
                
        start_row = header_idx + 1 if header_idx >= 0 else 1
        
        for r in rows[start_row:]:
            ref = r.get('B') or ""
            complainant = r.get('C') or ""
            case_info = r.get('D') or ""
            date_mode = r.get('E') or ""
            action = r.get('F') or ""
            status_val = r.get('G') or ""
            remarks = r.get('H') or ""
            
            if not case_info and r.get('B'):
                product = r.get('B')
                outlet = r.get('C')
                obs = r.get('D')
                ptype = r.get('E')
                outcome = r.get('F')
                case_info = f"{product} at {outlet}: {obs}"
                action = outcome
                complainant = "Consumer"
            
            if not case_info and not ref:
                continue
            if "reference code" in ref.lower():
                continue
                
            clean_date = parse_excel_date(date_mode)
            clean_ref = ref.replace("\n", "").strip()
            
            combined_text = f"{status_val} {remarks} {action}".lower()
            is_feedback_issued = "feedback has been issued" in combined_text or "feedback issued" in combined_text
            
            status = "Open"
            if is_feedback_issued or "closed" in status_val.lower():
                status = "Closed"
            elif "investig" in combined_text or "visited" in combined_text or "sanction" in combined_text or "meeting" in combined_text:
                status = "Under Investigation"
                
            ptype = "Food"
            if any(k in case_info.lower() for k in ["drug", "syrup", "tablet", "capsule", "injection", "pharma"]):
                ptype = "Drugs"
            elif any(k in case_info.lower() for k in ["cream", "lotion", "soap", "cosmetic", "pomade"]):
                ptype = "Cosmetics"
            elif any(k in case_info.lower() for k in ["device", "syringe", "gloves", "kit"]):
                ptype = "Medical Devices"
            elif any(k in case_info.lower() for k in ["water", "drink", "biscuit", "milk", "bread", "juice", "food"]):
                ptype = "Food"
                
            complaints.append({
                "referenceCode": clean_ref or f"{default_year}/CC/{len(complaints)+1:03d}/LAG",
                "complainant": (complainant or "").replace("\n", " ").strip(),
                "caseInfo": (case_info or "").replace("\n", " ").strip(),
                "product": (case_info or "").split("by")[0].replace("\n", " ").strip()[:80],
                "productType": ptype,
                "dateReceived": clean_date,
                "actionTaken": (action or "").replace("\n", " ").strip(),
                "remarks": (remarks or "").replace("\n", " ").strip(),
                "status": status,
                "feedbackIssued": is_feedback_issued,
                "feedbackDate": clean_date if is_feedback_issued else None,
                "year": default_year,
                "sourceFile": "CONSUMER COMPLAINTS LOG 2026.xlsx"
            })
            
    out_file = os.path.join(OUTPUT_DIR, "complaints.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(complaints, f, indent=2, ensure_ascii=False)
    print(f"✓ Complaints extracted: {len(complaints)} records -> {out_file}")

# ─── 3. EXTRACT GSDP INSPECTED FACILITIES ────────────────────────────────────
def extract_gsdp():
    """
    Extracts verified Good Storage & Distribution Practice (GSDP) inspection records.
    Primary dataset: 'GDP UPDATED INSPECTED FACILITIES current one DIrector.xlsx'
    Accurately extracts risk categorization (Category A Low / Category B Medium / Category C High),
    CAPA directives and submission status, dates, and direct SharePoint links.
    """
    master_file = "GDP UPDATED INSPECTED FACILITIES current one DIrector.xlsx"
    path = os.path.join(EXCEL_DIR, master_file)
    
    if not os.path.exists(path):
        print(f"Master file {master_file} not found, checking individual year files...")
        sheets_map = [
            ("GSDP INSPECTED FACILITIES 2021.xlsx", "INSPECTED FACILITIES 2021", 2021),
            ("GSDP INSPECTED FACILITIES 2022.xlsx", "INSPECTED FACILITIES 2022", 2022),
            ("INSPECTED FACILITIES 2023.xlsx", "INSPECTED FACILITIES 2023", 2023),
            ("inspected facilities 2024.xlsx", "INSPECTED FACILITIES 2024", 2024),
            ("GSDP INSPECTED FACILITIES 2025.xlsx", "INSPECTED FACILITIES 2025", 2025),
            ("GSDP INSPECTED FACILITIES 2026.xlsx", "INSPECTED FACILITIES 2026", 2026)
        ]
    else:
        sheets_map = [
            (master_file, "INSPECTED FACILITIES 2021", 2021),
            (master_file, "INSPECTED FACILITIES 2022", 2022),
            (master_file, "INSPECTED FACILITIES 2023", 2023),
            (master_file, "INSPECTED FACILITIES 2024", 2024),
            (master_file, "INSPECTED FACILITIES 2025", 2025),
            (master_file, "INSPECTED FACILITIES 2026", 2026)
        ]

    gsdp_list = []
    
    for filename, sheet_name, yr in sheets_map:
        file_path = os.path.join(EXCEL_DIR, filename)
        if not os.path.exists(file_path):
            continue
            
        rows = read_sheet(file_path, sheet_name)
        if len(rows) < 2:
            continue
            
        # Detect header row dynamically
        header_idx = -1
        col_map = {}
        for idx, r in enumerate(rows[:5]):
            line = " ".join(r.values()).lower()
            if "manufacturer" in line or "location" in line or "findings" in line:
                header_idx = idx
                for col_letter, header_val in r.items():
                    hv = header_val.lower().replace("\n", " ").strip()
                    if "manufacturer" in hv or ("name" in hv and "company" not in hv and "file" not in hv):
                        col_map["name"] = col_letter
                    elif "address" in hv or "location" in hv:
                        col_map["address"] = col_letter
                    elif "contact" in hv:
                        col_map["contact"] = col_letter
                    elif "type" in hv:
                        col_map["type"] = col_letter
                    elif "date of last inspection" in hv:
                        if "2" not in hv and "date" not in col_map:
                            col_map["date"] = col_letter
                    elif "findings" in hv:
                        col_map["findings"] = col_letter
                    elif "capa issued" in hv or "date capa" in hv:
                        col_map["capa_issued"] = col_letter
                    elif "capa sub" in hv:
                        col_map["capa_submitted"] = col_letter
                    elif "conclusion" in hv:
                        col_map["conclusion"] = col_letter
                    elif "remark" in hv:
                        col_map["remarks"] = col_letter
                    elif "expected" in hv:
                        col_map["expected_date"] = col_letter
                    elif "company file" in hv or "file" in hv:
                        col_map["file"] = col_letter
                break
                
        # Defaults if headers were slightly off
        col_name = col_map.get("name", "B")
        col_addr = col_map.get("address", "C")
        col_contact = col_map.get("contact", "D")
        col_type = col_map.get("type", "E")
        col_date = col_map.get("date", "F")
        col_findings = col_map.get("findings", "G")
        col_capa_issued = col_map.get("capa_issued", "H")
        col_capa_sub = col_map.get("capa_submitted", "I")
        col_conclusion = col_map.get("conclusion", "J")
        col_remarks = col_map.get("remarks", "K")
        col_next = col_map.get("expected_date", "L")
        
        start_row = header_idx + 1 if header_idx >= 0 else 2
        
        for r in rows[start_row:]:
            fac_name = (r.get(col_name) or "").strip()
            fn_low = fac_name.lower()
            if not fac_name or "name of" in fn_low or fn_low.startswith("total") or fn_low.startswith("grand") or "s/n" in str(r.get("A", "")).lower():
                continue
            if not re.search(r"[a-zA-Z]", fac_name):
                continue
                
            addr = r.get(col_addr) or ""
            contact = r.get(col_contact) or ""
            itype = r.get(col_type) or "GSDP"
            idate = r.get(col_date) or ""
            raw_findings = r.get(col_findings) or ""
            capa_issued = r.get(col_capa_issued) or ""
            capa_sub = r.get(col_capa_sub) or ""
            conclusion = r.get(col_conclusion) or ""
            remarks = r.get(col_remarks) or ""
            next_date = r.get(col_next) or ""
            
            # Find SharePoint URL from remaining columns M, N, O, P
            sp_url = ""
            file_name = ""
            for cl in ["M", "N", "O", "P", "Q"]:
                val = (r.get(cl) or "").strip()
                if not val:
                    continue
                if "http://" in val or "https://" in val or "sharepoint" in val.lower():
                    sp_url = val
                elif not file_name and len(val) > 2 and "column" not in val.lower() and val.upper() != "CC":
                    file_name = val
            
            # Classify risk accurately (2021 official rule: all 48 facilities are Medium Risk)
            if yr == 2021:
                risk = "Category B (Medium)"
            else:
                risk = classify_gsdp_risk(raw_findings, conclusion)
            
            # Clean inspection date
            clean_idate = parse_excel_date(idate)
            
            # Clean CAPA status
            capa_status = "Pending"
            cs_lower = str(capa_sub).lower()
            if "yes" in cs_lower or "submit" in cs_lower or "closed" in cs_lower:
                capa_status = "Submitted / Closed"
            elif "no" in cs_lower or "pend" in cs_lower or "yet" in cs_lower:
                capa_status = "Pending / Overdue"
            elif "n/a" in cs_lower:
                capa_status = "N/A"
            elif str(capa_sub).strip():
                capa_status = str(capa_sub).strip()
                
            gsdp_list.append({
                "facilityName": fac_name.replace("\n", " ").strip(),
                "address": addr.replace("\n", " ").strip(),
                "contact": contact.replace("\n", " ").strip(),
                "inspectionType": (itype or "GSDP").strip(),
                "inspectionDate": clean_idate,
                "riskCategory": risk,
                "findings": raw_findings.replace("\n", " ").strip(),
                "capaIssuedDate": parse_excel_date(capa_issued),
                "capaSubmitted": capa_status,
                "conclusion": conclusion.replace("\n", " ").strip(),
                "remarks": remarks.replace("\n", " ").strip(),
                "expectedNextInspection": parse_excel_date(next_date),
                "companyFile": file_name or fac_name.replace("\n", " ").strip(),
                "teamsFolderUrl": sp_url,
                "year": yr,
                "sourceFile": filename
            })
            
    out_file = os.path.join(OUTPUT_DIR, "gsdp_inspections.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(gsdp_list, f, indent=2, ensure_ascii=False)
    print(f"✓ GSDP extracted: {len(gsdp_list)} records -> {out_file}")

# ─── 4. EXTRACT GLSI MONITORING ──────────────────────────────────────────────
def extract_glsi():
    """
    Extracts authentic Global Listing of Supermarket Items (GLSI) records.
    Strictly excludes Administrative Sanction fines ('GLSI Defaulters.xlsx').
    Processes Central, East, West, and Not Located inspection files.
    """
    zone_files = [
        ("GLSI for Lagos Central.xlsx", "Lagos Central"),
        ("GLSI for Lagos East.xlsx", "Lagos East"),
        ("GLSI for Lagos West.xlsx", "Lagos West"),
        ("GLSI NOT LOCATED.xlsx", "Not Located")
    ]
    glsi_records = []
    
    for filename, default_zone in zone_files:
        path = os.path.join(EXCEL_DIR, filename)
        if not os.path.exists(path):
            continue
            
        sheets = get_all_sheet_names(path)
        for sheet in sheets:
            rows = read_sheet(path, sheet)
            if len(rows) < 2:
                continue
                
            header_idx = -1
            for idx, r in enumerate(rows[:5]):
                line = " ".join(r.values()).lower()
                if "name" in line and ("location" in line or "address" in line):
                    header_idx = idx
                    break
            start_row = header_idx + 1 if header_idx >= 0 else 1
            
            last_facility_name = ""
            for r in rows[start_row:]:
                name = (r.get('B') or "").strip()
                addr = (r.get('C') or "").strip()
                date_val = (r.get('D') or "").strip()
                obs = (r.get('E') or "").strip()
                act = (r.get('F') or "").strip()
                rec = (r.get('G') or "").strip()
                
                # If name is blank but address exists (merged branch in Excel)
                if not name and addr and last_facility_name:
                    name = f"{last_facility_name} (Branch)"
                elif name:
                    last_facility_name = name
                    
                if not name or "name" in name.lower() or "s/n" in str(r.get('A', '')).lower():
                    continue
                if name.lower().startswith("table") or name.lower().startswith("total"):
                    continue
                    
                clean_date = parse_excel_date(date_val)
                rec_year = extract_year_from_date(clean_date or date_val, fallback_year=2024)
                
                # Determine accurate status
                obs_lower = obs.lower()
                act_lower = act.lower()
                rec_lower = rec.lower()
                all_text = f"{obs_lower} {act_lower} {rec_lower}"
                
                if "not located" in filename.lower() or "not located" in sheet.lower() or "not located" in all_text:
                    status = "Not Located"
                elif any(k in all_text for k in ["unregistered", "mopped", "sanction", "defaulter", "non-compliance", "warning", "invitation", "lapses"]):
                    status = "Non-Compliant / Action Taken"
                elif any(k in all_text for k in ["complies", "continuous monitoring", "satisfactory", "none taken"]):
                    status = "Compliant"
                else:
                    status = "Monitored"
                    
                # Clean LGA Area from sheet name
                lga_zone = sheet.replace("_", " ").strip().title()
                if lga_zone.upper() in ["OUTLET NOT LOCATED", "SHEET1", "SHEET2", "SHEET3"]:
                    lga_zone = "Lagos State"
                    
                glsi_records.append({
                    "facilityName": name.replace("\n", " ").strip(),
                    "address": addr.replace("\n", " ").strip(),
                    "area": lga_zone,
                    "zone": default_zone,
                    "dateOfVisit": clean_date,
                    "observation": obs.replace("\n", " ").strip(),
                    "actionTaken": act.replace("\n", " ").strip(),
                    "recommendation": rec.replace("\n", " ").strip(),
                    "status": status,
                    "year": rec_year,
                    "sourceFile": filename
                })
                
    out_file = os.path.join(OUTPUT_DIR, "glsi_records.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(glsi_records, f, indent=2, ensure_ascii=False)
    print(f"✓ GLSI extracted: {len(glsi_records)} records -> {out_file}")

if __name__ == "__main__":
    print("─── Running NAFDAC Directorate Activity ETL ───")
    extract_alerts()
    extract_complaints()
    extract_gsdp()
    extract_glsi()
    print("─── ETL Pipeline Complete ───")

