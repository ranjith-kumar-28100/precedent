import sqlite3
import time

import jwt
import pytest

from app import auth

PW = "correct horse battery"
pytestmark = pytest.mark.filterwarnings("ignore:The HMAC key")  # HS512 forgery test uses a short key on purpose
SECRET = "test-secret-that-is-long-enough-1234567890"


@pytest.fixture
def secured(api, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "1")
    monkeypatch.setenv("JWT_SECRET", SECRET)
    auth.create_user("ranjith", PW, "Ranjith Kumar G")
    return api


def _token(api, user="ranjith", pw=PW):
    return api.post("/api/auth/token", data={"username": user, "password": pw})


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def test_password_flow_issues_a_bearer_jwt(secured):
    r = _token(secured)
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer" and body["expires_in"] == 30 * 60
    claims = jwt.decode(body["access_token"], SECRET, algorithms=["HS256"], audience="precedent-api", issuer="precedent")
    assert claims["sub"] == "ranjith" and claims["name"] == "Ranjith Kumar G" and claims["jti"]
    assert claims["exp"] - claims["iat"] == 30 * 60
    assert "set-cookie" not in r.headers  # API clients get a token, not a browser session


def test_bearer_token_opens_the_api(secured):
    t = _token(secured).json()["access_token"]
    assert secured.get("/api/vendors", headers=_hdr(t)).status_code == 200
    assert secured.get("/api/auth/me", headers=_hdr(t)).json()["user"]["username"] == "ranjith"


def test_bad_credentials_are_rejected_like_the_login(secured):
    r = _token(secured, pw="wrong-password-1")
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"
    assert r.json() == {"detail": "Invalid username or password."}


def test_token_endpoint_shares_the_lockout(secured):
    for _ in range(5):
        _token(secured, pw="wrong-password-1")
    assert _token(secured).status_code == 429


def _forge(**over):
    now = int(time.time())
    claims = {"sub": "ranjith", "name": "x", "iss": "precedent", "aud": "precedent-api", "iat": now, "nbf": now,
              "exp": now + 600, "jti": "j1"} | over
    return claims


@pytest.mark.parametrize("token", [
    lambda: jwt.encode(_forge(exp=int(time.time()) - 5), SECRET, algorithm="HS256"),          # expired
    lambda: jwt.encode(_forge(), "some-other-secret-that-is-long-enough-123", algorithm="HS256"),  # wrong key
    lambda: jwt.encode(_forge(aud="someone-else"), SECRET, algorithm="HS256"),                 # wrong audience
    lambda: jwt.encode(_forge(iss="evil"), SECRET, algorithm="HS256"),                         # wrong issuer
    lambda: jwt.encode({k: v for k, v in _forge().items() if k != "jti"}, SECRET, algorithm="HS256"),  # missing claim
    lambda: jwt.encode(_forge(), SECRET, algorithm="HS512"),                                   # algorithm swapped
    lambda: jwt.encode(_forge(), None, algorithm="none"),                                      # unsigned
    lambda: jwt.encode(_forge(sub="ghost"), SECRET, algorithm="HS256"),                        # user doesn't exist
    lambda: "not.a.jwt",
])
def test_invalid_tokens_are_rejected(secured, token):
    r = secured.get("/api/vendors", headers=_hdr(token()))
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"


def test_tampered_payload_is_rejected(secured):
    t = _token(secured).json()["access_token"]
    head, body, sig = t.split(".")
    other = jwt.encode(_forge(sub="admin"), "x" * 40, algorithm="HS256").split(".")[1]
    assert secured.get("/api/vendors", headers=_hdr(f"{head}.{other}.{sig}")).status_code == 401


def test_logout_revokes_the_token(secured):
    t = _token(secured).json()["access_token"]
    secured.post("/api/auth/logout", headers=_hdr(t))
    assert secured.get("/api/vendors", headers=_hdr(t)).status_code == 401
    with sqlite3.connect(auth.db_path()) as c:
        assert c.execute("SELECT COUNT(*) FROM revoked_tokens").fetchone()[0] == 1


def test_deleting_a_user_kills_their_tokens(secured):
    t = _token(secured).json()["access_token"]
    with sqlite3.connect(auth.db_path()) as c:
        c.execute("DELETE FROM users WHERE username = 'ranjith'")
    assert secured.get("/api/vendors", headers=_hdr(t)).status_code == 401


def test_short_jwt_secret_is_refused(secured, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "too-short")
    with pytest.raises(RuntimeError, match="at least 32"):
        auth.issue_jwt({"username": "ranjith", "display_name": "R"})


def test_token_lifetime_is_configurable(secured, monkeypatch):
    monkeypatch.setenv("JWT_MINUTES", "5")
    assert _token(secured).json()["expires_in"] == 300


def test_openapi_declares_the_oauth2_scheme(api):
    spec = api.get("/openapi.json").json()
    flow = spec["components"]["securitySchemes"]["OAuth2PasswordBearer"]["flows"]["password"]
    assert flow["tokenUrl"] == "/api/auth/token"
