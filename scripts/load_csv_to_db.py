#!/usr/bin/env python
"""Load a services CSV (the nhs.ipynb schema) into the unified SQLite database.

Usage:
    .venv/bin/python scripts/load_csv_to_db.py <services.csv> [--db <path>]

Creates the schema (db/schema.sql) on first use. Inserts/upserts rows keyed by `id`,
and records which file each row came from.

CSV columns expected:
    id,n,c,a,postcode,lat,lng,days,open,close,dt,acc,t,g,org,source,
    student_only,registration,institution,tags
"""
import argparse
import csv
import os
import sys

# On the cluster, the inherited conda env's sqlite3 needs its newer libstdc++
# (CXXABI_1.3.15). Re-exec once with LD_LIBRARY_PATH set; harmless on a laptop
# where this path does not exist.
_ENV_LIB = "/data/data/wolfflab/btdixon/conda/envs/parsing_cu12/lib"
if os.path.isdir(_ENV_LIB) and _ENV_LIB not in os.environ.get("LD_LIBRARY_PATH", ""):
    os.environ["LD_LIBRARY_PATH"] = _ENV_LIB + ":" + os.environ.get("LD_LIBRARY_PATH", "")
    os.execv(sys.executable, [sys.executable] + sys.argv)

import sqlite3  # noqa: E402

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA = os.path.join(_HERE, "db", "schema.sql")
DEFAULT_DB = os.path.join(_HERE, "db", "services.db")

# CSV column -> database column. Columns absent from a CSV are just skipped.
COLUMN_MAP = {
    "id": "id", "n": "name", "c": "category", "a": "area",
    "postcode": "postcode", "lat": "lat", "lng": "lng",
    "days": "days", "open": "open_time", "close": "close_time",
    "dt": "timing_note", "acc": "access", "t": "type", "g": "g",
    "org": "org", "source": "source",
    "student_only": "student_only", "registration": "registration",
    "institution": "institution", "tags": "tags",
    "description_original": "description_original",
    "description_plain": "description_plain",
    "phone": "phone", "website": "website", "free": "free",
}
INT_COLS = {"g", "student_only", "registration", "free"}
FLOAT_COLS = {"lat", "lng"}


def clean(row, col):
    v = row.get(col, "")
    if v is None:
        return None
    v = str(v).strip()
    if v == "":
        return None
    if col in INT_COLS:
        try:
            return int(float(v))
        except ValueError:
            return None
    if col in FLOAT_COLS:
        try:
            return float(v)
        except ValueError:
            return None
    return v


def ensure_schema(conn):
    with open(SCHEMA) as f:
        conn.executescript(f.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", help="path to a services CSV")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--delete-category", default=None,
                    help="delete existing rows of this category before loading (refresh)")
    ap.add_argument("--delete-source", default=None,
                    help="delete existing rows from this source_file before loading (refresh)")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    ensure_schema(conn)

    if args.delete_category:
        cur = conn.execute("DELETE FROM services WHERE category = ?", (args.delete_category,))
        print(f"deleted {cur.rowcount} existing rows in category '{args.delete_category}'")
        conn.commit()
    if args.delete_source:
        cur = conn.execute("DELETE FROM services WHERE source_file = ?", (args.delete_source,))
        print(f"deleted {cur.rowcount} existing rows from source '{args.delete_source}'")
        conn.commit()

    source_file = os.path.basename(args.csv)
    rows = list(csv.DictReader(open(args.csv, encoding="utf-8-sig")))
    if not rows:
        print("no rows in", args.csv)
        return

    db_cols = [COLUMN_MAP[c] for c in rows[0] if c in COLUMN_MAP]
    placeholders = ", ".join(["?"] * len(db_cols))
    col_list = ", ".join(db_cols + ["source_file"])
    sql = f"INSERT OR REPLACE INTO services ({col_list}) VALUES ({placeholders}, ?)"

    n = 0
    csv_to_db = {c: d for c, d in COLUMN_MAP.items() if d in db_cols}
    for r in rows:
        vals = [clean(r, csv_col) for csv_col in csv_to_db]
        conn.execute(sql, vals + [source_file])
        n += 1
    conn.commit()

    total = conn.execute("SELECT COUNT(*) FROM services").fetchone()[0]
    by_cat = conn.execute(
        "SELECT category, COUNT(*) FROM services GROUP BY category ORDER BY category").fetchall()
    print(f"loaded {n} rows from {source_file} -> {args.db}")
    print(f"total services now: {total}")
    for cat, cnt in by_cat:
        print(f"  {cat}: {cnt}")
    conn.close()


if __name__ == "__main__":
    main()
