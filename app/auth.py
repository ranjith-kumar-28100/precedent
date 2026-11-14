"""Sign-in for the dashboard: users and sessions in SQLite.

- Passwords are hashed with scrypt (stdlib), a per-user random salt, compared in constant time.
- Sessions are random 256-bit tokens in an HttpOnly, SameSite=Strict cookie; only a SHA-256 of the token is stored,
  so a copied database can't be used to log in. Sessions expire (SESSION_HOURS) and sign-out deletes them.
- Failed sign-ins are throttled per username and client IP; unknown users and wrong passwords get the same answer
  and take the same time.
- API clients use the OAuth2 password flow instead: POST /api/auth/token returns a short-lived JWT (HS256, signed
  with JWT_SECRET, pinned algorithm, issuer/audience/expiry checked, unique jti so it can be revoked).
- Off unless AUTH_ENABLED=1, so local runs and tests are unchanged. Service clients (the Band agents) can also use
  `Authorization: Bearer <API_SERVICE_TOKEN>`.
"""
import hashlib
import hmac
import secrets
import sqlite3
import threading
import time
from contextlib import closing

import jwt

from . import config

COOKIE = "precedent_session"
SESSION_HOURS = float(config.env("SESSION_HOURS", "8"))
MAX_FAILS, LOCK_SECONDS = 5, 15 * 60
MIN_PASSWORD = 10
JWT_ALG, JWT_ISS, JWT_AUD = "HS256", "precedent", "precedent-api"
_EPHEMERAL_SECRET = secrets.token_urlsafe(48)  # used only if JWT_SECRET is unset: tokens then die with the process
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}
_LOCK = threading.Lock()
_FAILS: dict[tuple[str, str], list[float]] = {}  # (username, ip) -> failure timestamps


def enabled() -> bool:
    return config.env("AUTH_ENABLED", "0").lower() in ("1", "true", "yes")


def cookie_secure() -> bool:
    return config.env("COOKIE_SECURE", "0").lower() in ("1", "true", "yes")  # set to 1 behind HTTPS


def db_path():
    return config.DATA_DIR / "precedent.db"


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(db_path(), timeout=10)
    c.execute("PRAGMA foreign_keys = ON")
    c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, display_name TEXT NOT NULL,
            pw_hash TEXT NOT NULL, created_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS revoked_tokens (jti TEXT PRIMARY KEY, expires_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at REAL NOT NULL, expires_at REAL NOT NULL);
    """)
    return c


# ---- passwords ---------------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(dk) // 2)
        return hmac.compare_digest(got.hex(), dk)
    except (ValueError, TypeError):
        return False


_DUMMY = hash_password(secrets.token_hex(16))  # verified against for unknown users, so timing doesn't reveal them


# ---- users -------------------------------------------------------------------------------------
def create_user(username: str, password: str, display_name: str | None = None) -> None:
    username = username.strip()
    if not (3 <= len(username) <= 40) or not username.replace(".", "").replace("_", "").replace("-", "").isalnum():
        raise ValueError("username must be 3-40 letters, digits, '.', '_' or '-'")
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"password must be at least {MIN_PASSWORD} characters")
    with closing(_conn()) as c, c:
        try:
            c.execute("INSERT INTO users (username, display_name, pw_hash, created_at) VALUES (?, ?, ?, ?)",
                      (username, (display_name or username).strip()[:60], hash_password(password), time.time()))
        except sqlite3.IntegrityError:
            raise ValueError("user already exists") from None


def user_count() -> int:
    with closing(_conn()) as c:
        return c.execute("SELECT COUNT(*) FROM users").fetchone()[0]


# ---- throttling --------------------------------------------------------------------------------
def _key(username: str, ip: str) -> tuple[str, str]:
    return username.strip().lower(), ip or "?"


def locked_for(username: str, ip: str) -> int:
    """Seconds until this username+IP may try again (0 if not locked)."""
    now = time.time()
    with _LOCK:
        fails = [t for t in _FAILS.get(_key(username, ip), []) if now - t < LOCK_SECONDS]
        _FAILS[_key(username, ip)] = fails
        return int(LOCK_SECONDS - (now - fails[0])) + 1 if len(fails) >= MAX_FAILS else 0


def _record_fail(username: str, ip: str) -> None:
    with _LOCK:
        _FAILS.setdefault(_key(username, ip), []).append(time.time())


def _clear_fails(username: str, ip: str) -> None:
    with _LOCK:
        _FAILS.pop(_key(username, ip), None)


# ---- sessions ----------------------------------------------------------------------------------
def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def authenticate(username: str, password: str, ip: str) -> tuple[int, dict] | None:
    """Checks the password, recording failures for lockout. Returns (user id, user) or None. Callers check
    locked_for() first."""
    with closing(_conn()) as c:
        row = c.execute("SELECT id, username, display_name, pw_hash FROM users WHERE username = ?", (username.strip(),)).fetchone()
    ok = verify_password(password, row[3] if row else _DUMMY) and row is not None
    if not ok:
        _record_fail(username, ip)
        return None
    _clear_fails(username, ip)
    return row[0], {"username": row[1], "display_name": row[2]}


def login(username: str, password: str, ip: str) -> tuple[str, dict] | None:
    """Browser sign-in: returns (session token for the cookie, user) or None."""
    got = authenticate(username, password, ip)
    if not got:
        return None
    uid, user = got
    token, now = secrets.token_urlsafe(32), time.time()
    with closing(_conn()) as c, c:
        c.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        c.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                  (_h(token), uid, now, now + SESSION_HOURS * 3600))
    return token, user


def user_for(token: str | None) -> dict | None:
    if not token:
        return None
    with closing(_conn()) as c:
        row = c.execute("""SELECT u.username, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
                           WHERE s.token_hash = ? AND s.expires_at > ?""", (_h(token), time.time())).fetchone()
    return {"username": row[0], "display_name": row[1]} if row else None


def logout(token: str | None) -> None:
    if token:
        with closing(_conn()) as c, c:
            c.execute("DELETE FROM sessions WHERE token_hash = ?", (_h(token),))


def service_ok(authorization: str | None) -> bool:
    expected = config.env("API_SERVICE_TOKEN")
    if not expected or not authorization or not authorization.startswith("Bearer "):
        return False
    return hmac.compare_digest(authorization[7:].encode(), expected.encode())


# ---- OAuth2 bearer tokens (JWT) ------------------------------------------------------------------
def jwt_minutes() -> int:
    return int(config.env("JWT_MINUTES", "30"))


def _secret() -> str:
    s = config.env("JWT_SECRET")
    if s and len(s) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters")
    return s or _EPHEMERAL_SECRET


def issue_jwt(user: dict) -> tuple[str, int]:
    """Signed access token for `user`; returns (token, lifetime in seconds)."""
    now, ttl = int(time.time()), jwt_minutes() * 60
    claims = {"sub": user["username"], "name": user["display_name"], "iss": JWT_ISS, "aud": JWT_AUD,
              "iat": now, "nbf": now, "exp": now + ttl, "jti": secrets.token_urlsafe(16)}
    return jwt.encode(claims, _secret(), algorithm=JWT_ALG), ttl


def _claims(token: str) -> dict | None:
    try:  # algorithm pinned, so "alg: none" or a swapped algorithm is rejected
        return jwt.decode(token, _secret(), algorithms=[JWT_ALG], audience=JWT_AUD, issuer=JWT_ISS,
                          options={"require": ["exp", "iat", "nbf", "sub", "jti", "aud", "iss"]})
    except jwt.PyJWTError:
        return None


def user_for_jwt(token: str | None) -> dict | None:
    """The user a bearer token belongs to, if it is valid, unrevoked, and the user still exists."""
    c_ = _claims(token) if token else None
    if not c_:
        return None
    with closing(_conn()) as c:
        if c.execute("SELECT 1 FROM revoked_tokens WHERE jti = ?", (c_["jti"],)).fetchone():
            return None
        row = c.execute("SELECT username, display_name FROM users WHERE username = ?", (c_["sub"],)).fetchone()
    return {"username": row[0], "display_name": row[1]} if row else None


def revoke_jwt(token: str | None) -> bool:
    c_ = _claims(token) if token else None
    if not c_:
        return False
    with closing(_conn()) as c, c:
        c.execute("DELETE FROM revoked_tokens WHERE expires_at < ?", (time.time(),))
        c.execute("INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)", (c_["jti"], c_["exp"]))
    return True


def bearer(authorization: str | None) -> str | None:
    return authorization[7:].strip() if authorization and authorization[:7].lower() == "bearer " else None
