#!/usr/bin/env python
"""Fetch Edinburgh public libraries (locations + opening hours) and load them.

Source: City of Edinburgh Council "Library locations and opening hours" directory
(edinburgh.gov.uk/libraryopeninghours). The Spatial Hub Scotland WFS
(geo.spatialhub.scot) is IP-blocked from our network, so we use the council's
authoritative directory, which also has opening hours.

Records that are sub-departments of Central Library (same address/hours) and the
mobile library are skipped so the map isn't cluttered.

Usage:
    .venv/bin/python scripts/fetch_libraries.py
"""
import argparse
import csv
import html
import json
import os
import re
import sys
import time
import urllib.request

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://www.edinburgh.gov.uk"
DIRECTORY = BASE + "/directory/10199/a-to-z/{letter}"
UA = {"User-Agent": "EdinburghEasyServices/1.0 (data pipeline)"}
CSV_PATH = os.path.join(_HERE, "data", "libraries.csv")
CATEGORY = "Warm space"

# Central Library sub-departments (same building/hours) + mobile library: skip.
SKIP_SLUGS = {
    "art-and-design-library", "central-children-s-library", "central-lending-library",
    "edinburgh-and-scottish-collection", "music-library", "reference-library",
    "mobile-libraries",
}

HEADER = ["id", "n", "c", "a", "postcode", "lat", "lng", "days", "open", "close",
          "dt", "acc", "t", "g", "org", "source", "student_only", "registration",
          "institution", "tags", "description_original", "description_plain",
          "phone", "website", "free"]

PC_RE = re.compile(r"\b([A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2})\b")


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "ignore")


def collect_record_urls():
    urls = set()
    for letter in "ABCDEFGKLMNOPRSW":
        try:
            page = get(DIRECTORY.format(letter=letter))
        except Exception as e:
            print(f"  (A-Z {letter} failed: {e})")
            continue
        urls.update(re.findall(r"/directory-record/[0-9]+/[a-z0-9-]+", page))
        time.sleep(0.2)
    return sorted(urls)


def main_text(page):
    s = re.sub(r"<script.*?</script>", "", page, flags=re.S)
    s = re.sub(r"<style.*?</style>", "", s, flags=re.S)
    m = re.search(r"<main.*?</main>", s, re.S)
    s = m.group(0) if m else s
    text = html.unescape(re.sub(r"<[^>]+>", " ", s))
    return re.sub(r"\s+", " ", text)


def field(text, start, end):
    m = re.search(re.escape(start) + r"\s+(.*?)\s+" + re.escape(end), text)
    return m.group(1).strip() if m else ""


_DAY_ORDER = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
              "friday": 4, "saturday": 5, "sunday": 6}
_DAY_RE = r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?"
_TIME_RE = (r"(?:Open 24 hours|Closed|[\d]{1,2}(?::\d{2})?\s*(?:am|pm)\s*"
            r"(?:[–—-]|to)\s*[\d]{1,2}(?::\d{2})?\s*(?:am|pm)?)")
_SCHED_RE = re.compile(r"(" + _DAY_RE + r")\s*:\s*(" + _TIME_RE + r")", re.I)


def extract_hours(text):
    """Pull the day-by-day opening schedule out of the page text."""
    pairs = _SCHED_RE.findall(text)
    if not pairs:
        return ""
    best, cur = [], []
    for day, time_ in pairs:
        order = _DAY_ORDER.get(day.lower().rstrip("s"), -1)
        if cur and order != _DAY_ORDER.get(cur[-1][0].lower().rstrip("s"), -2) + 1:
            cur = []
        cur.append((day, time_))
        if len(cur) > len(best):
            best = cur
    if len(best) < 3:
        return ""
    return "; ".join(f"{d.rstrip('s')}: {t}" for d, t in best)


def parse_record(page, url):
    text = main_text(page)
    name = (re.search(r"<title>(.*?)\s*[-–]\s*Library", page, re.S) or [None, ""])[1]
    if not name:
        name = url.rsplit("/", 1)[-1].replace("-", " ").title()
    address = field(text, "Address", "Postcode")
    pc_m = PC_RE.search(text)
    postcode = pc_m.group(1).replace(" ", "") if pc_m else ""
    tel = field(text, "Telephone", "Email") or ""
    hours = extract_hours(text)
    return {"name": name, "address": address, "postcode": postcode,
            "phone": tel, "hours": hours}


def geocode(postcodes):
    info = {}
    pcs = sorted(set(p for p in postcodes if p))
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
                info[item["query"].upper().replace(" ", "")] = (rr.get("latitude"), rr.get("longitude"))
        time.sleep(0.3)
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-departments", action="store_true",
                    help="also include Central Library sub-departments and mobile library")
    args = ap.parse_args()

    urls = collect_record_urls()
    print(f"{len(urls)} library records")

    rows = []
    for u in urls:
        slug = u.rsplit("/", 1)[-1]
        if slug in SKIP_SLUGS and not args.include_departments:
            continue
        try:
            page = get(BASE + u)
        except Exception as e:
            print(f"  (skip {slug}: {e})")
            continue
        r = parse_record(page, u)
        if not r["postcode"]:
            print(f"  (no postcode for {slug}, skipping)")
            continue
        rows.append({**r, "id": "lib_" + slug, "url": BASE + u})
        time.sleep(0.2)

    print(f"{len(rows)} libraries to load")
    geo = geocode([r["postcode"] for r in rows])
    out = []
    for r in rows:
        lat, lng = geo.get(r["postcode"].upper(), (None, None))
        name = r["name"]
        hours = r["hours"] or "See library for opening hours"
        out.append({
            "id": r["id"], "n": name, "c": CATEGORY, "a": r["address"],
            "postcode": r["postcode"], "lat": lat or "", "lng": lng or "",
            "days": "0,1,2,3,4,5,6", "open": "", "close": "", "dt": hours,
            "acc": "Public library - free and open to all",
            "t": "Warm space and free library services",
            "g": 0, "org": "City of Edinburgh Council",
            "source": "edinburgh.gov.uk/libraryopeninghours",
            "student_only": 0, "registration": 0, "institution": "all",
            "tags": "warm;library;free;period-products",
            "description_original": f"{name} is a public library run by the City of Edinburgh Council. Address: {r['address']}, {r['postcode']}.",
            "description_plain": (f"{name} is a public library.\n"
                                  f"It is free to use.\n"
                                  f"You can sit and get warm, read, and use free WiFi.\n"
                                  f"Libraries also give out free period products."),
            "phone": r["phone"], "website": r["url"], "free": 1,
        })
    out.sort(key=lambda r: r["n"].lower())

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        for r in out:
            w.writerow({k: r.get(k, "") for k in HEADER})
    print(f"wrote {len(out)} libraries to {CSV_PATH}")

    loader = os.path.join(_HERE, "scripts", "load_csv_to_db.py")
    src = os.path.basename(CSV_PATH)
    sys.exit(os.system(f'"{sys.executable}" "{loader}" "{CSV_PATH}" --delete-source "{src}"'))


if __name__ == "__main__":
    main()
