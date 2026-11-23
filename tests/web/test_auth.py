import pytest

from analyzer.accounts import passwords

from .conftest import PASSWORD, Harness, auth


def test_signup_requires_invite(h, client):
    r = client.post("/api/auth/signup", json={"email": "x@example.com", "password": PASSWORD})
    assert r.status_code == 403
    assert r.json()["error"] == {"code": "invite_required", "message": r.json()["error"]["message"],
                                 "field": "invite_code"}
    r = client.post("/api/auth/signup", json={"email": "x@example.com", "password": PASSWORD, "invite_code": "nope"})
    assert r.status_code == 403


def test_signup_with_invite_returns_auth_result(h, client):
    res = h.signup(client, "Alice@Example.com", display_name="Al")
    assert set(res) == {"access_token", "expires_in", "refresh_token", "user"}
    assert res["expires_in"] == 900
    u = res["user"]
    assert u["email"] == "alice@example.com" and u["email_verified"] is False and u["role"] == "user"
    assert u["providers"] == ["password"] and u["display_name"] == "Al" and u["created_at"].endswith("Z")
    assert h.mailer.sent and "/auth/verify#token=" in h.mailer.sent[0]["link"]
    me = client.get("/api/auth/me", headers=auth(res["access_token"]))
    assert me.status_code == 200 and me.json()["id"] == u["id"]
    # the per-user encrypted DB exists
    assert h.accounts.userdbs.path(u["id"]).exists()


def test_invite_is_single_use_and_email_bound(h, client):
    code = h.invite()
    ok = client.post("/api/auth/signup", json={"email": "a1@example.com", "password": PASSWORD, "invite_code": code})
    assert ok.status_code == 201
    again = client.post("/api/auth/signup", json={"email": "a2@example.com", "password": PASSWORD, "invite_code": code})
    assert again.status_code == 403
    bound = h.invite(email="only@example.com")
    r = client.post("/api/auth/signup", json={"email": "other@example.com", "password": PASSWORD, "invite_code": bound})
    assert r.status_code == 403


def test_signup_password_policy(h, client):
    code = h.invite()
    for bad in ("short", "password1234", "Password123456!", "aaaaaaaaaaaaaaaa"):
        r = client.post("/api/auth/signup", json={"email": "p@example.com", "password": bad, "invite_code": code})
        assert r.status_code == 422, bad
        assert r.json()["error"]["field"] == "password"
    assert len(passwords.common_passwords()) > 9000


def test_duplicate_email_conflict(h, client, alice):
    code = h.invite()
    r = client.post("/api/auth/signup", json={"email": "alice@example.com", "password": PASSWORD, "invite_code": code})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_login_and_generic_errors(h, client, alice):
    r = client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD},
                    headers={"X-Client": "native"})
    assert r.status_code == 200 and r.json()["user"]["email"] == "alice@example.com"
    wrong = client.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrong-password-123"})
    unknown = client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "wrong-password-123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_login_rate_limit_per_email_ip(h, client, alice):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "bad-bad-bad-1"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited" and int(r.headers["Retry-After"]) > 0
    # a different email from the same IP is not blocked
    assert client.post("/api/auth/login", json={"email": "bob@example.com", "password": "x" * 12}).status_code == 401


def test_web_login_sets_cookies_not_body_token(h, client, alice):
    r = client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    assert r.status_code == 200 and "refresh_token" not in r.json()
    cookies = r.headers.get_list("set-cookie")
    rt = next(c for c in cookies if c.startswith("lvs_rt="))
    csrf = next(c for c in cookies if c.startswith("lvs_csrf="))
    low = rt.lower()
    assert "httponly" in low and "secure" in low and "samesite=lax" in low and "path=/api/auth" in low
    assert "httponly" not in csrf.lower() and "secure" in csrf.lower()


def test_native_refresh_rotation_and_reuse_revokes_family(h, client, alice):
    rt1 = alice["refresh_token"]
    r = client.post("/api/auth/refresh", json={"refresh_token": rt1}, headers={"X-Client": "native"})
    assert r.status_code == 200
    rt2, at2 = r.json()["refresh_token"], r.json()["access_token"]
    assert rt2 != rt1
    assert client.get("/api/auth/me", headers=auth(at2)).status_code == 200
    # reuse of the old token → 401 and the whole family (incl. rt2 and its access token) is revoked
    assert client.post("/api/auth/refresh", json={"refresh_token": rt1}, headers={"X-Client": "native"}).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": rt2}, headers={"X-Client": "native"}).status_code == 401
    assert client.get("/api/auth/me", headers=auth(at2)).status_code == 401
    events = [e[1] for e in h.accounts.audit.events(alice["user"]["id"])]
    assert "refresh_reuse_family_revoked" in events


def test_web_refresh_needs_csrf_header(h, client, alice):
    r = client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    assert r.status_code == 200
    csrf = client.cookies.get("lvs_csrf")
    assert client.post("/api/auth/refresh").status_code == 403
    assert client.post("/api/auth/refresh", headers={"X-CSRF-Token": "wrong"}).status_code == 403
    ok = client.post("/api/auth/refresh", headers={"X-CSRF-Token": csrf})
    assert ok.status_code == 200 and "refresh_token" not in ok.json()


def test_bearer_writes_need_no_csrf(h, client, alice):
    r = client.post("/api/people", json={"pseudonym": "Sam", "mode": "potential"}, headers=auth(alice["access_token"]))
    assert r.status_code == 201


def test_logout_revokes_family(h, client, alice):
    at, rt = alice["access_token"], alice["refresh_token"]
    r = client.post("/api/auth/logout", json={"refresh_token": rt}, headers={**auth(at), "X-Client": "native"})
    assert r.status_code == 204
    assert client.post("/api/auth/refresh", json={"refresh_token": rt}, headers={"X-Client": "native"}).status_code == 401
    assert client.get("/api/auth/me", headers=auth(at)).status_code == 401
    assert client.post("/api/auth/logout").status_code == 401


def test_web_logout_clears_cookies(h, client, alice):
    r = client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    at = r.json()["access_token"]
    out = client.post("/api/auth/logout", headers=auth(at))
    assert out.status_code == 204
    assert any(c.startswith("lvs_rt=") and "max-age=0" in c.lower() for c in out.headers.get_list("set-cookie"))


def test_verify_email_single_use(h, client, alice):
    token = h.mailer.token_for("alice@example.com", "verify")
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 204
    me = client.get("/api/auth/me", headers=auth(alice["access_token"])).json()
    assert me["email_verified"] is True
    again = client.post("/api/auth/verify-email", json={"token": token})
    assert again.status_code == 400 and again.json()["error"]["field"] == "token"


def test_verify_resend_requires_auth(h, client, alice):
    assert client.post("/api/auth/verify-email/resend").status_code == 401
    n = len(h.mailer.sent)
    assert client.post("/api/auth/verify-email/resend", headers=auth(alice["access_token"])).status_code == 204
    assert len(h.mailer.sent) == n + 1


def test_forgot_always_204_and_reset_revokes_sessions(h, client, alice):
    assert client.post("/api/auth/password/forgot", json={"email": "ghost@example.com"}).status_code == 204
    assert not [m for m in h.mailer.sent if m["to"] == "ghost@example.com"]
    assert client.post("/api/auth/password/forgot", json={"email": "alice@example.com"}).status_code == 204
    token = h.mailer.token_for("alice@example.com", "reset")
    bad = client.post("/api/auth/password/reset", json={"token": token, "new_password": "short"})
    assert bad.status_code == 422 and bad.json()["error"]["field"] == "new_password"
    new_pw = "Brand-New-Lantern-77"
    assert client.post("/api/auth/password/reset", json={"token": token, "new_password": new_pw}).status_code == 204
    # sessions revoked: old refresh + old access token stop working
    assert client.post("/api/auth/refresh", json={"refresh_token": alice["refresh_token"]},
                       headers={"X-Client": "native"}).status_code == 401
    assert client.get("/api/auth/me", headers=auth(alice["access_token"])).status_code == 401
    # single use
    assert client.post("/api/auth/password/reset", json={"token": token, "new_password": new_pw}).status_code == 400
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": new_pw}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 401


def test_reset_token_expires(h, client, alice, monkeypatch):
    from analyzer.accounts import service
    monkeypatch.setattr(service, "RESET_TTL", service.timedelta(seconds=-1))
    client.post("/api/auth/password/forgot", json={"email": "alice@example.com"})
    token = h.mailer.token_for("alice@example.com", "reset")
    r = client.post("/api/auth/password/reset", json={"token": token, "new_password": "Brand-New-Lantern-77"})
    assert r.status_code == 400


def test_password_change(h, client, alice):
    at = alice["access_token"]
    bad = client.post("/api/auth/password/change", json={"current_password": "nope-nope-nope", "new_password": "Another-Fine-Pass-9"},
                      headers=auth(at))
    assert bad.status_code == 403
    ok = client.post("/api/auth/password/change", json={"current_password": PASSWORD, "new_password": "Another-Fine-Pass-9"},
                     headers=auth(at))
    assert ok.status_code == 204
    assert client.get("/api/auth/me", headers=auth(at)).status_code == 200   # current session kept


def test_sessions_list_and_revoke(h, client, alice):
    at = alice["access_token"]
    second = client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD},
                         headers={"X-Client": "native", "User-Agent": "phone"}).json()
    sessions = client.get("/api/auth/sessions", headers=auth(at)).json()
    assert len(sessions) == 2
    assert {"id", "device", "created_at", "last_used_at", "current"} <= set(sessions[0])
    assert sum(s["current"] for s in sessions) == 1
    other = next(s for s in sessions if not s["current"])
    assert client.delete(f"/api/auth/sessions/{other['id']}", headers=auth(at)).status_code == 204
    assert client.get("/api/auth/me", headers=auth(second["access_token"])).status_code == 401
    assert client.delete("/api/auth/sessions/does-not-exist", headers=auth(at)).status_code == 404


def test_admin_email_bootstrap_needs_verification(tmp_path):
    h = Harness(tmp_path)
    with h.client() as c:
        r = c.post("/api/auth/signup", json={"email": "admin@example.com", "password": PASSWORD},
                   headers={"X-Client": "native"})
        assert r.status_code == 201 and r.json()["user"]["role"] == "user"
        token = h.mailer.token_for("admin@example.com", "verify")
        assert c.post("/api/auth/verify-email", json={"token": token}).status_code == 204
        me = c.get("/api/auth/me", headers=auth(r.json()["access_token"])).json()
        assert me["role"] == "admin"
        # once an admin exists, the bootstrap path no longer bypasses invites
        r = c.post("/api/auth/signup", json={"email": "admin2@example.com", "password": PASSWORD})
        assert r.status_code == 403


def test_admin_only_invites(h, client, alice):
    at = alice["access_token"]
    assert client.get("/api/invites", headers=auth(at)).status_code == 403
    assert client.post("/api/invites", json={}, headers=auth(at)).status_code == 403
    h.accounts.users.update(alice["user"]["id"], role="admin")
    r = client.post("/api/invites", json={"email": "Friend@Example.com", "expires_days": 3}, headers=auth(at))
    assert r.status_code == 201
    inv = r.json()
    assert set(inv) == {"code", "email", "created_at", "expires_at", "used_by"} and inv["email"] == "friend@example.com"
    assert any(i["code"] == inv["code"] for i in client.get("/api/invites", headers=auth(at)).json())
    assert client.delete(f"/api/invites/{inv['code']}", headers=auth(at)).status_code == 204
    assert client.delete(f"/api/invites/{inv['code']}", headers=auth(at)).status_code == 404


def test_tampered_or_foreign_jwt_rejected(h, client, alice):
    import jwt as pyjwt
    claims = {"sub": alice["user"]["id"], "role": "admin", "exp": 9999999999, "iat": 1, "typ": "access"}
    forged = pyjwt.encode(claims, "x" * 48, algorithm="HS256")
    assert client.get("/api/auth/me", headers=auth(forged)).status_code == 401
    assert client.get("/api/auth/me", headers=auth("garbage")).status_code == 401


@pytest.mark.parametrize("missing", ["master_key", "jwt_secret"])
def test_settings_fail_closed(tmp_path, missing, monkeypatch):
    from pydantic import ValidationError

    from analyzer.web.settings import AppSettings
    monkeypatch.delenv("MASTER_KEY", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    kw = {"master_key": "m" * 32, "jwt_secret": "j" * 48}
    kw.pop(missing)
    with pytest.raises(ValidationError):
        AppSettings(_env_file=None, **kw)
