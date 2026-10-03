#!/usr/bin/env python
"""Fetch Edinburgh hospitals from the NHS Scotland Hospital Codes dataset.

The Hospital Codes dataset is the authoritative list of NHS hospitals in Scotland.
We take the City of Edinburgh ones, geocode them via postcodes.io, and load them
into the DB under the "nhs" category (tags: nhs;hospital).

Usage:
    .venv/bin/python scripts/fetch_hospitals.py
"""
import csv
import io
import json
import os
import sys
import time
import urllib.request

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSPITALS_CSV = ("https://www.opendata.nhs.scot/dataset/cbd1802e-0e04-4282-88eb-d7bdcfb120f0/"
                 "resource/c698f450-eeed-41a0-88f7-c1e40a568acc/download/hospitals.csv")
UA = {"User-Agent": "EdinburghEasyServices/1.0 (data pipeline)"}
CSV_PATH = os.path.join(_HERE, "data", "hospitals.csv")
CATEGORY = "nhs"
EDINBURGH_COUNCIL = "S12000036"
ORG = "NHS Lothian"

# Non-patient-facing sites (houses, day centres, administrative offices) - drop.
NON_PATIENT_FACING = {
    "S232H",  # Cambridge Street Day Centre
    "S243H",  # Ballenden House
    "S321H",  # Drumbrae House
    "S309H",  # Inchkeith House
    "S312H",  # Learning Disabilities Service Healthcare Houses
    "S234H",  # William Fraser Centre
    "S235H",  # The Islay Centre
}

HEADER = ["id", "n", "c", "a", "postcode", "lat", "lng", "days", "open", "close",
          "dt", "acc", "t", "g", "org", "source", "student_only", "registration",
          "institution", "tags", "description_original", "description_plain",
          "phone", "website", "free"]


def get_csv(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode("utf-8-sig"))))


def geocode(postcodes):
    info = {}
    pcs = sorted(set(p.strip().upper() for p in postcodes if isinstance(p, str) and p.strip()))
    for i in range(0, len(pcs), 100):
        batch = pcs[i:i + 100]
        req = urllib.request.Request(
            "https://api.postcodes.io/postcodes",
            data=json.dumps({"postcodes": batch}).encode(),
            headers={**UA, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.load(r)["result"]
        for item in res:
            rr = item.get("result")
            if rr:
                key = item["query"].upper().replace(" ", "")
                info[key] = {"lat": rr.get("latitude"), "lng": rr.get("longitude")}
        time.sleep(0.3)
    return info


def main():
    rows = get_csv(HOSPITALS_CSV)
    ed = [r for r in rows
          if r.get("CouncilArea") == EDINBURGH_COUNCIL
          and r.get("HospitalCode") not in NON_PATIENT_FACING]
    print(f"{len(ed)} City of Edinburgh hospitals (after dropping {len(NON_PATIENT_FACING)} non-patient-facing)")

    geo = geocode([r.get("Postcode") for r in ed])
    out = []
    for r in ed:
        code = r.get("HospitalCode")
        name = (r.get("HospitalName") or "Hospital").strip()
        pc = (r.get("Postcode") or "").strip()
        g = geo.get(pc.upper().replace(" ", "")) or {}
        area = " ".join((r.get("AddressLine1") or "").split())
        out.append({
            "id": "hosp_" + code,
            "n": name, "c": CATEGORY, "a": area, "postcode": pc,
            "lat": g.get("lat") or "", "lng": g.get("lng") or "",
            "days": "", "open": "", "close": "",
            "dt": "See NHS inform for services and opening times",
            "acc": "NHS hospital",
            "t": "NHS hospital", "g": 0, "org": ORG,
            "source": "opendata.nhs.scot (hospital codes)",
            "student_only": 0, "registration": 0, "institution": "all",
            "tags": "nhs;hospital",
            "description_original": f"{name} is an NHS hospital in Edinburgh.",
            "description_plain": (f"{name} is an NHS hospital in Edinburgh.\n"
                                  f"Go there for NHS care.\n"
                                  f"For emergencies, call 999."),
            "phone": "", "website": "", "free": 1,
        })
    out.sort(key=lambda r: r["n"].lower())

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        for r in out:
            w.writerow({k: r.get(k, "") for k in HEADER})
    print(f"wrote {len(out)} hospitals to {CSV_PATH}")

    loader = os.path.join(_HERE, "scripts", "load_csv_to_db.py")
    src = os.path.basename(CSV_PATH)
    cmd = f'"{sys.executable}" "{loader}" "{CSV_PATH}" --delete-source "{src}"'
    sys.exit(os.system(cmd))


if __name__ == "__main__":
    main()
