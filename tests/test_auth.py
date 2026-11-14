import sqlite3
import time

import pytest

from app import auth, main

PW = "correct horse battery"


@pytest.fixture
def secured(api, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "1")
    auth.create_user("ranjith", PW, "Ranjith Kumar G")
    return api


def _login(api, user="ranjith", pw=PW):
    return api.post("/api/auth/login", json={"username": user, "password": pw})


def test_off_by_default_everything_open(api, monkeypatch):
    monkeypatch.delenv("AUTH_ENABLED", raising=False)
    assert api.get("/api/vendors").status_code == 200
    assert api.get("/api/auth/me").json() == {"auth_enabled": False, "user": None}


def test_api_requires_sign_in_when_enabled(secured):
    for path in ("/api/vendors", "/api/health", "/api/upcoming"):
        assert secured.get(path).status_code == 401
    assert secured.post("/api/outcome", json={}).status_code == 401  # rejected before validation or memory
    assert secured.get("/api/auth/me").status_code == 401


def test_static_ui_stays_public(secured):
    assert secured.get("/").status_code in (200, 404)  # the SPA (or a missing build) is never 401


def test_login_sets_secure_cookie_and_unlocks_api(secured):
    r = _login(secured)
    assert r.status_code == 200 and r.json() == {"username": "ranjith", "display_name": "Ranjith Kumar G"}
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "max-age=28800" in cookie
    assert secured.get("/api/vendors").status_code == 200
    assert secured.get("/api/auth/me").json()["user"]["username"] == "ranjith"


def test_username_is_case_insensitive(secured):
    assert _login(secured, user="RANJITH").status_code == 200


def test_wrong_password_and_unknown_user_look_the_same(secured):
    a, b = _login(secured, pw="nope-nope-nope"), _login(secured, user="ghost")
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json() == {"detail": "Invalid username or password."}


def test_lockout_after_five_failures(secured):
    for _ in range(5):
        assert _login(secured, pw="wrong-password").status_code == 401
    r = _login(secured)  # even the right password is refused while locked
    assert r.status_code == 429 and "Too many failed attempts" in r.json()["detail"]


def test_logout_revokes_the_session(secured):
    _login(secured)
    token = secured.cookies.get(auth.COOKIE)
    secured.post("/api/auth/logout")
    assert auth.user_for(token) is None
    secured.cookies.set(auth.COOKIE, token)  # replaying the old cookie doesn't work
    assert secured.get("/api/vendors").status_code == 401


def test_expired_session_is_rejected(secured):
    _login(secured)
    with sqlite3.connect(auth.db_path()) as c:
        c.execute("UPDATE sessions SET expires_at = ?", (time.time() - 1,))
    assert secured.get("/api/vendors").status_code == 401


def test_database_never_holds_secrets_in_plain_text(secured):
    _login(secured)
    token = secured.cookies.get(auth.COOKIE)
    raw = auth.db_path().read_bytes()
    assert PW.encode() not in raw and token.encode() not in raw
    with sqlite3.connect(auth.db_path()) as c:
        assert c.execute("SELECT pw_hash FROM users").fetchone()[0].startswith("scrypt$")


def test_forged_cookie_is_rejected(secured):
    secured.cookies.set(auth.COOKIE, "made-up-token")
    assert secured.get("/api/vendors").status_code == 401


def test_service_token_for_band_agents(secured, monkeypatch):
    monkeypatch.setenv("API_SERVICE_TOKEN", "s3rvice-token-for-band")
    assert secured.get("/api/vendors", headers={"Authorization": "Bearer s3rvice-token-for-band"}).status_code == 200
    assert secured.get("/api/vendors", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_service_token_unset_means_no_bypass(secured, monkeypatch):
    monkeypatch.delenv("API_SERVICE_TOKEN", raising=False)
    assert secured.get("/api/vendors", headers={"Authorization": "Bearer "}).status_code == 401


def test_logged_outcome_records_who_signed_in(secured, monkeypatch):
    monkeypatch.setattr(main.memory, "retain_episode", lambda *a, **k: None)
    _login(secured)
    r = secured.post("/api/outcome", json={"vendor_id": "v05", "tactic_used": "multi_year", "ask_discount": 0.15,
                                           "final_discount": 0.13, "outcome": "won", "notes": "signed"})
    assert r.status_code == 200 and main.HISTORY[-1]["buyer"] == "Ranjith Kumar G"


@pytest.mark.parametrize("user,pw,msg", [("ab", PW, "username"), ("bad name!", PW, "username"), ("nandhini", "short", "at least")])
def test_create_user_validation(api, user, pw, msg):
    with pytest.raises(ValueError, match=msg):
        auth.create_user(user, pw)


def test_duplicate_user_rejected(api):
    auth.create_user("nandhini", PW)
    with pytest.raises(ValueError, match="already exists"):
        auth.create_user("Nandhini", PW)


def test_security_headers(api):
    h = api.get("/api/auth/me").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"
