from urllib.parse import parse_qs, urlparse

import httpx
from cryptography.hazmat.primitives.asymmetric import rsa

from .conftest import APPLE_AUD, GOOGLE_WEB, PASSWORD, Harness, auth

NATIVE = {"X-Client": "native"}


def test_google_token_new_user_needs_invite(h, client):
    tok = h.idp.token(email="newbie@example.com")
    r = client.post("/api/auth/google/token", json={"id_token": tok}, headers=NATIVE)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "invite_required" and r.json()["error"]["field"] == "invite_code"
    code = h.invite()
    r = client.post("/api/auth/google/token", json={"id_token": tok, "invite_code": code}, headers=NATIVE)
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["providers"] == ["google"] and u["email_verified"] is True and "refresh_token" in r.json()
    # second sign-in matches by sub, no invite needed
    again = client.post("/api/auth/google/token", json={"id_token": h.idp.token(email="newbie@example.com")},
                        headers=NATIVE)
    assert again.status_code == 200 and again.json()["user"]["id"] == u["id"]


def test_google_token_rejections(h, client):
    code = h.invite()
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cases = {
        "wrong_aud": h.idp.token(aud="someone-else.apps.googleusercontent.com"),
        "expired": h.idp.token(exp_in=-3600),
        "bad_sig": h.idp.token(key=other),
        "wrong_iss": h.idp.token(iss="https://evil.example"),
    }
    for name, tok in cases.items():
        r = client.post("/api/auth/google/token", json={"id_token": tok, "invite_code": code}, headers=NATIVE)
        assert r.status_code == 401, name
        assert r.json()["error"]["code"] == "unauthenticated"
    # web client id is also an accepted audience
    ok = client.post("/api/auth/google/token", json={"id_token": h.idp.token(aud=GOOGLE_WEB), "invite_code": code},
                     headers=NATIVE)
    assert ok.status_code == 200


def test_google_links_existing_verified_password_account(h, client, alice):
    client.post("/api/auth/verify-email", json={"token": h.mailer.token_for("alice@example.com", "verify")})
    r = client.post("/api/auth/google/token", json={"id_token": h.idp.token(email="alice@example.com", sub="g-alice")},
                    headers=NATIVE)
    assert r.status_code == 200 and r.json()["user"]["id"] == alice["user"]["id"]
    assert r.json()["user"]["providers"] == ["password", "google"]
    # password still works for a verified account
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 200


def test_google_link_takes_over_unverified_squatter(h, client, alice):
    """An unverified pre-registration of the address loses its password and sessions on verified social link."""
    r = client.post("/api/auth/google/token", json={"id_token": h.idp.token(email="alice@example.com", sub="g-real")},
                    headers=NATIVE)
    assert r.status_code == 200 and r.json()["user"]["providers"] == ["google"]
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 401
    assert client.get("/api/auth/me", headers=auth(alice["access_token"])).status_code == 401


def test_unverified_provider_email_does_not_link(h, client, alice):
    tok = h.idp.token(email="alice@example.com", sub="g-x", email_verified=False)
    r = client.post("/api/auth/google/token", json={"id_token": tok, "invite_code": h.invite()}, headers=NATIVE)
    assert r.status_code == 400


def test_apple_token(h, client):
    iss = "https://appleid.apple.com"
    tok = h.idp.token(iss=iss, aud=APPLE_AUD, sub="a-1", email="abc123@privaterelay.appleid.com",
                      email_verified="true")
    assert client.post("/api/auth/apple/token", json={"id_token": tok}).status_code == 403
    r = client.post("/api/auth/apple/token", json={"id_token": tok, "invite_code": h.invite(), "name": "Ann"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["display_name"] == "Ann" and r.json()["user"]["providers"] == ["apple"]
    assert "refresh_token" not in r.json() and client.cookies.get("lvs_csrf")   # web: cookie mode
    # name is stored on first login only
    r2 = client.post("/api/auth/apple/token", json={"id_token": tok, "name": "Changed"})
    assert r2.json()["user"]["display_name"] == "Ann"
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    for bad in (h.idp.token(iss=iss, aud="com.other", sub="a-1"), h.idp.token(iss=iss, aud=APPLE_AUD, exp_in=-100),
                h.idp.token(iss=iss, aud=APPLE_AUD, sub="a-1", key=other),
                h.idp.token(iss="https://accounts.google.com", aud=APPLE_AUD)):
        assert client.post("/api/auth/apple/token", json={"id_token": bad}).status_code == 401


def test_jwks_cached(h, client):
    code = h.invite()
    for i in range(3):
        client.post("/api/auth/google/token", json={"id_token": h.idp.token(sub=f"s{i}", email=f"e{i}@x.com"),
                                                    "invite_code": code}, headers=NATIVE)
    assert h.idp.fetches == 1


def test_admin_email_social_bootstrap(h, client):
    r = client.post("/api/auth/google/token", json={"id_token": h.idp.token(email="admin@example.com", sub="g-adm")},
                    headers=NATIVE)
    assert r.status_code == 200 and r.json()["user"]["role"] == "admin"


def test_google_web_flow(tmp_path):
    seen = {}

    def handler(request: httpx.Request):
        seen["body"] = parse_qs(request.content.decode())
        return httpx.Response(200, json={"id_token": seen["mint"](seen["nonce"])})

    h = Harness(tmp_path, google_transport=httpx.MockTransport(handler))
    seen["mint"] = lambda nonce: h.idp.token(aud=GOOGLE_WEB, email="webby@example.com", sub="g-web", nonce=nonce)
    code = h.invite()
    with h.client(follow_redirects=False) as c:
        r = c.get("/api/auth/google/start", params={"redirect": "/people/3", "invite": code})
        assert r.status_code == 302
        loc = urlparse(r.headers["location"])
        q = parse_qs(loc.query)
        assert loc.netloc == "accounts.google.com" and q["code_challenge_method"] == ["S256"]
        assert q["redirect_uri"] == ["https://app.example/api/auth/google/callback"]
        state, seen["nonce"] = q["state"][0], q["nonce"][0]
        # wrong state → error fragment
        bad = c.get("/api/auth/google/callback", params={"code": "c", "state": "forged"})
        assert bad.status_code == 302 and bad.headers["location"].endswith("#error=invalid_state")
        r = c.get("/api/auth/google/start", params={"redirect": "/people/3", "invite": code})
        q = parse_qs(urlparse(r.headers["location"]).query)
        state, seen["nonce"] = q["state"][0], q["nonce"][0]
        cb = c.get("/api/auth/google/callback", params={"code": "auth-code", "state": state})
        assert cb.status_code == 302
        assert cb.headers["location"] == "https://app.example/auth/complete?redirect=%2Fpeople%2F3#ok"
        assert "code_verifier" in seen["body"] and seen["body"]["code"] == ["auth-code"]
        assert c.cookies.get("lvs_csrf")
        # the refresh cookie works (web refresh with CSRF)
        rr = c.post("/api/auth/refresh", headers={"X-CSRF-Token": c.cookies.get("lvs_csrf")})
        assert rr.status_code == 200 and rr.json()["user"]["email"] == "webby@example.com"
        # state is single use
        replay = c.get("/api/auth/google/callback", params={"code": "auth-code", "state": state})
        assert "#error=" in replay.headers["location"]
        # open-redirects are neutralised
        r = c.get("/api/auth/google/start", params={"redirect": "//evil.example"})
        assert r.status_code == 302


def test_google_web_flow_invite_required(tmp_path):
    holder = {}
    h = Harness(tmp_path, google_transport=httpx.MockTransport(
        lambda req: httpx.Response(200, json={"id_token": holder["tok"]})))
    with h.client(follow_redirects=False) as c:
        r = c.get("/api/auth/google/start")
        q = parse_qs(urlparse(r.headers["location"]).query)
        holder["tok"] = h.idp.token(aud=GOOGLE_WEB, email="x@example.com", nonce=q["nonce"][0])
        cb = c.get("/api/auth/google/callback", params={"code": "c", "state": q["state"][0]})
        assert cb.headers["location"].endswith("#error=invite_required")
