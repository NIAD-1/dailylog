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

def parse_excel_date(val):
    if not val:
        return ""
    val_str = str(val).strip()
    # If Excel serial number (e.g. 46114)
    if val_str.isdigit() and len(val_str) == 5:
        try:
            days = int(val_str)
            d = datetime(1899, 12, 30) + timedelta(days=days)
            return d.strftime("%Y-%m-%d")
        except:
            pass
    # If standard date string DD/MM/YYYY or YYYY-MM-DD
    m = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", val_str)
    if m:
        day, month, year = m.groups()
        return f"{year}-{int(month):02d}-{int(day):02d}"
    return val_str

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
        
        # Determine column layout by inspecting header
        header_idx = -1
        for idx, r in enumerate(rows[:5]):
            line = " ".join(r.values()).lower()
            if "alert no" in line or "date received" in line or "title" in line:
                header_idx = idx
                break
        
        start_row = header_idx + 1 if header_idx >= 0 else 1
        
        for r in rows[start_row:]:
            # Find Alert No or S/N
            alert_no = r.get('B') or r.get('A') or ""
            date_raw = r.get('C') or r.get('B') or ""
            source = r.get('D') or r.get('C') or ""
            title = r.get('E') or r.get('D') or ""
            action = r.get('F') or r.get('E') or ""
            facilities = r.get('G') or r.get('F') or ""
            findings = r.get('H') or r.get('G') or ""
            status_val = r.get('I') or "Open"
            
            # Skip noise or empty rows
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
            
            # Legacy sheets (2018 format)
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
            
            # Detect feedback and closure
            combined_text = f"{status_val} {remarks} {action}".lower()
            is_feedback_issued = "feedback has been issued" in combined_text or "feedback issued" in combined_text
            
            status = "Open"
            if is_feedback_issued or "closed" in status_val.lower():
                status = "Closed"
            elif "investig" in combined_text or "visited" in combined_text or "sanction" in combined_text or "meeting" in combined_text:
                status = "Under Investigation"
                
            # Detect product category
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
    files = [
        ("GSDP INSPECTED FACILITIES 2021.xlsx", 2021),
        ("GSDP INSPECTED FACILITIES 2022.xlsx", 2022),
        ("INSPECTED FACILITIES 2023.xlsx", 2023),
        ("inspected facilities 2024.xlsx", 2024),
        ("GSDP INSPECTED FACILITIES 2025.xlsx", 2025),
        ("GSDP INSPECTED FACILITIES 2026.xlsx", 2026)
    ]
    gsdp_list = []
    
    for filename, yr in files:
        path = os.path.join(EXCEL_DIR, filename)
        sheets = get_all_sheet_names(path)
        main_sheet = next((s for s in sheets if "inspect" in s.lower() or "sheet" in s.lower()), sheets[0] if sheets else None)
        if not main_sheet:
            continue
            
        rows = read_sheet(path, main_sheet)
        if len(rows) < 2:
            continue
            
        header_idx = -1
        for idx, r in enumerate(rows[:5]):
            line = " ".join(r.values()).lower()
            if "manufacturer" in line or "facility" in line or "location" in line:
                header_idx = idx
                break
        start_row = header_idx + 1 if header_idx >= 0 else 1
        
        for r in rows[start_row:]:
            fac_name = r.get('B') or ""
            addr = r.get('C') or ""
            contact = r.get('D') or ""
            itype = r.get('E') or "GSDP"
            idate = r.get('F') or ""
            findings = r.get('G') or ""
            capa_issued = r.get('H') or ""
            capa_sub = r.get('I') or ""
            conclusion = r.get('J') or ""
            remarks = r.get('K') or ""
            next_date = r.get('L') or ""
            file_no = r.get('M') or ""
            
            if not fac_name or "name of" in fac_name.lower() or "s/n" in str(r.get('A', '')).lower():
                continue
                
            # Classify risk category A/B/C from findings
            risk = "Category B (Medium)"
            f_lower = (findings + " " + conclusion).lower()
            if "category a" in f_lower or "low risk" in f_lower:
                risk = "Category A (Low)"
            elif "category c" in f_lower or "high risk" in f_lower:
                risk = "Category C (High)"
            elif "category b" in f_lower or "medium risk" in f_lower:
                risk = "Category B (Medium)"
                
            gsdp_list.append({
                "facilityName": (fac_name or "").replace("\n", " ").strip(),
                "address": (addr or "").replace("\n", " ").strip(),
                "contact": (contact or "").replace("\n", " ").strip(),
                "inspectionType": (itype or "GSDP").strip(),
                "inspectionDate": parse_excel_date(idate),
                "riskCategory": risk,
                "findings": (findings or "").replace("\n", " ").strip(),
                "capaIssuedDate": parse_excel_date(capa_issued),
                "capaSubmitted": (capa_sub or "Pending").strip(),
                "conclusion": (conclusion or "").replace("\n", " ").strip(),
                "remarks": (remarks or "").replace("\n", " ").strip(),
                "expectedNextInspection": parse_excel_date(next_date),
                "companyFile": (file_no or "").strip(),
                "year": yr,
                "sourceFile": filename
            })
            
    out_file = os.path.join(OUTPUT_DIR, "gsdp_inspections.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(gsdp_list, f, indent=2, ensure_ascii=False)
    print(f"✓ GSDP extracted: {len(gsdp_list)} records -> {out_file}")

# ─── 4. EXTRACT GLSI MONITORING ──────────────────────────────────────────────
def extract_glsi():
    zone_files = [
        ("GLSI for Lagos Central.xlsx", "Lagos Central"),
        ("GLSI for Lagos East.xlsx", "Lagos East"),
        ("GLSI for Lagos West.xlsx", "Lagos West"),
        ("GLSI Defaulters.xlsx", "Defaulters"),
        ("GLSI NOT LOCATED.xlsx", "Not Located")
    ]
    glsi_records = []
    
    for filename, default_zone in zone_files:
        path = os.path.join(EXCEL_DIR, filename)
        sheets = get_all_sheet_names(path)
        
        for sheet in sheets:
            rows = read_sheet(path, sheet)
            if len(rows) < 2:
                continue
                
            header_idx = -1
            for idx, r in enumerate(rows[:5]):
                line = " ".join(r.values()).lower()
                if "name" in line or "location" in line or "observation" in line:
                    header_idx = idx
                    break
            start_row = header_idx + 1 if header_idx >= 0 else 1
            
            for r in rows[start_row:]:
                name = r.get('B') or ""
                addr = r.get('C') or ""
                date_val = r.get('D') or ""
                obs = r.get('E') or ""
                act = r.get('F') or ""
                rec = r.get('G') or ""
                
                if not name or "name" in name.lower() or "s/n" in str(r.get('A', '')).lower():
                    continue
                    
                status = "Active"
                if "defaulter" in filename.lower():
                    status = "Defaulter"
                elif "not located" in filename.lower() or "not located" in (obs or "").lower() or "not located" in (act or "").lower():
                    status = "Not Located"
                    
                # Use sheet name as LGA if valid
                lga_zone = sheet.strip().title()
                
                glsi_records.append({
                    "facilityName": (name or "").replace("\n", " ").strip(),
                    "address": (addr or "").replace("\n", " ").strip(),
                    "area": lga_zone,
                    "zone": default_zone,
                    "dateOfVisit": parse_excel_date(date_val),
                    "observation": (obs or "").replace("\n", " ").strip(),
                    "actionTaken": (act or "").replace("\n", " ").strip(),
                    "recommendation": (rec or "").replace("\n", " ").strip(),
                    "status": status,
                    "year": 2025,
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
