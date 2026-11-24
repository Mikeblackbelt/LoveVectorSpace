"""Security review fixes: squatter takeover, management scopes, re-auth, deletion order, limits, forged tokens."""
import hashlib
import json
import logging
import threading
import time

import jwt as pyjwt
import pytest

from analyzer.accounts.oidc import JwksCache
from analyzer.accounts.passwords import Passwords
from analyzer.accounts.ratelimit import SlidingWindow
from analyzer.accounts.userdb import UserGone

from .conftest import PASSWORD, Harness, auth

NATIVE = {"X-Client": "native"}


def _squat(h, c, email):
    """A squatter registers someone else's address (never verified) and plants data + long-lived tokens."""
    res = h.signup(c, email)
    a = auth(res["access_token"])
    c.post("/api/people", json={"pseudonym": "SQUATTER_DATA", "mode": "potential"}, headers=a)
    api = c.post("/api/tokens", json={"kind": "api"}, headers=a).json()["token"]
    ext = c.post("/api/tokens", json={"kind": "extension"}, headers=a).json()["token"]
    return res, api, ext


def _assert_squatter_locked_out(h, c, res, api, ext, email):
    assert c.get("/api/people", headers=auth(api)).status_code == 401
    assert c.get("/api/ext/people", headers=auth(ext)).status_code == 401
    assert c.post("/api/tokens", json={"kind": "api"}, headers=auth(api)).status_code == 401
    assert c.get("/api/auth/me", headers=auth(res["access_token"])).status_code == 401
    assert c.post("/api/auth/refresh", json={"refresh_token": res["refresh_token"]}, headers=NATIVE).status_code == 401
    assert c.post("/api/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401
    mcp = c.post("/mcp", headers={**auth(api), "Accept": "application/json, text/event-stream"},
                 json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    assert mcp.status_code == 401


def test_social_takeover_revokes_squatter_tokens_and_wipes_data(h, client):
    res, api, ext = _squat(h, client, "victim@example.com")
    old_db = h.accounts.userdbs.path(res["user"]["id"]).read_bytes()
    r = client.post("/api/auth/google/token", json={"id_token": h.idp.token(email="victim@example.com", sub="g-v")},
                    headers=NATIVE)
    assert r.status_code == 200
    me = r.json()["user"]
    assert me["id"] == res["user"]["id"] and me["providers"] == ["google"] and me["role"] == "user"
    _assert_squatter_locked_out(h, client, res, api, ext, "victim@example.com")
    v = auth(r.json()["access_token"])
    assert client.get("/api/people", headers=v).json() == []                       # squatter's data is gone
    assert client.get("/api/tokens", headers=v).json() and all(
        t["revoked_at"] for t in client.get("/api/tokens", headers=v).json())
    assert h.accounts.userdbs.path(me["id"]).read_bytes() != old_db                  # fresh DB (new key)
    # the squatter cannot reclaim: reset mail goes to the real owner, and no credential of theirs works
    client.post("/api/auth/password/forgot", json={"email": "victim@example.com"})
    assert all(m["to"] == "victim@example.com" for m in h.mailer.sent)


def test_reset_takeover_of_unverified_account(h, client):
    res, api, ext = _squat(h, client, "victim2@example.com")
    client.post("/api/auth/password/forgot", json={"email": "victim2@example.com"})
    token = h.mailer.token_for("victim2@example.com", "reset")
    assert client.post("/api/auth/password/reset", json={"token": token, "new_password": "Owner-Reclaims-77"}).status_code == 204
    _assert_squatter_locked_out(h, client, res, api, ext, "victim2@example.com")
    r = client.post("/api/auth/login", json={"email": "victim2@example.com", "password": "Owner-Reclaims-77"},
                    headers=NATIVE)
    assert r.status_code == 200 and r.json()["user"]["email_verified"] is True
    assert client.get("/api/people", headers=auth(r.json()["access_token"])).json() == []


def test_reset_revokes_api_tokens_of_verified_account(h, client, alice):
    client.post("/api/auth/verify-email", json={"token": h.mailer.token_for("alice@example.com", "verify")})
    a = auth(alice["access_token"])
    client.post("/api/people", json={"pseudonym": "Keep", "mode": "potential"}, headers=a)
    api = client.post("/api/tokens", json={"kind": "api"}, headers=a).json()["token"]
    ext = client.post("/api/tokens", json={"kind": "extension"}, headers=a).json()["token"]
    client.post("/api/auth/password/forgot", json={"email": "alice@example.com"})
    token = h.mailer.token_for("alice@example.com", "reset")
    assert client.post("/api/auth/password/reset", json={"token": token, "new_password": "Owner-Reclaims-77"}).status_code == 204
    assert client.get("/api/people", headers=auth(api)).status_code == 401
    assert client.get("/api/ext/people", headers=auth(ext)).status_code == 401
    r = client.post("/api/auth/login", json={"email": "alice@example.com", "password": "Owner-Reclaims-77"})
    assert [p["pseudonym"] for p in client.get("/api/people", headers=auth(r.json()["access_token"])).json()] == ["Keep"]


MANAGEMENT = [("POST", "/api/tokens", {"json": {"kind": "api"}}), ("DELETE", "/api/tokens/x", {}),
              ("GET", "/api/auth/sessions", {}), ("DELETE", "/api/auth/sessions/x", {}),
              ("POST", "/api/auth/password/change", {"json": {"current_password": PASSWORD, "new_password": "Xyz-Long-Pass-91"}}),
              ("DELETE", "/api/account", {"json": {"confirm": "DELETE MY ACCOUNT", "password": PASSWORD}}),
              ("POST", "/api/account/export", {"json": {"include_messages": True}}),
              ("GET", "/api/invites", {}), ("POST", "/api/invites", {"json": {}}), ("DELETE", "/api/invites/x", {})]


def test_management_routes_need_an_interactive_session(h, client, alice):
    h.accounts.users.update(alice["user"]["id"], role="admin")
    a = auth(alice["access_token"])
    api = client.post("/api/tokens", json={"kind": "api"}, headers=a).json()["token"]
    ext = client.post("/api/tokens", json={"kind": "extension"}, headers=a).json()["token"]
    for method, path, kw in MANAGEMENT:
        for tok in (api, ext):
            r = client.request(method, path, headers=auth(tok), **kw)
            assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", (method, path, r.status_code)
    assert h.accounts.users.get(alice["user"]["id"]) is not None    # the DELETE did not go through
    assert client.get("/api/tokens", headers=auth(api)).status_code == 200   # listing stays available


def test_setting_first_password_needs_recent_sign_in(h, client):
    r = client.post("/api/auth/google/token", json={"id_token": h.idp.token(email="soc@example.com", sub="g-s"),
                                                    "invite_code": h.invite()}, headers=NATIVE)
    at = r.json()["access_token"]
    sid = pyjwt.decode(at, options={"verify_signature": False})["sid"]
    h.accounts.db.x("UPDATE refresh_tokens SET created_at='2020-01-01T00:00:00Z' WHERE family_id=?", (sid,))
    stale = client.post("/api/auth/password/change", json={"new_password": "First-Password-42"}, headers=auth(at))
    assert stale.status_code == 403 and stale.json()["error"]["code"] == "reauth_required"
    fresh = client.post("/api/auth/google/token", json={"id_token": h.idp.token(email="soc@example.com", sub="g-s")},
                        headers=NATIVE).json()["access_token"]
    assert client.post("/api/auth/password/change", json={"new_password": "First-Password-42"},
                       headers=auth(fresh)).status_code == 204


def test_admin_email_password_signup_needs_invite(h, client):
    r = client.post("/api/auth/signup", json={"email": "admin@example.com", "password": PASSWORD})
    assert r.status_code == 403 and r.json()["error"]["code"] == "invite_required"


def test_deletion_revokes_first_then_refuses_db(h, client, alice):
    uid = alice["user"]["id"]
    a = auth(alice["access_token"])
    api = client.post("/api/tokens", json={"kind": "api"}, headers=a).json()["token"]
    client.get("/api/people", headers=a)
    seen = {}
    real_delete = h.accounts.userdbs.delete

    def probe(user_id, **kw):     # runs mid-deletion: credentials must already be dead
        for tok in (alice["access_token"], api):
            try:
                h.accounts.authenticate_bearer(tok)
                seen[tok[:4]] = "accepted"
            except Exception as e:
                seen[tok[:4]] = type(e).__name__
        try:
            h.accounts.userdbs.acquire(user_id)
            seen["acquire"] = "opened"
        except UserGone:
            seen["acquire"] = "refused"
        return real_delete(user_id, **kw)

    h.accounts.userdbs.delete = probe
    r = client.request("DELETE", "/api/account", json={"confirm": "DELETE MY ACCOUNT", "password": PASSWORD}, headers=a)
    assert r.status_code == 204
    assert seen == {"eyJh": "AccountError", "lvsa": "AccountError", "acquire": "refused"}
    assert not h.accounts.userdbs.path(uid).exists() and h.accounts.users.get_any(uid) is None


def test_concurrent_request_during_deletion(h, client, alice):
    a = auth(alice["access_token"])
    client.post("/api/people", json={"pseudonym": "S", "mode": "potential"}, headers=a)
    results = []

    def hammer():
        for _ in range(30):
            results.append(client.get("/api/people", headers=a).status_code)
    t = threading.Thread(target=hammer)
    t.start()
    r = client.request("DELETE", "/api/account", json={"confirm": "DELETE MY ACCOUNT", "password": PASSWORD}, headers=a)
    t.join(60)
    assert r.status_code == 204
    assert set(results) <= {200, 401, 503} and results[-1] == 401
    assert not h.accounts.userdbs.path(alice["user"]["id"]).exists()


def test_signup_checks_invite_before_hashing_and_ip_limit(tmp_path):
    h = Harness(tmp_path, auth_ip_limit=3)
    calls = []
    real_hash = h.accounts.passwords.hash
    h.accounts.passwords.hash = lambda pw: calls.append(1) or real_hash(pw)
    with h.client() as c:
        for i in range(3):
            r = c.post("/api/auth/signup", json={"email": f"x{i}@example.com", "password": PASSWORD, "invite_code": "bad"})
            assert r.status_code == 403
        assert calls == []                       # no argon2 work for invalid invites
        r = c.post("/api/auth/signup", json={"email": "x9@example.com", "password": PASSWORD, "invite_code": h.invite()})
        assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


def test_login_per_ip_limit_counts_failures_only(tmp_path):
    h = Harness(tmp_path, auth_ip_limit=3)
    with h.client() as c:
        h.signup(c, "alice@example.com")
        for _ in range(5):   # successes are refunded
            assert c.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 200
        for i in range(3):   # failures across different emails from one IP
            assert c.post("/api/auth/login", json={"email": f"n{i}@example.com", "password": "nope-nope-nope"}).status_code == 401
        assert c.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 429


def test_limiter_atomic_and_swept():
    now = [0.0]
    lim = SlidingWindow(2, 10, clock=lambda: now[0], sweep_every_s=1)
    assert lim.try_hit("a") == 0 and lim.try_hit("a") == 0 and lim.try_hit("a") > 0
    lim.refund("a")
    assert lim.try_hit("a") == 0
    for i in range(100):
        lim.try_hit(f"k{i}")
    now[0] = 100.0
    lim.try_hit("z")
    assert lim.key_count() == 1


def test_forged_access_tokens(h, client, alice):
    uid = alice["user"]["id"]
    sid = pyjwt.decode(alice["access_token"], options={"verify_signature": False})["sid"]
    secret = h.settings.jwt_secret
    base = {"sub": uid, "role": "admin", "iat": int(time.time()), "exp": int(time.time()) + 600}
    none_tok = pyjwt.encode({**base, "typ": "access", "sid": sid}, None, algorithm="none")
    wrong_typ = pyjwt.encode({**base, "typ": "refresh", "sid": sid}, secret, algorithm="HS256")
    no_sid = pyjwt.encode({**base, "typ": "access"}, secret, algorithm="HS256")
    bogus_sid = pyjwt.encode({**base, "typ": "access", "sid": "f" * 32}, secret, algorithm="HS256")
    for tok in (none_tok, wrong_typ, no_sid, bogus_sid):
        assert client.get("/api/auth/me", headers=auth(tok)).status_code == 401
    assert client.get("/api/events", params={"access_token": no_sid}).status_code == 401


def test_grace_window_does_not_survive_family_revoke(h, client, alice):
    rt1 = alice["refresh_token"]
    r = client.post("/api/auth/refresh", json={"refresh_token": rt1}, headers=NATIVE).json()
    client.post("/api/auth/logout", json={"refresh_token": r["refresh_token"]},
                headers={**auth(r["access_token"]), **NATIVE})
    assert client.post("/api/auth/refresh", json={"refresh_token": rt1}, headers=NATIVE).status_code == 401


def test_streaming_body_overrun_is_413(tmp_path):
    h = Harness(tmp_path, max_ingest_bytes=2000)
    with h.client() as c:
        a = auth(h.signup(c, "alice@example.com")["access_token"])

        def chunks():
            for _ in range(10):
                yield b"x" * 1000
        r = c.post("/api/ingest", content=chunks(), headers={**a, "Content-Type": "application/json"})
        assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"
        pid = c.post("/api/people", json={"pseudonym": "S", "mode": "potential"}, headers=a).json()["id"]
        r = c.post(f"/api/people/{pid}/imports/messages", content=(b"x" * 300_000 for _ in range(8)),
                   headers={**a, "Content-Type": "application/json"})
        assert r.status_code == 413


def test_messages_import_bounds(h, client, alice):
    a = auth(alice["access_token"])
    pid = client.post("/api/people", json={"pseudonym": "S", "mode": "potential"}, headers=a).json()["id"]
    m = {"ts_utc": "2026-11-20T18:00:00Z", "ts_precision": "minute", "role": "them", "text": "x"}
    long = client.post(f"/api/people/{pid}/imports/messages", headers=a,
                       json={"source": "android_sms", "tz": "UTC", "messages": [{**m, "text": "y" * 4001}]})
    assert long.status_code == 422
    many = client.post(f"/api/people/{pid}/imports/messages", headers=a,
                       json={"source": "android_sms", "tz": "UTC", "messages": [{**m, "text": ""}] * 10_001})
    assert many.status_code == 422


def test_interaction_patch_whitelist(h, client, alice):
    a = auth(alice["access_token"])
    pid = client.post("/api/people", json={"pseudonym": "S", "mode": "potential"}, headers=a).json()["id"]
    iid = client.post(f"/api/people/{pid}/interactions", json={"fields": {"ts": "2026-11-20T18:00:00Z"}, "notes": ""},
                      headers=a).json()["id"]
    assert client.patch(f"/api/interactions/{iid}", json={"person_id": 99}, headers=a).status_code == 422
    assert client.patch(f"/api/interactions/{iid}", json={"fields": {f"k{i}": 1 for i in range(41)}},
                        headers=a).status_code == 422
    assert client.patch(f"/api/interactions/{iid}", json={"notes": "ok"}, headers=a).json()["notes"] == "ok"


def test_redirect_rejects_control_characters(tmp_path):
    h = Harness(tmp_path)
    with h.client(follow_redirects=False) as c:
        for bad in ("/x\r\nSet-Cookie: a=b", "/x\tq", "//evil.example", "/\\evil", "https://evil.example", "/x\x7f"):
            c.get("/api/auth/google/start", params={"redirect": bad})
        stored = [v[1]["redirect"] for v in h.accounts.oauth_states._items.values()]
        assert stored == ["/people"] * 6
        c.get("/api/auth/google/start", params={"redirect": "/people/3?tab=chat"})
        assert "/people/3?tab=chat" in [v[1]["redirect"] for v in h.accounts.oauth_states._items.values()]


def test_console_mailer_refused_in_production(tmp_path):
    from analyzer.accounts.service import AccountService

    from .conftest import make_settings
    from .fakes import FakeFactory
    with pytest.raises(RuntimeError, match="MAIL_DEV_ALLOW"):
        AccountService(make_settings(tmp_path / "a"), FakeFactory(), None)
    ok = AccountService(make_settings(tmp_path / "b", mail_dev_allow=True), FakeFactory(), None)
    ok.close()


def test_native_nonce(tmp_path):
    h = Harness(tmp_path)
    with h.client() as c:
        code = h.invite()
        tok = h.idp.token(email="n@example.com", sub="g-n", nonce="raw-nonce-1")
        assert c.post("/api/auth/google/token", json={"id_token": tok, "invite_code": code, "nonce": "other"},
                      headers=NATIVE).status_code == 401
        assert c.post("/api/auth/google/token", json={"id_token": tok, "invite_code": code, "nonce": "raw-nonce-1"},
                      headers=NATIVE).status_code == 200
        hashed = h.idp.token(iss="https://appleid.apple.com", aud="app.lovevectorspace.demo", sub="a-n",
                             email="n@example.com", nonce=hashlib.sha256(b"apple-raw").hexdigest())
        assert c.post("/api/auth/apple/token", json={"id_token": hashed, "nonce": "apple-raw"}).status_code == 200
    h2 = Harness(tmp_path / "req", native_nonce_required=True)
    with h2.client() as c:
        r = c.post("/api/auth/google/token", json={"id_token": h2.idp.token(), "invite_code": h2.invite()},
                   headers=NATIVE)
        assert r.status_code == 400 and r.json()["error"]["field"] == "nonce"


def test_login_rehashes_outdated_argon2_params(h, client, alice):
    uid = alice["user"]["id"]
    old = Passwords(time_cost=2, memory_cost=2048, parallelism=1).hash(PASSWORD)
    h.accounts.users.update(uid, password_hash=old)
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 200
    assert h.accounts.users.get(uid).password_hash != old
    assert not h.accounts.passwords.needs_rehash(h.accounts.users.get(uid).password_hash)


def test_request_log_redacts_codes_and_ids(h, client, alice, caplog):
    caplog.set_level(logging.INFO)
    h.accounts.users.update(alice["user"]["id"], role="admin")
    a = auth(alice["access_token"])
    code = client.post("/api/invites", json={}, headers=a).json()["code"]
    client.delete(f"/api/invites/{code}", headers=a)
    client.delete("/api/invites/unmatched-code", headers=a)
    text = "\n".join(r.getMessage() for r in caplog.records if r.name == "analyzer.web.access")
    assert code not in text and "unmatched-code" not in text and "/api/invites/{code}" in text


def test_jwks_single_flight():
    calls = []

    def slow_fetch(url):
        calls.append(1)
        time.sleep(0.2)
        return {"keys": []}
    cache = JwksCache("https://x", slow_fetch)
    errs = []

    def get():
        try:
            cache.key("k")
        except Exception as e:
            errs.append(type(e).__name__)
    ts = [threading.Thread(target=get) for _ in range(5)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(calls) == 1 and errs == ["TokenInvalid"] * 5


def test_master_key_min_length(monkeypatch):
    from pydantic import ValidationError

    from analyzer.web.settings import AppSettings
    with pytest.raises(ValidationError):
        AppSettings(_env_file=None, master_key="x" * 31, jwt_secret="j" * 48)
    assert json.dumps(AppSettings(_env_file=None, master_key="x" * 32, jwt_secret="j" * 48).user_db_cache_size) == "256"


def test_spa_security_headers(tmp_path):
    h = Harness(tmp_path)
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html>")
    (dist / "assets" / "a.js").write_text("1")
    with h.client() as c:
        for path in ("/", "/people/1", "/assets/a.js"):
            r = c.get(path)
            csp = r.headers["content-security-policy"]
            assert "frame-ancestors 'none'" in csp and "connect-src 'self' https://app.example" in csp
            assert "script-src 'self' https://appleid.cdn-apple.com" in csp
            assert r.headers["x-content-type-options"] == "nosniff" and r.headers["referrer-policy"] == "no-referrer"


def test_native_app_origins_allowed_with_bearer(h, client, alice):
    for origin in ("capacitor://localhost", "https://localhost"):
        r = client.get("/api/people", headers={"Origin": origin, **auth(alice["access_token"])})
        assert r.status_code == 200 and r.headers["access-control-allow-origin"] == origin
