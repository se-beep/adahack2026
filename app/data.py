"""Pluggable service data provider.

Loads services from the SQLite database (db/services.db) by default. If the
database does not exist yet, falls back to the bundled JSON seed so the app
still runs out of the box. To switch sources, set SERVICES_SOURCE and SERVICES_PATH.

Rows in the DB use the CSV schema (id,n,c,a,postcode,lat,lng,days,open,close,
dt,acc,t,g,org,source,student_only,registration,institution,tags). They are
mapped here into the app's Service model; plain/original descriptions are
synthesized from the available columns when not yet stored.
"""
import json
import os
import sqlite3
from typing import Dict, List, Optional

from .schemas import Address, Location, OpeningHours, Service

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(_HERE, "db", "services.db")
DEFAULT_JSON = os.path.join(_HERE, "app", "data", "services.json")

# Display names for categories whose stored key is not how it should read.
CATEGORY_NAMES = {"nhs": "NHS"}


def _synthesize_plain(row) -> str:
    parts = [row.get("access"), row.get("type"), row.get("timing_note"), row.get("org")]
    return " ".join(p for p in parts if p) or row.get("name") or ""


def _row_to_service(row) -> Service:
    area = row.get("area") or ""
    postcode = row.get("postcode") or ""
    days = row.get("days") or ""
    open_t = row.get("open_time") or None
    close_t = row.get("close_time") or None
    timing = row.get("timing_note") or None
    hours = []
    if days or open_t or close_t or timing:
        hours.append(OpeningHours(days=days or "See details", open=open_t,
                                  close=close_t, note=timing))
    free = row.get("free")
    free = bool(int(free)) if free is not None else True
    tags = [t.strip() for t in (row.get("tags") or "").split(";") if t.strip()]
    return Service(
        id=row["id"],
        name=row.get("name") or row["id"],
        category=CATEGORY_NAMES.get(row.get("category"), row.get("category") or "Other"),
        description_original=row.get("description_original") or _synthesize_plain(row),
        description_plain=row.get("description_plain") or _synthesize_plain(row),
        address=Address(street=area, postcode=postcode),
        location=Location(lat=row.get("lat") or 0.0, lon=row.get("lng") or 0.0),
        hours=hours,
        phone=row.get("phone"),
        website=row.get("website"),
        free=free,
        tags=tags,
    )


def _load_from_sqlite(path: str) -> List[Service]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT * FROM services").fetchall()
    finally:
        conn.close()
    return [_row_to_service(dict(r)) for r in rows]


def _load_from_json(path: str) -> List[Service]:
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return [Service(**item) for item in raw]


class ServiceProvider:
    def __init__(self, source: str = "sqlite", path: Optional[str] = None):
        self.source = source
        self.path = path or os.environ.get("SERVICES_PATH", DEFAULT_DB)
        self._services: List[Service] = []
        self._by_id: Dict[str, Service] = {}

    def load(self) -> "ServiceProvider":
        if self.source == "sqlite":
            try:
                if not os.path.exists(self.path) or os.path.getsize(self.path) == 0:
                    raise FileNotFoundError(self.path)
                self._services = _load_from_sqlite(self.path)
            except (FileNotFoundError, sqlite3.Error):
                # no database yet -> fall back to the bundled JSON seed
                self._services = _load_from_json(DEFAULT_JSON)
        elif self.source == "json":
            self._services = _load_from_json(self.path)
        else:
            raise NotImplementedError(f"data source '{self.source}' not implemented")
        self._by_id = {s.id: s for s in self._services}
        return self

    @property
    def services(self) -> List[Service]:
        return self._services

    def all(self) -> List[Service]:
        return self._services

    def get(self, service_id: str) -> Optional[Service]:
        return self._by_id.get(service_id)

    def categories(self) -> List[str]:
        seen: List[str] = []
        for s in self._services:
            if s.category not in seen:
                seen.append(s.category)
        return sorted(seen)

    def query(self, category: Optional[str] = None, q: Optional[str] = None) -> List[Service]:
        ql = (q or "").strip().lower()
        out = []
        for s in self._services:
            if category and s.category != category:
                continue
            if ql:
                hay = " ".join([s.name, s.category, s.description_plain,
                                s.address.street, s.address.postcode]).lower()
                if ql not in hay:
                    continue
            out.append(s)
        return out


_provider: Optional[ServiceProvider] = None


def get_provider() -> ServiceProvider:
    global _provider
    if _provider is None:
        _provider = ServiceProvider(source=os.environ.get("SERVICES_SOURCE", "sqlite")).load()
    return _provider
