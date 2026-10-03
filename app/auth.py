"""Accounts: email + password sign up, with a 6-digit code sent to the email.

Accounts live in their own SQLite file (db/users.db) so rebuilding the services
database never wipes them. Verification emails go out over SMTP when the
SMTP_* environment variables are set (see .env.example). Without them the app
runs in dev mode: the code is printed in the server log and handed back to the
page, so the flow can still be tried locally.
"""
import hashlib
import hmac
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
from email.message import EmailMessage
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from .data import get_provider
from .schemas import (AuthResponse, EmailRequest, GpRequest, LoginRequest,
                      SignupRequest, User, VerifyRequest)

router = APIRouter(prefix="/api/auth")

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USERS_DB = os.environ.get("USERS_DB", os.path.join(_HERE, "db", "users.db"))

CODE_TTL = 10 * 60          # seconds a code stays valid
RESEND_WAIT = 30            # seconds between emails to the same address
MAX_ATTEMPTS = 5            # wrong guesses before a new code is needed
MIN_PASSWORD = 8
PBKDF2_ROUNDS = 600_000
YEARS = {"1", "2", "3", "4", "5+", "pg"}
# The four universities in Edinburgh.
STUDENT_DOMAINS = {"ed.ac.uk", "live.napier.ac.uk", "hw.ac.uk", "qmu.ac.uk"}
STUDENT_EMAIL_HELP = "Please use your university email, like name@ed.ac.uk"

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash BLOB NOT NULL,
    salt          BLOB NOT NULL,
    is_student    INTEGER NOT NULL DEFAULT 0,
    year          TEXT,
    verified      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS codes (
    email      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    sent_at    INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
);
"""


def _db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(USERS_DB), exist_ok=True)
    conn = sqlite3.connect(USERS_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(_SCHEMA)
    # Added after the first release; older databases do not have it yet.
    if "gp_id" not in [c["name"] for c in conn.execute("PRAGMA table_info(users)")]:
        conn.execute("ALTER TABLE users ADD COLUMN gp_id TEXT")
    return conn


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _clean_email(email: str) -> str:
    email = email.strip().lower()
    if not _EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(status_code=422, detail="That email address does not look right.")
    return email


def _is_student_email(email: str) -> bool:
    return email.rsplit("@", 1)[1] in STUDENT_DOMAINS


def _user(row) -> User:
    return User(email=row["email"], is_student=bool(row["is_student"]), year=row["year"],
                gp_id=row["gp_id"])


# ---------- Email ----------
def smtp_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST"))


def _send_email(to: str, code: str) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASSWORD")

    msg = EmailMessage()
    msg["Subject"] = f"Your LifeLine code: {code}"
    msg["From"] = os.environ.get("SMTP_FROM") or user
    msg["To"] = to
    msg.set_content(
        f"Your LifeLine code is {code}\n\n"
        f"Type it into the app to finish making your account. "
        f"It works for {CODE_TTL // 60} minutes.\n\n"
        "If you did not ask for this, you can ignore this email."
    )

    context = ssl.create_default_context()
    if port == 465:
        server = smtplib.SMTP_SSL(host, port, timeout=15, context=context)
    else:
        server = smtplib.SMTP(host, port, timeout=15)
        server.starttls(context=context)
    with server:
        if user and password:
            server.login(user, password)
        server.send_message(msg)


def _issue_code(conn: sqlite3.Connection, email: str, explicit: bool = False) -> Optional[str]:
    """Create, store and send a fresh code. Returns the code only in dev mode.

    An address is emailed at most once every RESEND_WAIT seconds. Inside that
    window the last code still stands, so only an explicit "send a new code"
    is turned away.
    """
    now = int(time.time())
    last = conn.execute("SELECT sent_at FROM codes WHERE email = ?", (email,)).fetchone()
    if smtp_configured() and last and now - last["sent_at"] < RESEND_WAIT:
        if explicit:
            raise HTTPException(status_code=429,
                                detail="We just sent a code. Please wait a moment and try again.")
        return None

    code = f"{secrets.randbelow(10 ** 6):06d}"
    conn.execute(
        "INSERT OR REPLACE INTO codes (email, code_hash, expires_at, sent_at, attempts) "
        "VALUES (?, ?, ?, ?, 0)",
        (email, _sha(email + code), now + CODE_TTL, now),
    )
    conn.commit()

    if not smtp_configured():
        print(f"[auth] dev mode - no SMTP set up. Code for {email}: {code}", flush=True)
        return code
    try:
        _send_email(email, code)
    except Exception as exc:  # smtplib raises many unrelated types
        print(f"[auth] sending to {email} failed: {exc!r}", flush=True)
        raise HTTPException(status_code=502,
                            detail="We could not send the email. Please try again.")
    return None


def _start_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)",
                 (_sha(token), user_id, int(time.time())))
    conn.commit()
    return token


def _bearer(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not signed in.")
    return authorization[7:].strip()


# ---------- Routes ----------
@router.post("/signup", response_model=AuthResponse)
def signup(req: SignupRequest) -> AuthResponse:
    email = _clean_email(req.email)
    if len(req.password) < MIN_PASSWORD:
        raise HTTPException(status_code=422,
                            detail=f"Use at least {MIN_PASSWORD} characters for your password.")
    year = None
    if req.is_student:
        if not _is_student_email(email):
            raise HTTPException(status_code=422, detail=STUDENT_EMAIL_HELP)
        if req.year not in YEARS:
            raise HTTPException(status_code=422, detail="Please choose your year of study.")
        year = req.year

    conn = _db()
    try:
        row = conn.execute("SELECT verified FROM users WHERE email = ?", (email,)).fetchone()
        if row and row["verified"]:
            raise HTTPException(status_code=409,
                                detail="There is already an account with this email. Log in instead.")
        salt = secrets.token_bytes(16)
        # An unverified account is overwritten: nobody has proved they own the email yet.
        conn.execute(
            "INSERT INTO users (email, password_hash, salt, is_student, year, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, "
            "salt = excluded.salt, is_student = excluded.is_student, year = excluded.year",
            (email, _hash_password(req.password, salt), salt, int(req.is_student), year,
             int(time.time())),
        )
        conn.commit()
        dev_code = _issue_code(conn, email)
    finally:
        conn.close()
    return AuthResponse(status="verify", dev_code=dev_code)


@router.post("/resend", response_model=AuthResponse)
def resend(req: EmailRequest) -> AuthResponse:
    email = _clean_email(req.email)
    conn = _db()
    try:
        row = conn.execute("SELECT verified FROM users WHERE email = ?", (email,)).fetchone()
        if not row or row["verified"]:
            raise HTTPException(status_code=404, detail="No sign up is waiting for this email.")
        dev_code = _issue_code(conn, email, explicit=True)
    finally:
        conn.close()
    return AuthResponse(status="verify", dev_code=dev_code)


@router.post("/verify", response_model=AuthResponse)
def verify(req: VerifyRequest) -> AuthResponse:
    email = _clean_email(req.email)
    code = re.sub(r"\s", "", req.code)
    conn = _db()
    try:
        row = conn.execute("SELECT * FROM codes WHERE email = ?", (email,)).fetchone()
        if not row or row["expires_at"] < time.time() or row["attempts"] >= MAX_ATTEMPTS:
            raise HTTPException(status_code=400,
                                detail="That code has run out. Ask for a new one.")
        if not hmac.compare_digest(row["code_hash"], _sha(email + code)):
            conn.execute("UPDATE codes SET attempts = attempts + 1 WHERE email = ?", (email,))
            conn.commit()
            raise HTTPException(status_code=400, detail="That code is not right. Check and try again.")

        conn.execute("DELETE FROM codes WHERE email = ?", (email,))
        conn.execute("UPDATE users SET verified = 1 WHERE email = ?", (email,))
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        token = _start_session(conn, user["id"])
    finally:
        conn.close()
    return AuthResponse(status="ok", token=token, user=_user(user))


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest) -> AuthResponse:
    email = _clean_email(req.email)
    conn = _db()
    try:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        # Hash even when the email is unknown so both cases take the same time.
        salt = user["salt"] if user else b"\0" * 16
        given = _hash_password(req.password, salt)
        if not user or not hmac.compare_digest(given, user["password_hash"]):
            raise HTTPException(status_code=401, detail="That email or password is not right.")
        if not user["verified"]:
            return AuthResponse(status="verify", dev_code=_issue_code(conn, email))
        token = _start_session(conn, user["id"])
    finally:
        conn.close()
    return AuthResponse(status="ok", token=token, user=_user(user))


@router.get("/me", response_model=User)
def me(authorization: Optional[str] = Header(default=None)) -> User:
    conn = _db()
    try:
        row = conn.execute(
            "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
            "WHERE token_hash = ?", (_sha(_bearer(authorization)),)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="Not signed in.")
    return _user(row)


@router.put("/gp", response_model=User)
def set_gp(req: GpRequest, authorization: Optional[str] = Header(default=None)) -> User:
    if req.gp_id is not None and get_provider().get(req.gp_id) is None:
        raise HTTPException(status_code=404, detail="We could not find that GP practice.")
    conn = _db()
    try:
        row = conn.execute("SELECT user_id FROM sessions WHERE token_hash = ?",
                           (_sha(_bearer(authorization)),)).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Not signed in.")
        conn.execute("UPDATE users SET gp_id = ? WHERE id = ?", (req.gp_id, row["user_id"]))
        conn.commit()
        user = conn.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
    finally:
        conn.close()
    return _user(user)


@router.post("/logout")
def logout(authorization: Optional[str] = Header(default=None)):
    conn = _db()
    try:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_sha(_bearer(authorization)),))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}
