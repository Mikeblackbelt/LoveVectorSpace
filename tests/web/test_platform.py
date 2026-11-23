"""Token scopes, CORS, SPA fallback, healthz, MCP, logging hygiene, crypto and fail-closed storage."""
import json
import logging

import pytest

from analyzer.accounts import crypto
from analyzer.store.db import DatabaseKeyError

from .conftest import APP_ORIGIN, EXT_ID, PASSWORD, Harness, auth

EXT_ORIGIN = f"chrome-extension://{EXT_ID}"


def _token(client, at, kind):
    r = client.post("/api/tokens", json={"kind": kind, "label": kind}, headers=auth(at))
    assert r.status_code == 201
    return r.json()


def test_tokens_shown_once_hashed_and_revocable(h, client, alice):
    at = alice["access_token"]
    created = _token(client, at, "api")
    raw, info = created["token"], created["info"]
    assert set(info) == {"id", "kind", "label", "created_at", "last_used_at", "revoked_at"}
    listed = client.get("/api/tokens", headers=auth(at)).json()
    assert raw not in json.dumps(listed)
    stored = h.accounts.db.one("SELECT token_hash FROM api_tokens WHERE id=?", (info["id"],))[0]
    assert stored == crypto.sha256_hex(raw) and raw not in stored
    assert client.get("/api/people", headers=auth(raw)).status_code == 200      # same access as the user
    assert client.get("/api/tokens", headers=auth(at)).json()[0]["last_used_at"] is not None
    assert client.delete(f"/api/tokens/{info['id']}", headers=auth(at)).status_code == 204
    assert client.get("/api/people", headers=auth(raw)).status_code == 401


def test_extension_token_scope(h, client, alice):
    ext = _token(client, alice["access_token"], "extension")["token"]
    e = auth(ext)
    r = client.get("/api/people", headers=e)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert client.get("/api/people/1/overview", headers=e).status_code == 403
    assert client.get("/api/settings", headers=e).status_code == 403
    assert client.post("/api/tokens", json={"kind": "api"}, headers=e).status_code == 403
    assert client.get("/api/auth/me", headers=e).status_code == 403
    assert client.get("/api/events", headers=e).status_code == 401
    assert client.get("/api/ext/people", headers=e).status_code == 200
    pid = client.post("/api/people", json={"pseudonym": "Sam", "mode": "potential"},
                      headers=auth(alice["access_token"])).json()["id"]
    assert client.post("/api/ext/link", json={"person_id": pid, "platform": "discord", "chat_key": "c1"},
                       headers=e).status_code == 204
    s = client.get("/api/ext/summary", params={"platform": "discord", "chat_key": "c1"}, headers=e).json()
    assert s["linked"] is True and s["person"] == {"id": pid, "pseudonym": "Sam"}
    batch = {"platform": "discord", "chat_key": "c1", "tz": "America/New_York", "messages": [
        {"platform_msg_id": "m1", "ts_local": "2026-11-20T18:00:00", "ts_precision": "minute",
         "direction": "outgoing", "speaker_raw": "me", "text": "hey"}]}
    r = client.post("/api/ingest", json=batch, headers=e)
    assert r.status_code == 200 and r.json() == {"added": 1, "merged": 0, "skipped": 0}
    assert client.request("DELETE", "/api/ext/link", json={"platform": "discord", "chat_key": "c1"},
                          headers=e).status_code == 204
    assert client.post("/api/ingest", json=batch, headers=e).status_code == 409


def test_ingest_limits(tmp_path):
    h = Harness(tmp_path, max_ingest_bytes=2000, ingest_msgs_per_min=3)
    with h.client() as c:
        a = h.signup(c, "alice@example.com")["access_token"]
        pid = c.post("/api/people", json={"pseudonym": "S", "mode": "potential"}, headers=auth(a)).json()["id"]
        c.post("/api/ext/link", json={"person_id": pid, "platform": "whatsapp", "chat_key": "k"}, headers=auth(a))
        msg = {"ts_utc": "2026-11-20T18:00:00Z", "ts_precision": "second", "direction": "incoming",
               "speaker_raw": "x", "text": "hi"}
        mk = lambda n: {"platform": "whatsapp", "chat_key": "k", "tz": "UTC", "messages": [msg] * n}
        big = c.post("/api/ingest", json={**mk(1), "pad": "x" * 3000}, headers=auth(a))
        assert big.status_code == 413
        assert c.post("/api/ingest", json=mk(2), headers=auth(a)).status_code == 200
        limited = c.post("/api/ingest", json=mk(2), headers=auth(a))
        assert limited.status_code == 429 and int(limited.headers["Retry-After"]) > 0
        bad = c.post("/api/ingest", json={"platform": "whatsapp", "chat_key": "k", "tz": "UTC",
                                          "messages": [{**msg, "ts_utc": None}]}, headers=auth(a))
        assert bad.status_code == 422


def _preflight(client, path, origin, method="POST"):
    return client.options(path, headers={"Origin": origin, "Access-Control-Request-Method": method,
                                         "Access-Control-Request-Headers": "authorization"})


def test_cors_rules(h, client, alice):
    for origin in (APP_ORIGIN, "capacitor://localhost", "https://localhost"):
        r = _preflight(client, "/api/people", origin)
        assert r.status_code == 204 and r.headers["access-control-allow-origin"] == origin
        assert r.headers["access-control-allow-credentials"] == "true"
        g = client.get("/api/people", headers={"Origin": origin, **auth(alice["access_token"])})
        assert g.headers["access-control-allow-origin"] == origin
    # extension origin: only ingest + /api/ext/*
    assert _preflight(client, "/api/people", EXT_ORIGIN).status_code == 403
    assert "access-control-allow-origin" not in client.get("/api/people", headers={"Origin": EXT_ORIGIN}).headers
    for path in ("/api/ingest", "/api/ext/people", "/api/ext/link"):
        r = _preflight(client, path, EXT_ORIGIN)
        assert r.status_code == 204 and r.headers["access-control-allow-origin"] == EXT_ORIGIN
        # app origins are not allowed on extension routes
        assert _preflight(client, path, APP_ORIGIN).status_code == 403
    assert _preflight(client, "/api/ingest", "chrome-extension://someoneelse").status_code == 403
    assert _preflight(client, "/api/people", "https://evil.example").status_code == 403
    # error responses still carry CORS headers for allowed origins
    r = client.get("/api/people", headers={"Origin": APP_ORIGIN})
    assert r.status_code == 401 and r.headers["access-control-allow-origin"] == APP_ORIGIN


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json()["ok"] is True and "version" in r.json()


def test_spa_fallback_never_shadows_api(tmp_path):
    h = Harness(tmp_path)
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=root></div>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    with h.client() as c:
        assert "id=root" in c.get("/").text
        assert "id=root" in c.get("/people/3/dashboard").text
        assert c.get("/assets/app.js").text == "console.log(1)"
        r = c.get("/api/nope")
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
        assert c.get("/api").status_code == 404
        assert c.get("/mcp/x").status_code == 404
        assert c.get("/../../etc/passwd").status_code in (200, 404)   # never escapes dist
        assert "root:" not in c.get("/..%2F..%2Fpyproject.toml").text


def _mcp(client, token, payload, origin=None):
    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if origin:
        headers["Origin"] = origin
    return client.post("/mcp", headers=headers, json=payload)


def test_mcp_auth_origin_and_tools(h, client, alice, bob):
    a = auth(alice["access_token"])
    pid = client.post("/api/people", json={"pseudonym": "AlicePerson", "mode": "potential"}, headers=a).json()["id"]
    client.post(f"/api/people/{pid}/facts", json={"key": "k", "value": "v", "confidence": "owner_sure"}, headers=a)
    api = _token(client, alice["access_token"], "api")["token"]
    ext = _token(client, alice["access_token"], "extension")["token"]
    lst = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    assert _mcp(client, None, lst).status_code == 401
    assert _mcp(client, alice["access_token"], lst).status_code == 401   # session JWTs are not MCP credentials
    assert _mcp(client, ext, lst).status_code == 401
    assert _mcp(client, api, lst, origin="https://evil.example").status_code == 403
    r = _mcp(client, api, lst)
    assert r.status_code == 200
    names = {t["name"] for t in r.json()["result"]["tools"]}
    assert names == {"list_people", "get_person_overview", "get_history", "explain_metric", "list_next_steps",
                     "get_context"}
    assert _mcp(client, api, lst, origin=APP_ORIGIN).status_code == 200
    call = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "list_people", "arguments": {}}}
    r = _mcp(client, api, call)
    assert r.status_code == 200 and "AlicePerson" in r.text
    ctx = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_context",
                                                                         "arguments": {"person_id": pid}}}
    assert '\\"facts\\"' in _mcp(client, api, ctx).text or '"facts"' in _mcp(client, api, ctx).text
    # Bob's token sees only Bob's (empty) data
    bob_api = _token(client, bob["access_token"], "api")["token"]
    r = _mcp(client, bob_api, call)
    assert r.status_code == 200 and "AlicePerson" not in r.text
    nf = _mcp(client, bob_api, ctx)
    assert nf.json()["result"]["isError"] is True and "not_found" in nf.text


def test_logs_never_contain_secrets(tmp_path, caplog):
    import httpx

    from analyzer.accounts.mailer import ResendMailer
    caplog.set_level(logging.DEBUG)
    h = Harness(tmp_path)
    failing = ResendMailer("re_secret_key", "LVS <no-reply@example.com>",
                           transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    recorder = h.mailer
    h.accounts.mailer = type("Both", (), {"send": lambda self, *a: (recorder.send(*a), failing.send(*a))})()
    secret_text = "MESSAGE_TEXT_SECRET"
    with h.client() as c:
        res = h.signup(c, "alice@example.com")
        at, rt = res["access_token"], res["refresh_token"]
        pid = c.post("/api/people", json={"pseudonym": "S", "mode": "potential"}, headers=auth(at)).json()["id"]
        c.post(f"/api/people/{pid}/facts", json={"key": "k", "value": "FACT_VALUE_SECRET", "confidence": "owner_sure"},
               headers=auth(at))
        c.post("/api/ext/link", json={"person_id": pid, "platform": "whatsapp", "chat_key": "k"}, headers=auth(at))
        c.post("/api/ingest", headers=auth(at), json={"platform": "whatsapp", "chat_key": "k", "tz": "UTC", "messages": [
            {"ts_utc": "2026-11-20T18:00:00Z", "ts_precision": "second", "direction": "incoming", "speaker_raw": "x",
             "text": secret_text}]})
        c.post("/api/auth/password/forgot", json={"email": "alice@example.com"})
        c.post("/api/auth/refresh", json={"refresh_token": rt}, headers={"X-Client": "native"})
        c.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrong-password-xx"})
        with c.stream("GET", "/api/events", params={"access_token": at}) as r:
            next(r.iter_lines())
        api = c.post("/api/tokens", json={"kind": "api"}, headers=auth(at)).json()["token"]
        tid = c.post(f"/api/people/{pid}/agent/threads", json={"kind": "chat"}, headers=auth(at)).json()["id"]
        c.post(f"/api/agent/threads/{tid}/messages", json={"text": "AGENT_INPUT_SECRET"}, headers=auth(at))
    links = [m["link"] for m in recorder.sent]
    # server-side records only (the test client's own httpx logger prints request URLs)
    text = "\n".join(r.getMessage() for r in caplog.records if not r.name.startswith("httpx"))
    for secret in [at, rt, api, PASSWORD, "wrong-password-xx", secret_text, "FACT_VALUE_SECRET", "AGENT_INPUT_SECRET",
                   "re_secret_key", *links, *(l.split("#token=")[1] for l in links)]:
        assert secret not in text, secret[:12]
    assert "rid=" in text and "/api/people" in text   # request log present (ids/paths only)


def test_crypto_wrap_roundtrip_and_binding():
    dek = crypto.new_dek()
    w = crypto.wrap_dek("m" * 32, dek, "user1")
    assert crypto.unwrap_dek("m" * 32, w, "user1") == dek
    assert len(w) == 12 + 32 + 16
    for args in (("x" * 32, w, "user1"), ("m" * 32, w, "user2")):
        with pytest.raises(Exception):
            crypto.unwrap_dek(*args)


def test_accounts_db_fails_closed_with_wrong_master_key(tmp_path):
    h = Harness(tmp_path)
    h.accounts.close()
    raw = (tmp_path / "data" / "accounts.db").read_bytes()
    assert b"SQLite format 3" not in raw[:16]   # encrypted at rest
    with pytest.raises(DatabaseKeyError):
        Harness(tmp_path, master_key="another-master-key-0123456789")


def test_main_fails_clearly_without_impl(monkeypatch):
    import sys

    from analyzer.web import main
    monkeypatch.setenv("MASTER_KEY", "m" * 32)
    monkeypatch.setenv("JWT_SECRET", "j" * 48)
    monkeypatch.setitem(sys.modules, "analyzer.service.impl", None)
    with pytest.raises(RuntimeError, match="ServiceFactoryImpl"):
        main.build_app()


def test_uvicorn_access_log_query_redacted():
    from analyzer.web.middleware import RedactQueryFilter
    rec = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                            ("1.2.3.4:5", "GET", "/api/events?access_token=SECRET", "1.1", 200), None)
    RedactQueryFilter().filter(rec)
    assert "SECRET" not in rec.getMessage() and "/api/events" in rec.getMessage()
