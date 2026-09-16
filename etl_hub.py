#!/usr/bin/env python3
"""
NAFDAC PMS Directorate Hub — Comprehensive Activity ETL Pipeline
Extracts, cleans, normalizes, and validates Directorate Activity records from official Excel workbooks.
Processes:
1. ALERTS (Regulatory Alerts)
2. CONSUMER COMPLAINTS (Case Dockets)
3. GSDP INSPECTIONS (Good Storage & Distribution Practice & CEVI Inspections)
4. GLSI RECORDS (Global Listing of Supermarket Items Surveillance)
"""

import os
import sys
import re
import json
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

EXCEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "EXCEL FOLDERS")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "etl_output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

MONTHS_MAP = {
    'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'feruary': 2,
    'mar': 3, 'march': 3, 'apr': 4, 'april': 4,
    'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
    'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9,
    'oct': 10, 'october': 10, 'nov': 11, 'november': 11,
    'dec': 12, 'december': 12
}

MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]

def parse_excel_date(val, fallback_year=None):
    """
    Robust date parser that extracts valid YYYY-MM-DD ISO date strings.
    Never returns arbitrary text strings. Returns '' if not parseable.
    """
    if not val:
        return ""
    val_str = str(val).replace("\n", " ").strip()
    if not val_str or val_str.lower() in ["none", "n/a", "nil", "—", "-", "not stated", "absent", "unknown"]:
        return ""

    # 1. Excel serial number (e.g. 44642)
    if val_str.isdigit() and 30000 <= int(val_str) <= 65000:
        try:
            d = datetime(1899, 12, 30) + timedelta(days=int(val_str))
            return d.strftime("%Y-%m-%d")
        except:
            pass

    # 2. ISO date YYYY-MM-DD
    m_iso = re.match(r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})", val_str)
    if m_iso:
        yr, mo, dy = m_iso.groups()
        try:
            d = datetime(int(yr), int(mo), int(dy))
            return d.strftime("%Y-%m-%d")
        except ValueError:
            pass

    # 3. Standard date string DD/MM/YYYY or DD/MM/YY (expands 2-digit years like 23/01/25 -> 2025-01-23)
    m_dmy = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", val_str)
    if m_dmy:
        dy, mo, yr = m_dmy.groups()
        if len(yr) == 2:
            yr = f"20{yr}"
        try:
            d = datetime(int(yr), int(mo), int(dy))
            return d.strftime("%Y-%m-%d")
        except ValueError:
            pass

    # 4. Text date e.g. "22nd March, 2022" or "16TH SEPTEMBER, 2019"
    m_text = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})", val_str, re.I)
    if m_text:
        dy, mon_str, yr = m_text.groups()
        mon = MONTHS_MAP.get(mon_str.lower()[:3]) or MONTHS_MAP.get(mon_str.lower())
        if mon:
            try:
                d = datetime(int(yr), mon, int(dy))
                return d.strftime("%Y-%m-%d")
            except ValueError:
                pass

    # 5. Day + Month without year (e.g. "17th January") with fallback_year
    if fallback_year:
        m_dm = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)", val_str, re.I)
        if m_dm:
            dy, mon_str = m_dm.groups()
            mon = MONTHS_MAP.get(mon_str.lower()[:3]) or MONTHS_MAP.get(mon_str.lower())
            if mon:
                try:
                    d = datetime(int(fallback_year), mon, int(dy))
                    return d.strftime("%Y-%m-%d")
                except ValueError:
                    pass

    # 6. Month YYYY e.g. "March 2022" or "January, 2021"
    m_my = re.search(r"([A-Za-z]+),?\s+(\d{4})", val_str, re.I)
    if m_my:
        mon_str, yr = m_my.groups()
        mon = MONTHS_MAP.get(mon_str.lower()[:3]) or MONTHS_MAP.get(mon_str.lower())
        if mon:
            return f"{yr}-{mon:02d}-01"

    # 7. Exact 4-digit year string
    if re.match(r"^(20\d{2})$", val_str):
        return f"{val_str}-01-01"

    return ""

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
    if re.search(r"\b(category\s*a|cat\s*a|low\s*risk)\b", cleaned) or "(a)" in cleaned:
        return "Category A (Low)"
    if re.search(r"\b(category\s*c|cat\s*c|high\s*risk)\b", cleaned) or "(c)" in cleaned or "©" in cleaned:
        return "Category C (High)"
    if re.search(r"\b(category\s*b|cat\s*b|medium\s*risk|med\s*risk)\b", cleaned) or "(b)" in cleaned:
        return "Category B (Medium)"
    return "Pending Classification"

def read_sheet(xlsx_path, sheet_name=None):
    if not os.path.exists(xlsx_path):
        return []
    try:
        with zipfile.ZipFile(xlsx_path, 'r') as z:
            # 1. Read shared strings
            shared_strings = []
            if 'xl/sharedStrings.xml' in z.namelist():
                tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
                for si in tree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                    t_el = si.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                    if t_el is not None and t_el.text:
                        shared_strings.append(t_el.text)
                    else:
                        full_t = "".join(si.itertext())
                        shared_strings.append(full_t)
            
            # 2. Get workbook sheet mappings
            wb_tree = ET.fromstring(z.read('xl/workbook.xml'))
            sheets_el = wb_tree.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheets')
            
            target_sheet_path = 'xl/worksheets/sheet1.xml'
            if sheet_name and sheets_el is not None:
                sheet_idx = 1
                for s in sheets_el.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet'):
                    if s.attrib.get('name', '').lower().strip() == sheet_name.lower().strip():
                        r_id = s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id', f'rId{sheet_idx}')
                        rels_tree = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
                        for rel in rels_tree.findall('{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'):
                            if rel.attrib.get('Id') == r_id:
                                target_sheet_path = 'xl/' + rel.attrib.get('Target').lstrip('/')
                        break
                    sheet_idx += 1
                    
            if target_sheet_path not in z.namelist():
                for name in z.namelist():
                    if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                        target_sheet_path = name
                        break

            # 3. Read sheet rows
            sheet_tree = ET.fromstring(z.read(target_sheet_path))
            sheet_data = sheet_tree.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData')
            if sheet_data is None:
                return []
                
            rows = []
            for row in sheet_data.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
                row_dict = {}
                for cell in row.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                    r_ref = cell.attrib.get('r', '')
                    col_letter = re.match(r'([A-Z]+)', r_ref).group(1) if re.match(r'([A-Z]+)', r_ref) else ''
                    cell_type = cell.attrib.get('t')
                    v_el = cell.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                    if v_el is not None and v_el.text is not None:
                        val = v_el.text
                        if cell_type == 's' and val.isdigit():
                            s_idx = int(val)
                            val = shared_strings[s_idx] if s_idx < len(shared_strings) else val
                        row_dict[col_letter] = val
                    else:
                        is_el = cell.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}is')
                        if is_el is not None:
                            val = "".join(is_el.itertext())
                            row_dict[col_letter] = val
                if any(row_dict.values()):
                    rows.append(row_dict)
            return rows
    except Exception as e:
        print(f"Error reading {xlsx_path} [{sheet_name}]: {e}")
        return []

def get_all_sheet_names(xlsx_path):
    if not os.path.exists(xlsx_path):
        return []
    try:
        with zipfile.ZipFile(xlsx_path, 'r') as z:
            wb_tree = ET.fromstring(z.read('xl/workbook.xml'))
            sheets_el = wb_tree.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheets')
            if sheets_el is not None:
                return [s.attrib.get('name') for s in sheets_el.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet')]
    except Exception as e:
        print(f"Error getting sheet names for {xlsx_path}: {e}")
    return []

# ─── 1. EXTRACT ALERTS ────────────────────────────────────────────────────────
def extract_alerts():
    path = os.path.join(EXCEL_DIR, "ALERTS (3).xlsx")
    sheets = get_all_sheet_names(path)
    alerts = []
    
    for sheet in sheets:
        year_match = re.search(r"(20\d{2})", sheet)
        default_year = int(year_match.group(1)) if year_match else 2024
        rows = read_sheet(path, sheet)
        if len(rows) < 2:
            continue
            
        header_idx = -1
        for idx, r in enumerate(rows[:6]):
            line = " ".join(r.values()).lower()
            if any(k in line for k in ["alert no", "date received", "title", "product name", "products", "month\\year"]):
                header_idx = idx
                break
                
        start_row = header_idx + 1 if header_idx >= 0 else 1
        
        for r in rows[start_row:]:
            vals = [v.strip() for v in r.values() if v.strip()]
            if len(vals) < 2:
                continue
            line = " ".join(vals).lower()
            
            # Skip non-data header/banner rows
            if any(k in line for k in ["records of surveillance", "appendix", "drug/ medical devices", "alerts for drugs"]):
                continue
            if vals[0].lower() in ["s/n", "month/ year", "month\\year", "sn"]:
                continue
                
            first_col = (r.get('A') or "").strip()
            second_col = (r.get('B') or "").strip()
            
            # Skip month divider banners
            if first_col.lower() in MONTH_NAMES and len(vals) <= 2:
                continue
            if second_col.lower() in ["month", "products", "alert no", "alert no."]:
                continue
                
            # Layout differentiation
            if default_year in [2025, 2026]:
                alert_no = r.get('B') or ""
                date_raw = r.get('C') or ""
                source = r.get('D') or ""
                title = r.get('E') or ""
                action = r.get('F') or r.get('I') or ""
                facilities = r.get('G') or r.get('L') or ""
                findings = r.get('H') or r.get('O') or ""
            elif default_year == 2024:
                alert_no = ""
                date_raw = first_col if first_col.lower() in MONTH_NAMES else ""
                title = r.get('B') or ""
                facilities = r.get('C') or ""
                findings = r.get('D') or ""
                action = r.get('E') or ""
                source = "Surveillance Alert"
            elif default_year in [2022, 2023]:
                alert_no = ""
                date_raw = r.get('B') or ""
                title = r.get('C') or ""
                source = r.get('E') or "International/National Recall"
                facilities = r.get('G') or ""
                findings = r.get('H') or ""
                action = r.get('G') or ""
            elif default_year == 2021:
                alert_no = ""
                date_raw = r.get('A') or ""
                source = r.get('B') or ""
                title = r.get('C') or ""
                facilities = r.get('F') or ""
                findings = r.get('H') or ""
                action = r.get('I') or ""
            else:
                alert_no = ""
                date_raw = first_col if first_col.lower() in MONTH_NAMES else ""
                title = r.get('B') or r.get('C') or ""
                source = "Surveillance Alert"
                facilities = r.get('C') or ""
                findings = r.get('D') or ""
                action = r.get('E') or ""
                
            if not title and not alert_no:
                continue
            if "alert no" in alert_no.lower() or "s/n" in str(alert_no).lower():
                continue
                
            clean_alert_no = alert_no.replace("\n", " ").strip()
            if not clean_alert_no or clean_alert_no.lower() in MONTH_NAMES or clean_alert_no.lower() in ["month", "products", "s/n"]:
                clean_alert_no = f"ALT/{default_year}/{len([a for a in alerts if a['year']==default_year])+1:03d}/PMS"
                
            clean_date = parse_excel_date(date_raw, fallback_year=default_year)
            
            combined_txt = f"{action} {findings}".lower()
            status = "Open"
            if any(k in combined_txt for k in ["closed", "concluded", "completed", "for destruction", "destroyed"]):
                status = "Closed"
            elif any(k in combined_txt for k in ["visited", "mopped", "investig", "sanction", "holding", "seized"]):
                status = "Under Investigation"
                
            alerts.append({
                "alertNo": clean_alert_no,
                "dateReceived": clean_date,
                "source": (source or "Regulatory Alert").strip(),
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
        for idx, r in enumerate(rows[:6]):
            line = " ".join(r.values()).lower()
            if any(k in line for k in ["product complaint", "reference code", "complaints no", "month/ year", "type /source", "root cause"]):
                header_idx = idx
                break
                
        start_row = header_idx + 1 if header_idx >= 0 else 1
        
        for r in rows[start_row:]:
            line = " ".join(r.values()).lower()
            if any(k in line for k in ["appendix", "consumer complaints", "s/no", "reference code", "complaints no."]):
                continue
            clean_vals = [v.strip() for v in r.values() if v.strip()]
            if len(clean_vals) < 2:
                continue
                
            # Layout 1: 2018
            if default_year == 2018:
                prod = (r.get("B") or "").strip()
                outlet = (r.get("C") or "").strip()
                obs = (r.get("D") or "").strip()
                ptype_raw = (r.get("E") or "").strip()
                outcome = (r.get("F") or "").strip()
                if not prod and not outlet:
                    continue
                case_info = f"{prod}" + (f" (Purchased at {outlet})" if outlet else "") + (f": {obs}" if obs else "")
                ref = f"2018/CCF/{len([c for c in complaints if c['year']==2018])+1:03d}/LAG"
                date_rec = "2018-01-01"
                status = "Closed" if any(k in outcome.lower() for k in ["admin", "refer", "conclude"]) else "Under Investigation"
                ptype = "Food"
                if "water" in ptype_raw.lower() or "water" in prod.lower(): ptype = "Food"
                elif any(k in f"{ptype_raw} {prod}".lower() for k in ["liquor", "gin", "drink"]): ptype = "Food"
                elif "drug" in prod.lower(): ptype = "Drugs"
                
                complaints.append({
                    "referenceCode": ref,
                    "complainant": "Consumer",
                    "caseInfo": case_info,
                    "product": prod[:80],
                    "productType": ptype,
                    "outletVisited": outlet,
                    "dateReceived": date_rec,
                    "actionTaken": outcome,
                    "remarks": obs,
                    "status": status,
                    "feedbackIssued": status == "Closed",
                    "feedbackDate": date_rec if status == "Closed" else None,
                    "year": 2018,
                    "sourceFile": "CONSUMER COMPLAINTS LOG 2026.xlsx"
                })
                
            # Layout 2: 2019, 2020, 2021
            elif default_year in [2019, 2020, 2021]:
                m_y = (r.get("A") or "").strip()
                day = (r.get("B") or "").strip()
                type_src = (r.get("C") or "").strip()
                prod = (r.get("D") or "").strip()
                mfg_or_batch = (r.get("E") or "").strip()
                batch_or_cmpl = (r.get("F") or "").strip()
                obs_or_cmpl = (r.get("G") or "").strip()
                action = (r.get("H") or "").strip()
                remarks = (r.get("I") or "").strip()
                feedback = (r.get("J") or "").strip() or (r.get("K") or "").strip()
                
                if not prod and not obs_or_cmpl:
                    continue
                if "product" in prod.lower() or "complaint" in prod.lower() or "month" in m_y.lower():
                    continue
                    
                date_rec = parse_excel_date(f"{day} {m_y}", fallback_year=default_year) or parse_excel_date(m_y, fallback_year=default_year) or f"{default_year}-01-01"
                ref = f"{default_year}/CCF/{len([c for c in complaints if c['year']==default_year])+1:03d}/LAG"
                
                combined_status = f"{remarks} {feedback} {action}".lower()
                is_closed = "concluded" in combined_status or "close" in combined_status or "feedback" in combined_status
                status = "Closed" if is_closed else "Under Investigation"
                
                ptype = "Food"
                if any(k in f"{type_src} {prod}".lower() for k in ["drug", "tablet", "syrup", "capsule", "pharma"]): ptype = "Drugs"
                elif any(k in f"{type_src} {prod}".lower() for k in ["cream", "lotion", "soap", "cosmetic"]): ptype = "Cosmetics"
                
                case_desc = f"{prod}" + (f" - {batch_or_cmpl}" if batch_or_cmpl else "") + (f": {obs_or_cmpl}" if obs_or_cmpl else "")
                
                complaints.append({
                    "referenceCode": ref,
                    "complainant": type_src or "Consumer",
                    "caseInfo": case_desc[:300],
                    "product": prod[:80],
                    "productType": ptype,
                    "outletVisited": mfg_or_batch if any(k in mfg_or_batch.lower() for k in ["store", "mart", "enterprise", "supermarket", "ltd"]) else "",
                    "dateReceived": date_rec,
                    "actionTaken": action,
                    "remarks": f"{remarks} {feedback}".strip(),
                    "status": status,
                    "feedbackIssued": "feedback" in combined_status or status == "Closed",
                    "feedbackDate": date_rec if status == "Closed" else None,
                    "year": default_year,
                    "sourceFile": "CONSUMER COMPLAINTS LOG 2026.xlsx"
                })
                
            # Layout 3: 2022, 2023, 2024
            elif default_year in [2022, 2023, 2024]:
                raw_ref = (r.get("B") or "").replace("\n", " ").replace("=", "-").strip()
                date_raw = (r.get("C") or "").strip()
                src = (r.get("D") or "").strip()
                mode = (r.get("E") or "").strip()
                case_info = (r.get("F") or "").strip()
                action = (r.get("G") or "").strip()
                status_raw = (r.get("H") or "").strip()
                date_close = (r.get("I") or "").strip()
                rem = (r.get("J") or "").strip()
                
                if not case_info and not raw_ref:
                    continue
                if "complaints no" in raw_ref.lower() or "s/no" in str(r.get("A", "")).lower():
                    continue
                    
                clean_ref = raw_ref
                if not clean_ref.startswith("20") or "/" not in clean_ref or len(clean_ref) < 12:
                    sn = r.get("A") or len([c for c in complaints if c['year']==default_year])+1
                    clean_ref = f"{default_year}/CCD/{int(sn) if str(sn).isdigit() else len([c for c in complaints if c['year']==default_year])+1:03d}/PMS-LAG"
                    if not date_raw and parse_excel_date(raw_ref, fallback_year=default_year):
                        date_raw = raw_ref
                        
                date_rec = parse_excel_date(date_raw, fallback_year=default_year) or f"{default_year}-01-01"
                status = "Closed" if "close" in status_raw.lower() or "conclude" in rem.lower() or date_close else "Open"
                if status != "Closed" and any(k in action.lower() for k in ["investig", "meeting", "sanction"]):
                    status = "Under Investigation"
                    
                ptype = "Food"
                if any(k in case_info.lower() for k in ["drug", "tablet", "syrup", "capsule", "pharma", "herbal", "bitters"]): ptype = "Drugs"
                elif any(k in case_info.lower() for k in ["cream", "lotion", "soap", "cosmetic", "balm"]): ptype = "Cosmetics"
                elif any(k in case_info.lower() for k in ["device", "syringe", "gloves", "kit"]): ptype = "Medical Devices"
                
                complaints.append({
                    "referenceCode": clean_ref,
                    "complainant": f"{src} ({mode})" if mode and src else (src or mode or "Consumer"),
                    "caseInfo": case_info,
                    "product": case_info.split("by")[0].split("at")[0].strip()[:80],
                    "productType": ptype,
                    "outletVisited": "",
                    "dateReceived": date_rec,
                    "actionTaken": action,
                    "remarks": rem,
                    "status": status,
                    "feedbackIssued": status == "Closed",
                    "feedbackDate": parse_excel_date(date_close, fallback_year=default_year) if status == "Closed" else None,
                    "year": default_year,
                    "sourceFile": "CONSUMER COMPLAINTS LOG 2026.xlsx"
                })
                
            # Layout 4: 2025, 2026
            elif default_year in [2025, 2026]:
                raw_ref = (r.get("B") or "").replace("\n", "").strip()
                comp = (r.get("C") or "").strip()
                case_info = (r.get("D") or "").strip()
                date_mode = (r.get("E") or "").strip()
                action = (r.get("F") or "").strip()
                status_raw = (r.get("G") or "").strip()
                rem = (r.get("H") or "").strip()
                
                if not case_info and not raw_ref:
                    continue
                if "reference" in raw_ref.lower():
                    continue
                    
                clean_ref = raw_ref
                if clean_ref.startswith("025/"):
                    clean_ref = "2" + clean_ref
                elif not clean_ref.startswith("20"):
                    clean_ref = f"{default_year}/CCD/{len([c for c in complaints if c['year']==default_year])+1:03d}/LAG"
                    
                date_rec = parse_excel_date(date_mode, fallback_year=default_year) or f"{default_year}-01-01"
                status = "Closed" if "close" in status_raw.lower() or "feedback has been issued" in rem.lower() else "Open"
                if status != "Closed" and any(k in action.lower() for k in ["investig", "meeting", "sanction", "visited"]):
                    status = "Under Investigation"
                    
                ptype = "Food"
                if any(k in case_info.lower() for k in ["drug", "tablet", "syrup", "capsule", "pharma", "herbal", "lozenges", "xalrelto", "novomix"]): ptype = "Drugs"
                elif any(k in case_info.lower() for k in ["cream", "lotion", "soap", "cosmetic", "pomade"]): ptype = "Cosmetics"
                elif any(k in case_info.lower() for k in ["device", "syringe", "gloves", "kit"]): ptype = "Medical Devices"
                
                complaints.append({
                    "referenceCode": clean_ref,
                    "complainant": comp or "Consumer",
                    "caseInfo": case_info,
                    "product": case_info.split("was")[0].split("by")[0].split("at")[0].strip()[:80],
                    "productType": ptype,
                    "outletVisited": "",
                    "dateReceived": date_rec,
                    "actionTaken": action,
                    "remarks": rem,
                    "status": status,
                    "feedbackIssued": "feedback has been issued" in rem.lower() or status == "Closed",
                    "feedbackDate": date_rec if status == "Closed" else None,
                    "year": default_year,
                    "sourceFile": "CONSUMER COMPLAINTS LOG 2026.xlsx"
                })
                
    out_file = os.path.join(OUTPUT_DIR, "complaints.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(complaints, f, indent=2, ensure_ascii=False)
    print(f"✓ Complaints extracted: {len(complaints)} records -> {out_file}")

# ─── 3. EXTRACT GSDP INSPECTED FACILITIES ────────────────────────────────────
def extract_gsdp():
    master_file = "GDP UPDATED INSPECTED FACILITIES current one DIrector.xlsx"
    path = os.path.join(EXCEL_DIR, master_file)
    
    if not os.path.exists(path):
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
    seen_fingerprints = set()
    
    for filename, sheet_name, yr in sheets_map:
        file_path = os.path.join(EXCEL_DIR, filename)
        if not os.path.exists(file_path):
            continue
            
        rows = read_sheet(file_path, sheet_name)
        if len(rows) < 2:
            continue
            
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
                
            addr = (r.get(col_addr) or "").strip()
            contact = (r.get(col_contact) or "").strip()
            itype = (r.get(col_type) or "GSDP").strip()
            idate = (r.get(col_date) or "").strip()
            raw_findings = (r.get(col_findings) or "").strip()
            capa_issued = (r.get(col_capa_issued) or "").strip()
            capa_sub = (r.get(col_capa_sub) or "").strip()
            conclusion = (r.get(col_conclusion) or "").strip()
            remarks = (r.get(col_remarks) or "").strip()
            next_date = (r.get(col_next) or "").strip()
            
            # SharePoint URL
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
            
            # Risk classification (2021 official rule: all 48 facilities are Medium Risk)
            if yr == 2021:
                risk = "Category B (Medium)"
            else:
                risk = classify_gsdp_risk(raw_findings, conclusion)
            
            # Clean inspection date (normalizes e.g. 23/01/25 -> 2025-01-23)
            clean_idate = parse_excel_date(idate, fallback_year=yr)
            
            # CAPA status
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
                
            # Deduplicate exact clones (same facility, same date, same type, same findings)
            fingerprint = f"{yr}_{fac_name.lower()}_{clean_idate}_{itype.lower()}_{risk}"
            if fingerprint in seen_fingerprints:
                continue
            seen_fingerprints.add(fingerprint)
            
            gsdp_list.append({
                "facilityName": fac_name.replace("\n", " ").strip(),
                "address": addr.replace("\n", " ").strip(),
                "contact": contact.replace("\n", " ").strip(),
                "inspectionType": (itype or "GSDP").strip(),
                "inspectionDate": clean_idate,
                "riskCategory": risk,
                "findings": raw_findings.replace("\n", " ").strip(),
                "capaIssuedDate": parse_excel_date(capa_issued, fallback_year=yr),
                "capaSubmitted": capa_status,
                "conclusion": conclusion.replace("\n", " ").strip(),
                "remarks": remarks.replace("\n", " ").strip(),
                "expectedNextInspection": parse_excel_date(next_date, fallback_year=yr),
                "companyFile": file_name or fac_name.replace("\n", " ").strip(),
                "teamsFolderUrl": sp_url,
                "year": yr,
                "sourceFile": filename
            })

    # Sort properly: Year DESC, then inspectionDate DESC
    gsdp_list.sort(key=lambda x: (x["year"], x["inspectionDate"] or ""), reverse=True)
            
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
        ("GLSI NOT LOCATED.xlsx", "Not Located")
    ]
    glsi_records = []
    seen_fingerprints = set()
    
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
            branch_counter = 1
            
            for r in rows[start_row:]:
                name = (r.get('B') or "").strip()
                addr = (r.get('C') or "").strip()
                date_val = (r.get('D') or "").strip()
                obs = (r.get('E') or "").strip()
                act = (r.get('F') or "").strip()
                rec = (r.get('G') or "").strip()
                
                # Merged branch handling
                if not name and addr and last_facility_name:
                    name = f"{last_facility_name} (Branch {branch_counter}: {addr[:25]}...)" if len(addr) > 25 else f"{last_facility_name} (Branch {branch_counter})"
                    branch_counter += 1
                elif name:
                    last_facility_name = name
                    branch_counter = 1
                    
                if not name or "name" in name.lower() or "s/n" in str(r.get('A', '')).lower():
                    continue
                if name.lower().startswith("table") or name.lower().startswith("total"):
                    continue
                    
                clean_date = parse_excel_date(date_val, fallback_year=2024)
                rec_year = extract_year_from_date(clean_date or date_val, fallback_year=2024)
                
                # Status classification
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
                    
                lga_zone = sheet.replace("_", " ").strip().title()
                if lga_zone.upper() in ["OUTLET NOT LOCATED", "SHEET1", "SHEET2", "SHEET3"]:
                    lga_zone = "Lagos State"
                    
                fp = f"{name.lower()}_{addr.lower()}_{clean_date}"
                if fp in seen_fingerprints:
                    continue
                seen_fingerprints.add(fp)
                
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
                
    # Sort GLSI by year DESC, dateOfVisit DESC
    glsi_records.sort(key=lambda x: (x["year"], x["dateOfVisit"] or ""), reverse=True)
                
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
