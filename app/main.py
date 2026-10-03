from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import translator
from .data import get_provider
from .schemas import Service, ServiceSummary, TranslateRequest, TranslateResponse

app = FastAPI(title="Edinburgh Plain Services Demo")

_STATIC = "app/static"


@app.get("/api/services", response_model=List[ServiceSummary])
def list_services(
    category: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
) -> List[ServiceSummary]:
    provider = get_provider()
    return [
        ServiceSummary(
            id=s.id, name=s.name, category=s.category, description_plain=s.description_plain,
            address=s.address, location=s.location, free=s.free,
        )
        for s in provider.query(category=category, q=q)
    ]


@app.get("/api/services/{service_id}", response_model=Service)
def get_service(service_id: str) -> Service:
    provider = get_provider()
    s = provider.get(service_id)
    if s is None:
        raise HTTPException(status_code=404, detail="service not found")
    return s


@app.get("/api/categories")
def categories() -> List[str]:
    return get_provider().categories()


@app.post("/api/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest) -> TranslateResponse:
    if not req.text.strip():
        raise HTTPException(status_code=422, detail="empty text")
    plain = translator.translate(req.text)
    return TranslateResponse(plain=plain)


@app.get("/api/health")
def health():
    return {"ok": True, "services": len(get_provider().services),
            "model_loaded": translator.model_loaded()}


@app.get("/")
def index():
    return FileResponse(f"{_STATIC}/index.html")


app.mount("/static", StaticFiles(directory=_STATIC), name="static")
