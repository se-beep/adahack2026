#!/usr/bin/env python
"""Fetch NHS services for Edinburgh and load them into the DB.

Mirrors nhs.ipynb:
  - 3 hardcoded triage destinations (A&E + 2 Minor Injuries)
  - every Edinburgh GP practice pulled live from the NHS open data CKAN API
  - geocoded via postcodes.io
Writes data/nhs.csv and ingests into db/services.db.

Usage:
    .venv/bin/python scripts/fetch_nhs.py
    .venv/bin/python scripts/fetch_nhs.py --city    # restrict to City of Edinburgh
"""
import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NHS_BASE = "https://www.opendata.nhs.scot/api/3/action"
GP_DATASET = "gp-practice-contact-details-and-list-sizes"
UA = {"User-Agent": "EdinburghEasyServices/1.0 (data pipeline)"}
CSV_PATH = os.path.join(_HERE, "data", "nhs.csv")

HEADER = ["id", "n", "c", "a", "postcode", "lat", "lng", "days", "open", "close",
          "dt", "acc", "t", "g", "org", "source", "student_only", "registration",
          "institution", "tags", "description_original", "description_plain",
          "phone", "website", "free"]

TRIAGE = [
    {"id": "n1", "n": "A&E, Royal Infirmary of Edinburgh", "a": "Little France",
     "postcode": "EH16 4SA", "days": "0,1,2,3,4,5,6", "open": "00:00", "close": "23:59",
     "dt": "Open 24 hours", "acc": "Emergency only",
     "t": "Life-threatening emergencies (adults). Call 999 if you cannot get there safely.",
     "org": "NHS Lothian", "tags": "nhs;emergency"},
    {"id": "n2", "n": "Minor Injuries Unit - Royal Infirmary", "a": "Little France",
     "postcode": "EH16 4SA", "days": "0,1,2,3,4,5,6", "open": "08:00", "close": "23:59",
     "dt": "Daily 08:00-00:00 (last book-in 23:30)", "acc": "Walk-in / self-refer",
     "t": "Cuts, sprains, minor burns and eye problems. Quicker than A&E.",
     "org": "NHS Lothian", "tags": "nhs;miu"},
    {"id": "n3", "n": "Minor Injuries Clinic - Western General", "a": "Crewe Toll",
     "postcode": "EH4 2XU", "days": "0,1,2,3,4,5,6", "open": "08:00", "close": "21:00",
     "dt": "Daily 08:00-21:00 (last book-in 20:30)", "acc": "Walk-in / phone first 0131 537 3481",
     "t": "Cuts, sprains, minor burns, simple fractures for ages 1+. Phone first to check.",
     "org": "NHS Lothian", "tags": "nhs;miu"},
]


def http_get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def latest_gp_resource_id():
    d = http_get_json(NHS_BASE + "/package_show?id=" + urllib.parse.quote(GP_DATASET))
    res = d["result"]["resources"]
    cand = [x for x in res if "practice_contact_details"
            in ((x.get("name", "") + x.get("url", "")).lower())] or res
    cand.sort(key=lambda x: x.get("created", ""), reverse=True)
    return cand[0]["id"]


def fetch_gp_records():
    rid = latest_gp_resource_id()
    sql = 'SELECT * FROM "' + rid + '" WHERE "Postcode" LIKE \'EH%\''
    url = NHS_BASE + "/datastore_search_sql?sql=" + urllib.parse.quote(sql)
    try:
        return http_get_json(url)["result"]["records"]
    except Exception as e:
        print("SQL endpoint failed, using CSV dump:", e)
        url = "https://www.opendata.nhs.scot/datastore/dump/" + rid + "?format=csv"
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=90) as r:
            text = r.read().decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(text)))
        return [r for r in rows if str(r.get("Postcode", "")).startswith("EH")]


def map_gp(r):
    return {
        "id": "gp_" + str(r.get("PracticeCode")),
        "n": str(r.get("GPPracticeName") or "").title(),
        "c": "nhs", "a": r.get("AddressLine3") or "", "postcode": r.get("Postcode") or "",
        "lat": "", "lng": "", "days": "", "open": "", "close": "",
        "dt": "See practice for hours",
        "acc": "GP practice - register or ask about access",
        "t": "NHS GP practice.", "g": 0, "org": "NHS Scotland",
        "source": "opendata.nhs.scot", "student_only": 0, "registration": 1,
        "institution": "all", "tags": "nhs;gp",
    }


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
                info[key] = {"lat": rr.get("latitude"), "lng": rr.get("longitude"),
                             "district": rr.get("admin_district")}
        time.sleep(0.3)
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", action="store_true", help="restrict to City of Edinburgh")
    args = ap.parse_args()

    rows = []
    for t in TRIAGE:
        rows.append({**{"c": "nhs", "lat": "", "lng": "", "g": 0, "source": "NHS Lothian",
                        "student_only": 0, "registration": 0, "institution": "all",
                        "description_original": "", "description_plain": "",
                        "phone": "", "website": "", "free": 1}, **t})

    try:
        gps = fetch_gp_records()
        rows += [map_gp(r) for r in gps]
        print(f"{len(gps)} EH GP practices fetched")
    except Exception as e:
        print("GP pull failed, continuing with triage only:", e)

    geo = geocode([r["postcode"] for r in rows])
    kept = []
    for r in rows:
        pc = (r.get("postcode") or "").upper().replace(" ", "")
        g = geo.get(pc) or {}
        r["lat"], r["lng"] = g.get("lat") or "", g.get("lng") or ""
        if args.city and g.get("district") and g.get("district") != "City of Edinburgh":
            continue
        if not r.get("description_plain"):
            r["description_plain"] = f"{r.get('n','')}.\n{r.get('acc','')}\n{r.get('dt','')}"
        if not r.get("description_original"):
            r["description_original"] = r.get("description_plain")
        kept.append(r)
    kept.sort(key=lambda r: r["n"].lower())

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        for r in kept:
            w.writerow({k: r.get(k, "") for k in HEADER})
    print(f"wrote {len(kept)} NHS rows to {CSV_PATH}")

    loader = os.path.join(_HERE, "scripts", "load_csv_to_db.py")
    sys.exit(os.system(f'"{sys.executable}" "{loader}" "{CSV_PATH}"'))


if __name__ == "__main__":
    main()
