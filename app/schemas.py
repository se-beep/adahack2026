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
    phone: Optional[str] = None
    tags: List[str] = []


class TranslateRequest(BaseModel):
    text: str


class TranslateResponse(BaseModel):
    plain: str


class User(BaseModel):
    email: str
    is_student: bool
    year: Optional[str] = None
    gp_id: Optional[str] = None      # the GP practice the user says they are registered with


class GpRequest(BaseModel):
    gp_id: Optional[str] = None


class SignupRequest(BaseModel):
    email: str
    password: str
    is_student: bool = False
    year: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class EmailRequest(BaseModel):
    email: str


class VerifyRequest(BaseModel):
    email: str
    code: str


class AuthResponse(BaseModel):
    status: str                      # "verify" (code sent) or "ok" (signed in)
    token: Optional[str] = None
    user: Optional[User] = None
    dev_code: Optional[str] = None   # only set when no SMTP server is configured
