from typing import List, Optional
from pydantic import BaseModel


class Address(BaseModel):
    street: str
    postcode: str


class OpeningHours(BaseModel):
    days: str
    open: Optional[str] = None
    close: Optional[str] = None
    note: Optional[str] = None


class Location(BaseModel):
    lat: float
    lon: float


class Service(BaseModel):
    id: str
    name: str
    category: str
    description_original: str
    description_plain: str
    address: Address
    location: Location
    hours: List[OpeningHours] = []
    phone: Optional[str] = None
    website: Optional[str] = None
    free: bool = True
    tags: List[str] = []


class ServiceSummary(BaseModel):
    id: str
    name: str
    category: str
    description_plain: str
    address: Address
    location: Location
    free: bool


class TranslateRequest(BaseModel):
    text: str


class TranslateResponse(BaseModel):
    plain: str
