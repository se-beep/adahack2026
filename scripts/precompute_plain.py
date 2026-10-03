#!/usr/bin/env python
"""Precompute plain-language descriptions for all services.

By default it only fills services whose description_plain is empty. Pass
--overwrite to regenerate every description with the model.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import translator  # noqa: E402

DEFAULT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "app", "data", "services.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", default=DEFAULT)
    ap.add_argument("--overwrite", action="store_true", help="regenerate all descriptions")
    args = ap.parse_args()

    with open(args.path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # warm up the model once
    translator.translate("warm up")

    changed = 0
    for item in data:
        plain = item.get("description_plain", "").strip()
        if plain and not args.overwrite:
            continue
        original = item.get("description_original", "").strip()
        if not original:
            continue
        print(f"translating: {item.get('id')} ...", flush=True)
        item["description_plain"] = translator.translate(original)
        changed += 1

    with open(args.path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"done. updated {changed} descriptions in {args.path}")


if __name__ == "__main__":
    main()
