#!/usr/bin/env python
"""Fetch Edinburgh food banks from the Give Food API and load them into our DB.

Mirrors the nhs.ipynb pattern. For each food bank it also calls the per-food-bank
detail endpoint, which lists the food bank's actual distribution LOCATIONS (the
places people visit to get food). Each location becomes its own service row.

Note: the detail API does NOT expose the food bank's own opening hours - only the
supermarkets' donation-bin hours, which are not when the food bank hands out food.
So opening hours are left as "confirm with the food bank".

Usage:
    .venv/bin/python scripts/fetch_foodbanks.py [--district "City of Edinburgh"]
    .venv/bin/python scripts/fetch_foodbanks.py --all-eh     # whole EH postcode area
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.request

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST_API = "https://www.givefood.org.uk/api/2/foodbanks/"
DETAIL_API = "https://www.givefood.org.uk/api/2/foodbank/{slug}/"
UA = {"User-Agent": "EdinburghEasyServices/1.0 (data pipeline)"}
CSV_PATH = os.path.join(_HERE, "data", "foodbanks.csv")
CATEGORY = "Food bank"

HEADER = ["id", "n", "c", "a", "postcode", "lat", "lng", "days", "open", "close",
          "dt", "acc", "t", "g", "org", "source", "student_only", "registration",
          "institution", "tags", "description_original", "description_plain",
          "phone", "website", "free"]


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def in_scope(fb, district, all_eh):
    pc = (fb.get("postcode") or "").strip().upper()
    d = (fb.get("politics") or {}).get("district") or ""
    if all_eh:
        return pc.startswith("EH")
    return d == district


def parse_ll(s):
    if not s:
        return "", ""
    parts = s.split(",")
    return parts[0].strip(), parts[1].strip()


def detail_locations(fb):
    """Return the food bank's distribution locations from the detail endpoint."""
    slug = fb.get("slug")
    if not slug:
        return [fb]
    try:
        d = get_json(DETAIL_API.format(slug=slug))
    except Exception as e:
        print(f"  (detail fetch failed for {slug}: {e})")
        return [fb]
    locs = d.get("locations") or []
    if not locs:
        return [fb]
    return locs


def make_row(fb, location):
    parent = fb.get("name") or "Food bank"
    loc_name = location.get("name") if location is not fb else None
    name = f"{parent} - {loc_name}" if loc_name else parent
    slug = fb.get("slug") or fb.get("id")
    loc_slug = location.get("slug")
    rid = f"fb_{slug}_{loc_slug}" if loc_slug else "fb_" + slug
    lat, lng = parse_ll(location.get("lat_lng") or fb.get("lat_lng"))
    district = (location.get("politics") or fb.get("politics") or {}).get("district") or ""
    network = fb.get("network") or "Independent"
    website = (fb.get("urls") or {}).get("html") or ""
    phone = location.get("phone") or fb.get("phone") or ""
    area = (location.get("address") or "").strip() or district
    area = " ".join(area.split())

    return {
        "id": rid,
        "n": name,
        "c": CATEGORY,
        "a": area,
        "postcode": (location.get("postcode") or fb.get("postcode") or "").strip(),
        "lat": lat, "lng": lng,
        "days": "", "open": "", "close": "",
        "dt": "See food bank for opening times",
        "acc": "Referral or voucher usually required",
        "t": "Emergency food parcels",
        "g": 0, "org": network, "source": "givefood.org.uk",
        "student_only": 0, "registration": 0, "institution": "all",
        "tags": "food;foodbank;referral;" + network.lower(),
        "description_original": f"{name} is a food bank in {district} ({network}).",
        "description_plain": (f"{name} gives out free food.\n"
                              f"It is in {district}.\n"
                              f"You may need a referral or voucher to get food."),
        "phone": phone, "website": website, "free": 1,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--district", default="City of Edinburgh")
    ap.add_argument("--all-eh", action="store_true",
                    help="include the whole EH postcode area, not just the city")
    args = ap.parse_args()

    data = get_json(LIST_API)
    scope = [fb for fb in data if in_scope(fb, args.district, args.all_eh) and not fb.get("closed")]
    print(f"{len(scope)} food banks in scope, fetching detail for each...")

    rows = []
    for fb in scope:
        locs = detail_locations(fb)
        for loc in locs:
            rows.append(make_row(fb, loc))
        time.sleep(0.3)
    rows.sort(key=lambda r: r["n"].lower())

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in HEADER})
    print(f"wrote {len(rows)} food bank locations to {CSV_PATH}")

    loader = os.path.join(_HERE, "scripts", "load_csv_to_db.py")
    cmd = f'"{sys.executable}" "{loader}" "{CSV_PATH}" --delete-category "{CATEGORY}"'
    sys.exit(os.system(cmd))


if __name__ == "__main__":
    main()
