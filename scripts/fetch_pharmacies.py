#!/usr/bin/env python
"""Fetch Edinburgh community pharmacies and load them into the DB.

Source: Public Health Scotland "Dispenser Location Contact Details"
(opendata.nhs.scot), which lists every NHS pharmacy with its address and phone
number. Rows are geocoded via postcodes.io, like the GP practices in fetch_nhs.py.
Writes data/pharmacies.csv and ingests into db/services.db.

Usage:
    .venv/bin/python scripts/fetch_pharmacies.py
    .venv/bin/python scripts/fetch_pharmacies.py --city    # restrict to City of Edinburgh
"""
import argparse
import csv
import io
import os
import re
import sys
import urllib.parse
import urllib.request

from fetch_nhs import HEADER, NHS_BASE, UA, geocode, http_get_json

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = "dispenser-location-contact-details"
CSV_PATH = os.path.join(_HERE, "data", "pharmacies.csv")

# Company names arrive in capitals; keep these words as they are usually written.
_KEEP = {"UK": "UK", "LTD": "Ltd", "LLP": "LLP", "PLC": "plc", "T/A": "t/a", "AND": "and", "OF": "of"}


def latest_resource_url():
    d = http_get_json(NHS_BASE + "/package_show?id=" + urllib.parse.quote(DATASET))
    res = sorted(d["result"]["resources"], key=lambda x: x.get("created", ""), reverse=True)
    return res[0]["url"]


def tidy(text):
    words = []
    for w in re.sub(r"\s+", " ", text or "").strip().split(" "):
        words.append(_KEEP.get(w.upper(), w.capitalize() if w.isupper() or w.islower() else w))
    return " ".join(words)


def fetch_records():
    req = urllib.request.Request(latest_resource_url(), headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        text = r.read().decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    return [r for r in rows if str(r.get("DispLocationPostcode", "")).startswith("EH")]


def map_pharmacy(r):
    lines = [r.get("DispLocationAddress%d" % i) or "" for i in range(1, 5)]
    address = ", ".join(tidy(l) for l in lines if l.strip() and l.strip().upper() != "NA")
    name = tidy(r.get("DispLocationName"))
    plain = (f"{name} is a pharmacy.\n"
             "You can ask the pharmacist for advice. You do not need an appointment.\n"
             "They can help with small injuries and common illnesses.")
    return {
        "id": "ph_" + str(r.get("DispCode")), "n": name, "c": "Pharmacy", "a": address,
        "postcode": r.get("DispLocationPostcode") or "", "lat": "", "lng": "",
        "days": "", "open": "", "close": "", "dt": "Call the pharmacy for opening times",
        "acc": "Walk in - no appointment needed",
        "t": "Advice and treatment for minor injuries and common illnesses", "g": 0,
        "org": "NHS Scotland", "source": "opendata.nhs.scot", "student_only": 0,
        "registration": 0, "institution": "all", "tags": "nhs;pharmacy",
        "description_original": plain, "description_plain": plain,
        "phone": (r.get("DispLocationTelNo") or "").strip(), "website": "", "free": 1,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", action="store_true", help="restrict to City of Edinburgh")
    args = ap.parse_args()

    rows = [map_pharmacy(r) for r in fetch_records()]
    print(f"{len(rows)} EH pharmacies fetched")

    geo = geocode([r["postcode"] for r in rows])
    kept = []
    for r in rows:
        g = geo.get(r["postcode"].upper().replace(" ", "")) or {}
        if not g.get("lat"):
            continue
        if args.city and g.get("district") != "City of Edinburgh":
            continue
        r["lat"], r["lng"] = g["lat"], g["lng"]
        kept.append(r)
    kept.sort(key=lambda r: r["n"].lower())

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        w.writerows(kept)
    print(f"wrote {len(kept)} pharmacy rows to {CSV_PATH}")

    loader = os.path.join(_HERE, "scripts", "load_csv_to_db.py")
    sys.exit(os.system(f'"{sys.executable}" "{loader}" "{CSV_PATH}"'))


if __name__ == "__main__":
    main()
