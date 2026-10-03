#!/usr/bin/env python
"""Fetch Edinburgh free period-product locations from myperiod.org.uk (My Period).

The My Period site has no public JSON API: /api/Report/* endpoints return 405 and the
location data is server-rendered into the homepage HTML (all UK locations). We scrape
that HTML, keep the City of Edinburgh ones (via postcodes.io geocoding), and load them
under the "Period" category.

Usage:
    .venv/bin/python scripts/fetch_period.py
"""
import csv
import html
import json
import os
import re
import sys
import time
import urllib.request

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://myperiodlive.azurewebsites.net/"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"}
CSV_PATH = os.path.join(_HERE, "data", "period.csv")
CATEGORY = "Period"

PC_RE = re.compile(r"\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b")
DAY_RE = re.compile(r"(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)")


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read().decode("utf-8", "ignore")


def parse_locations(s):
    starts = [m.start() for m in re.finditer(r'id="details-location-\d+"', s)]
    starts.append(len(s))
    out = []
    for i in range(len(starts) - 1):
        seg = s[starts[i]:starts[i + 1]]
        did = re.search(r'id="details-location-(\d+)"', seg).group(1)
        lat = (re.search(r'data-lat="([^"]*)"', seg) or [None, ""])[1]
        lng = (re.search(r'data-lng="([^"]*)"', seg) or [None, ""])[1]
        name = re.search(r"<h4[^>]*>\s*<strong>(.*?)</strong>", seg, re.S)
        name = html.unescape(name.group(1)).strip() if name else "?"
        pc = PC_RE.search(seg)
        pc = pc.group(1).replace(" ", "") if pc else ""
        if not pc.startswith("EH"):
            continue

        # address block (text-smaller before "Opening times")
        addr_m = re.search(r'class="text-smaller col-md-12">(.*?)</div>', seg, re.S)
        addr = html.unescape(re.sub(r"<[^>]+>", " ", addr_m.group(1))) if addr_m else ""
        addr = re.sub(r"\s+", " ", addr).strip()

        # opening hours
        hours = "; ".join(
            f"{d}: {t}" for d, t in re.findall(
                r"<div>(\w+day):</div>\s*<div[^>]*>([^<]+)</div>", seg))

        # products + facilities (img alt tags)
        products = re.findall(r'class="map-product".*?alt="([^"]+)"', seg, re.S)
        facilities = re.findall(r'class="map-feature".*?alt="([^"]+)"', seg, re.S)

        # organisation contact (tel / email / name)
        tel = (re.search(r'href="tel:([^"]+)"', seg) or [None, ""])[1].strip()
        email = (re.search(r'href="mailto:([^"]+)"', seg) or [None, ""])[1].strip()
        org = (re.search(r'<div class="col-12">\s*([^<\n]{2,60})<br/>', seg) or [None, ""])[1].strip()

        out.append({"id": "per_" + did, "name": name, "address": addr, "postcode": pc,
                    "lat": lat, "lng": lng, "hours": hours, "products": products,
                    "facilities": facilities, "phone": tel, "email": email, "org": org})
    return out


def geocode_districts(postcodes):
    info = {}
    pcs = sorted(set(p for p in postcodes if p))
    for j in range(0, len(pcs), 100):
        batch = pcs[j:j + 100]
        req = urllib.request.Request(
            "https://api.postcodes.io/postcodes",
            data=json.dumps({"postcodes": batch}).encode(),
            headers={**UA, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.load(r)["result"]
        for item in res:
            rr = item.get("result")
            if rr:
                info[item["query"].upper().replace(" ", "")] = rr.get("admin_district")
        time.sleep(0.3)
    return info


def main():
    print("fetching", URL, flush=True)
    s = get(URL)
    recs = parse_locations(s)
    print(f"{len(recs)} EH-postcode locations")

    districts = geocode_districts([r["postcode"] for r in recs])
    city = [r for r in recs if districts.get(r["postcode"]) == "City of Edinburgh"]
    print(f"{len(city)} in City of Edinburgh")

    HEADER = ["id", "n", "c", "a", "postcode", "lat", "lng", "days", "open", "close",
              "dt", "acc", "t", "g", "org", "source", "student_only", "registration",
              "institution", "tags", "description_original", "description_plain",
              "phone", "website", "free"]

    rows = []
    for r in sorted(city, key=lambda x: x["name"].lower()):
        prods = ", ".join(dict.fromkeys(p for p in r["products"] if p and "icon" not in p.lower()))
        facs = ", ".join(dict.fromkeys(
            p.replace(" icon", "").strip().title() for p in r["facilities"] if p)) or "Open to all"
        acc = f"Free period products ({prods or 'various'}). {facs}."
        tags = "period;periodproducts;free;" + ";".join(
            p.lower().replace(" ", "") for p in r["products"] if p and "icon" not in p.lower())
        rows.append({
            "id": r["id"], "n": r["name"], "c": CATEGORY, "a": r["address"],
            "postcode": r["postcode"], "lat": r["lat"], "lng": r["lng"],
            "days": "", "open": "", "close": "",
            "dt": r["hours"] or "See location for opening times",
            "acc": acc, "t": "Free period products",
            "g": 0, "org": r["org"] or "My Period", "source": "myperiod.org.uk",
            "student_only": 0, "registration": 0, "institution": "all",
            "tags": tags,
            "description_original": (f"{r['name']} provides free period products "
                                     f"in Edinburgh. Address: {r['address']}, {r['postcode']}."),
            "description_plain": (f"{r['name']} gives out free period products.\n"
                                  f"It is in Edinburgh.\n{acc}"),
            "phone": r["phone"], "website": "", "free": 1,
        })

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in HEADER})
    print(f"wrote {len(rows)} period locations to {CSV_PATH}")

    loader = os.path.join(_HERE, "scripts", "load_csv_to_db.py")
    src = os.path.basename(CSV_PATH)
    sys.exit(os.system(f'"{sys.executable}" "{loader}" "{CSV_PATH}" --delete-source "{src}"'))


if __name__ == "__main__":
    main()
