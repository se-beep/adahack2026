#!/usr/bin/env python
"""Fetch Edinburgh public toilets from the Great British Public Toilet Map
(toiletmap.org.uk) and load them into the DB.

The Toilet Map publishes a full UK CSV export on its dataset page
(https://www.toiletmap.org.uk/dataset). We scrape that page for the current
export link, filter to active City of Edinburgh toilets (via the `areas` field),
and load them under the "Public toilet" category.

Usage:
    .venv/bin/python scripts/fetch_toilets.py
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET_URL = "https://www.toiletmap.org.uk/dataset"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"}
CSV_PATH = os.path.join(_HERE, "data", "toilets.csv")
CATEGORY = "Public toilet"

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
HEADER = ["id", "n", "c", "a", "postcode", "lat", "lng", "days", "open", "close",
          "dt", "acc", "t", "g", "org", "source", "student_only", "registration",
          "institution", "tags", "description_original", "description_plain",
          "phone", "website", "free"]


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def find_export_url():
    page = get(DATASET_URL).decode("utf-8", "ignore")
    m = re.search(r'href="([^"]*blob\.vercel-storage\.com/[^"]*\.csv\?download=1)"', page)
    if not m:
        raise RuntimeError("could not find CSV export link on dataset page")
    return m.group(1)


def area_name(row):
    try:
        return (json.loads(row.get("areas") or "{}") or {}).get("name", "")
    except Exception:
        return ""


def parse_opening_times(row):
    """Return a human-readable schedule from the opening_times JSON, or ''."""
    raw = row.get("opening_times") or ""
    if not raw.strip():
        return ""
    try:
        data = json.loads(raw)
    except Exception:
        return ""
    if not isinstance(data, list) or len(data) != 7:
        return ""
    parts = []
    for i, slot in enumerate(data):
        if isinstance(slot, list) and len(slot) == 2 and all(slot):
            parts.append(f"{DAYS[i]}: {slot[0]}-{slot[1]}")
    return "; ".join(parts)


def facilities(row):
    bits = []
    if row.get("accessible") == "true":
        bits.append("Disabled access")
    if row.get("baby_change") == "true":
        bits.append("Baby changing")
    if row.get("radar") == "true":
        bits.append("RADAR key")
    if row.get("attended") == "true":
        bits.append("Attended")
    if row.get("automatic") == "true":
        bits.append("Automatic")
    g = []
    if row.get("men") == "true":
        g.append("Men")
    if row.get("women") == "true":
        g.append("Women")
    if row.get("all_gender") == "true":
        g.append("All-gender")
    if g:
        bits.append("Toilets: " + ", ".join(g))
    return bits


def main():
    url = find_export_url()
    print("downloading", url, flush=True)
    text = get(url).decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    ed = [r for r in rows if area_name(r) == "City of Edinburgh" and r.get("active") != "false"]
    print(f"{len(ed)} City of Edinburgh toilets")

    out = []
    for r in ed:
        name = (r.get("name") or "").strip() or "Public toilet"
        facs = facilities(r)
        acc = "Free public toilet" if r.get("no_payment") == "true" else "Public toilet"
        if facs:
            acc += ". " + ", ".join(facs)
        tags = "toilet;public" + (";free" if r.get("no_payment") == "true" else "")
        if r.get("accessible") == "true":
            tags += ";accessible"
        schedule = parse_opening_times(r)
        notes = " ".join((r.get("notes") or "").split())
        dt = schedule or (notes[:200] if notes else "See toilet map for opening times")
        out.append({
            "id": "wc_" + r["id"], "n": name, "c": CATEGORY,
            "a": (r.get("name") or "").strip(), "postcode": "",
            "lat": r.get("latitude") or "", "lng": r.get("longitude") or "",
            "days": "0,1,2,3,4,5,6", "open": "", "close": "", "dt": dt,
            "acc": acc, "t": "Public toilet",
            "g": 0, "org": "City of Edinburgh Council",
            "source": "toiletmap.org.uk",
            "student_only": 0, "registration": 0, "institution": "all",
            "tags": tags,
            "description_original": f"{name} is a public toilet in Edinburgh. {acc}",
            "description_plain": f"{name} is a public toilet.\nIt is in Edinburgh.\n{acc}",
            "phone": "", "website": "", "free": 1 if r.get("no_payment") == "true" else 0,
        })
    out.sort(key=lambda r: r["n"].lower())

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        w.writeheader()
        for r in out:
            w.writerow({k: r.get(k, "") for k in HEADER})
    print(f"wrote {len(out)} toilets to {CSV_PATH}")

    loader = os.path.join(_HERE, "scripts", "load_csv_to_db.py")
    src = os.path.basename(CSV_PATH)
    sys.exit(os.system(f'"{sys.executable}" "{loader}" "{CSV_PATH}" --delete-source "{src}"'))


if __name__ == "__main__":
    main()
