import json

from fastapi.routing import APIRoute

from .conftest import PASSWORD, Harness, auth

M = "ALICE_MARKER"


def seed_alice(h, client, alice):
    """Give Alice one of everything; return ids used to probe as Bob."""
    a = auth(alice["access_token"])
    pid = client.post("/api/people", json={"pseudonym": f"{M}_P", "mode": "potential"}, headers=a).json()["id"]
    fid = client.post(f"/api/people/{pid}/facts", json={"key": "likes", "value": f"{M}_F", "confidence": "owner_sure"},
                      headers=a).json()["id"]
    iid = client.post(f"/api/people/{pid}/interactions", json={"fields": {"ts": "2026-11-20T18:00:00Z"},
                      "notes": f"{M}_I"}, headers=a).json()["id"]
    job = client.post(f"/api/people/{pid}/analyze", headers=a).json()["job_id"]
    client.post(f"/api/people/{pid}/next-steps/generate", headers=a)
    step = client.get(f"/api/people/{pid}/next-steps", headers=a).json()[0]["id"]
    tid = client.post(f"/api/people/{pid}/agent/threads", json={"kind": "chat"}, headers=a).json()["id"]
    unit = client.post(f"/api/people/{pid}/imports", files={"file": ("chat.txt", b"a\nb\n")},
                       data={"tz": "UTC", "me_names": ["Me"]}, headers=a).json()["unit_id"]
    client.put(f"/api/people/{pid}/speakers", json=[{"source": "whatsapp", "speaker_raw": f"{M}_S", "role": "me"}],
               headers=a)
    client.post(f"/api/people/{pid}/questionnaires/csi16", json={"answers": {"q1": 3}}, headers=a)
    client.put("/api/settings", json={"owner_timezone": f"{M}_TZ"}, headers=a)
    client.post("/api/ext/link", json={"person_id": pid, "platform": "whatsapp", "chat_key": f"{M}_CHAT"}, headers=a)
    token = client.post("/api/tokens", json={"kind": "api", "label": f"{M}_T"}, headers=a).json()
    sessions = client.get("/api/auth/sessions", headers=a).json()
    h.accounts.users.update(alice["user"]["id"], role="admin")
    inv = client.post("/api/invites", json={"email": "alice-friend@example.com"}, headers=a).json()
    return {"pid": pid, "fact_id": fid, "interaction_id": iid, "job_id": job, "step_id": step, "tid": tid,
            "unit_id": unit, "metric_id": "lsm", "scale_id": "csi16", "token_id": token["info"]["id"],
            "sid": sessions[0]["id"], "code": inv["code"]}


# (method, path) -> request kwargs. Every /api route must be listed here or in NOT_USER_DATA.
PROBES = {
    ("GET", "/api/auth/me"): {},
    ("GET", "/api/auth/sessions"): {},
    ("DELETE", "/api/auth/sessions/{sid}"): {},
    ("POST", "/api/auth/verify-email/resend"): {},
    ("POST", "/api/auth/password/change"): {"json": {"current_password": "x", "new_password": "Whatever-Long-99"}},
    ("GET", "/api/settings"): {},
    ("PUT", "/api/settings"): {"json": {"text_size": "l"}},
    ("GET", "/api/tokens"): {},
    ("POST", "/api/tokens"): {"json": {"kind": "api"}},
    ("DELETE", "/api/tokens/{token_id}"): {},
    ("GET", "/api/invites"): {},
    ("POST", "/api/invites"): {"json": {}},
    ("DELETE", "/api/invites/{code}"): {},
    ("POST", "/api/account/export"): {"json": {"include_messages": True}},
    ("DELETE", "/api/account"): {"json": {"confirm": "nope"}},
    ("GET", "/api/people"): {},
    ("POST", "/api/people"): {"json": {"pseudonym": "BobPerson", "mode": "potential"}},
    ("GET", "/api/people/{pid}"): {},
    ("PATCH", "/api/people/{pid}"): {"json": {"pseudonym": "hijack"}},
    ("DELETE", "/api/people/{pid}"): {},
    ("POST", "/api/people/{pid}/imports"): {"files": {"file": ("x.txt", b"x\n")}, "data": {"tz": "UTC", "me_names": ["Me"]}},
    ("POST", "/api/people/{pid}/imports/preview"): {"files": {"file": ("x.txt", b"x\n")}},
    ("POST", "/api/people/{pid}/imports/messages"): {"json": {"source": "android_sms", "tz": "UTC", "messages": [
        {"ts_utc": "2026-11-20T18:00:00Z", "ts_precision": "minute", "role": "them", "text": "hi"}]}},
    ("GET", "/api/people/{pid}/units"): {},
    ("DELETE", "/api/units/{unit_id}"): {},
    ("GET", "/api/people/{pid}/speakers"): {},
    ("PUT", "/api/people/{pid}/speakers"): {"json": []},
    ("GET", "/api/people/{pid}/coverage"): {},
    ("GET", "/api/people/{pid}/overview"): {},
    ("POST", "/api/people/{pid}/analyze"): {},
    ("GET", "/api/jobs/{job_id}"): {},
    ("GET", "/api/people/{pid}/history/{metric_id}"): {},
    ("GET", "/api/metrics/{metric_id}/explain"): {},
    ("GET", "/api/scales"): {},
    ("POST", "/api/people/{pid}/questionnaires/{scale_id}"): {"json": {"answers": {"q1": 1}}},
    ("GET", "/api/people/{pid}/questionnaires"): {},
    ("GET", "/api/people/{pid}/facts"): {},
    ("POST", "/api/people/{pid}/facts"): {"json": {"key": "k", "value": "v", "confidence": "owner_sure"}},
    ("PATCH", "/api/facts/{fact_id}"): {"json": {"value": "hijack"}},
    ("DELETE", "/api/facts/{fact_id}"): {},
    ("GET", "/api/people/{pid}/interactions"): {},
    ("POST", "/api/people/{pid}/interactions"): {"json": {"fields": {"ts": "2026-11-20T18:00:00Z"}, "notes": ""}},
    ("PATCH", "/api/interactions/{interaction_id}"): {"json": {"notes": "hijack"}},
    ("DELETE", "/api/interactions/{interaction_id}"): {},
    ("GET", "/api/people/{pid}/next-steps"): {},
    ("POST", "/api/people/{pid}/next-steps/generate"): {},
    ("PATCH", "/api/next-steps/{step_id}"): {"json": {"status": "done"}},
    ("GET", "/api/people/{pid}/agent/threads"): {},
    ("POST", "/api/people/{pid}/agent/threads"): {"json": {"kind": "chat"}},
    ("GET", "/api/agent/threads/{tid}"): {},
    ("POST", "/api/agent/threads/{tid}/messages"): {"json": {"text": "hi"}},
    ("GET", "/api/people/{pid}/interview/progress"): {},
    ("GET", "/api/ext/people"): {},
    ("POST", "/api/ext/link"): {"json": {"person_id": "{pid}", "platform": "whatsapp", "chat_key": "bob-chat"}},
    ("DELETE", "/api/ext/link"): {"json": {"platform": "whatsapp", "chat_key": f"{M}_CHAT"}},
    ("GET", "/api/ext/summary"): {"params": {"platform": "whatsapp", "chat_key": f"{M}_CHAT"}},
    ("POST", "/api/ingest"): {"json": {"platform": "whatsapp", "chat_key": f"{M}_CHAT", "tz": "UTC", "messages": [
        {"ts_utc": "2026-11-20T18:00:00Z", "ts_precision": "second", "direction": "incoming", "speaker_raw": "x",
         "text": "hello"}]}},
    ("GET", "/api/events"): None,   # covered by test_events (SSE)
}
NOT_USER_DATA = {  # credential endpoints that take no session (cannot reach another user's data by design)
    ("POST", "/api/auth/signup"), ("POST", "/api/auth/login"), ("POST", "/api/auth/refresh"),
    ("POST", "/api/auth/logout"), ("POST", "/api/auth/verify-email"), ("POST", "/api/auth/password/forgot"),
    ("POST", "/api/auth/password/reset"), ("GET", "/api/auth/google/start"), ("GET", "/api/auth/google/callback"),
    ("POST", "/api/auth/google/token"), ("POST", "/api/auth/apple/token"),
}
GLOBAL_IDS = {"/api/metrics/{metric_id}/explain"}   # metric definitions are not per-user data
# create-style routes run last: after them Bob owns ids that may collide with Alice's
LAST = [("POST", "/api/people"), ("POST", "/api/tokens"), ("PUT", "/api/settings"), ("DELETE", "/api/account")]


def _walk(routes):
    for r in routes:
        if isinstance(r, APIRoute):
            yield r
        elif hasattr(r, "original_router"):   # FastAPI >= 0.16x keeps included routers
            yield from _walk(r.original_router.routes)


def api_routes(app):
    return {(m, r.path) for r in _walk(app.routes)
            if r.path.startswith("/api") and r.path != "/api/{rest:path}" for m in r.methods}   # 404 catch-all


def test_every_api_route_is_probed(h):
    assert api_routes(h.app) == set(PROBES) | NOT_USER_DATA


def test_cross_user_isolation_every_route(h, client, alice, bob):
    ids = seed_alice(h, client, alice)
    b = auth(bob["access_token"])
    order = [k for k in PROBES if k not in LAST and PROBES[k] is not None] + LAST
    for method, path in order:
        kw = json.loads(json.dumps({k: v for k, v in PROBES[(method, path)].items() if k != "files"}).replace(
            '"{pid}"', str(ids["pid"])))
        if "files" in PROBES[(method, path)]:
            kw["files"] = PROBES[(method, path)]["files"]
        url = path.format(**ids)
        r = client.request(method, url, headers=b, **kw)
        body = r.text
        assert M not in body, (method, path, body)
        assert "alice@example.com" not in body, (method, path)
        if "{" in path and (method, path) not in LAST and path not in GLOBAL_IDS:
            assert r.status_code in (403, 404), (method, path, r.status_code, body)
        if path == "/api/ingest":
            assert r.status_code == 409 and r.json()["error"]["code"] == "chat_not_linked"
    # Alice's data is untouched
    a = auth(alice["access_token"])
    assert client.get(f"/api/people/{ids['pid']}", headers=a).json()["pseudonym"] == f"{M}_P"
    assert client.get(f"/api/people/{ids['pid']}/facts", headers=a).json()[0]["value"] == f"{M}_F"
    assert client.get("/api/settings", headers=a).json()["owner_timezone"] == f"{M}_TZ"
    assert client.get("/api/tokens", headers=a).json()[0]["revoked_at"] is None
    assert client.get("/api/auth/sessions", headers=a).json()
    assert client.get("/api/invites", headers=a).json()
    assert client.get("/api/ext/summary", params={"platform": "whatsapp", "chat_key": f"{M}_CHAT"},
                      headers=a).json()["linked"] is True
    # Bob's DB file is a different encrypted file
    assert h.accounts.userdbs.path(alice["user"]["id"]) != h.accounts.userdbs.path(bob["user"]["id"])


def test_unauthenticated_routes_are_rejected(h, client):
    for method, path in api_routes(h.app) - NOT_USER_DATA:
        url = path.replace("{", "").replace("}", "")
        r = client.request(method, url)
        assert r.status_code == 401, (method, path, r.status_code)
        assert r.json()["error"]["code"] == "unauthenticated"
    assert client.get("/api/people").status_code == 401


def test_facade_exception_mapping(h, client, alice):
    a = auth(alice["access_token"])
    nf = client.get("/api/people/999", headers=a)
    assert nf.status_code == 404 and nf.json()["error"]["code"] == "not_found"
    pid = client.post("/api/people", json={"pseudonym": "Sam", "mode": "potential"}, headers=a).json()["id"]
    assert client.get(f"/api/people/{pid}/overview", headers=a).status_code == 404     # no snapshot yet
    assert client.post(f"/api/people/{pid}/analyze", headers=a).status_code == 202
    assert client.get(f"/api/people/{pid}/overview", headers=a).status_code == 200
    v = client.post(f"/api/people/{pid}/interactions", json={"fields": {}, "notes": ""}, headers=a)
    assert v.status_code == 400 and v.json()["error"] == {"code": "invalid_input", "message": "ts is required",
                                                          "field": "fields.ts"}
    bad = client.post(f"/api/people/{pid}/questionnaires/csi16", json={"answers": {}}, headers=a)
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "invalid_input" and "field" not in bad.json()["error"]
    theme = client.put("/api/settings", json={"theme": "neon"}, headers=a)
    assert theme.status_code == 400 and theme.json()["error"]["field"] == "theme"
    assert client.put("/api/settings", json={"theme": "midnight"}, headers=a).json()["theme"] == "midnight"
    ing = client.post("/api/ingest", headers=a, json={"platform": "whatsapp", "chat_key": "nope", "tz": "UTC",
                                                      "messages": []})
    assert ing.status_code == 409 and ing.json()["error"]["code"] == "chat_not_linked"
    h.factory.agent_enabled = False
    ag = client.get(f"/api/people/{pid}/agent/threads", headers=a)
    assert ag.status_code == 503 and ag.json()["error"]["code"] == "agent_unavailable"
    msg = client.post("/api/agent/threads/1/messages", json={"text": "hi"}, headers=a)
    assert msg.status_code == 503
    pyd = client.post("/api/people", json={"pseudonym": "", "mode": "potential"}, headers=a)
    assert pyd.status_code == 422 and pyd.json()["error"]["field"] == "pseudonym"
    assert client.get("/api/does-not-exist", headers=a).json()["error"]["code"] == "not_found"


def test_people_crud_and_status_codes(h, client, alice):
    a = auth(alice["access_token"])
    p = client.post("/api/people", json={"pseudonym": "Yu", "mode": "established", "timezone": "Asia/Taipei"}, headers=a)
    assert p.status_code == 201 and p.json()["timezone"] == "Asia/Taipei"
    pid = p.json()["id"]
    assert client.patch(f"/api/people/{pid}", json={"mode": "potential"}, headers=a).json()["mode"] == "potential"
    assert client.get("/api/people", headers=a).json()[0]["pseudonym"] == "Yu"
    assert client.delete(f"/api/people/{pid}", headers=a).status_code == 204
    assert client.get(f"/api/people/{pid}", headers=a).status_code == 404


def test_imports(tmp_path):
    h = Harness(tmp_path, max_import_bytes=1000)
    with h.client() as c:
        a = auth(h.signup(c, "alice@example.com")["access_token"])
        pid = c.post("/api/people", json={"pseudonym": "Sam", "mode": "potential"}, headers=a).json()["id"]
        missing = c.post(f"/api/people/{pid}/imports", files={"file": ("c.txt", b"a\n")}, data={"tz": "UTC"}, headers=a)
        assert missing.status_code == 422 and missing.json()["error"]["field"] == "me_names"
        big = c.post(f"/api/people/{pid}/imports", files={"file": ("c.txt", b"x" * 1001)},
                     data={"tz": "UTC", "me_names": ["Me"]}, headers=a)
        assert big.status_code == 413 and big.json()["error"]["code"] == "too_large"
        huge = c.post(f"/api/people/{pid}/imports", content=b"x" * (1000 + 2 * 1024 * 1024),
                      headers={**a, "Content-Type": "multipart/form-data; boundary=zz"})
        assert huge.status_code == 413
        ok = c.post(f"/api/people/{pid}/imports", files={"file": ("c.txt", b"a\nb\n")},
                    data={"tz": "UTC", "me_names": ["Me", "Me2"]}, headers=a)
        assert ok.status_code == 201
        assert set(ok.json()) == {"unit_id", "added", "merged", "skipped_non_english", "one_sided", "job_id"}
        dating = c.post(f"/api/people/{pid}/imports", files={"file": ("tinder.json", b"{}\n")}, data={"tz": "UTC"},
                        headers=a)
        assert dating.status_code == 400 and dating.json()["error"]["field"] == "match_id"
        dating = c.post(f"/api/people/{pid}/imports", files={"file": ("tinder.json", b"{}\n")},
                        data={"tz": "UTC", "match_id": "m42"}, headers=a)
        assert dating.status_code == 201 and h.factory.imports[-1]["match_id"] == "m42"
        msgs = c.post(f"/api/people/{pid}/imports/messages", headers=a, json={"source": "screenshot_import", "tz": "UTC",
                      "messages": [{"ts_local": "2026-11-20T18:00", "ts_precision": "minute", "role": "me", "text": "x"}]})
        assert msgs.status_code == 201 and h.factory.imports[-1]["messages"][0]["role"] == "me"
        bad = c.post(f"/api/people/{pid}/imports/messages", headers=a, json={"source": "fax", "tz": "UTC", "messages": []})
        assert bad.status_code == 400 and bad.json()["error"]["field"] == "source"
        prev = c.post(f"/api/people/{pid}/imports/preview", files={"file": ("c.txt", b"a\nb\n")}, headers=a)
        assert prev.status_code == 200 and prev.json()["format"] == "plaintext"
        units = c.get(f"/api/people/{pid}/units", headers=a).json()
        assert units[0]["unit_id"] == ok.json()["unit_id"]
        assert c.delete(f"/api/units/{units[0]['unit_id']}", headers=a).json() == {"removed_messages": 2}


def test_next_steps_and_jobs(h, client, alice):
    a = auth(alice["access_token"])
    pid = client.post("/api/people", json={"pseudonym": "Sam", "mode": "potential"}, headers=a).json()["id"]
    r = client.post(f"/api/people/{pid}/next-steps/generate", headers=a)
    assert r.status_code == 202 and "job_id" in r.json()
    assert client.get(f"/api/jobs/{r.json()['job_id']}", headers=a).json()["status"] == "done"
    step = client.get(f"/api/people/{pid}/next-steps?status=open", headers=a).json()[0]
    assert client.patch(f"/api/next-steps/{step['id']}", json={"status": "done"}, headers=a).json()["status"] == "done"
    assert client.get(f"/api/people/{pid}/next-steps?status=open", headers=a).json() == []
    assert client.patch(f"/api/next-steps/{step['id']}", json={"status": "bogus"}, headers=a).status_code == 422


def test_agent_stream(h, client, alice):
    a = auth(alice["access_token"])
    pid = client.post("/api/people", json={"pseudonym": "Sam", "mode": "potential"}, headers=a).json()["id"]
    tid = client.post(f"/api/people/{pid}/agent/threads", json={"kind": "chat"}, headers=a).json()["id"]
    r = client.post(f"/api/agent/threads/{tid}/messages", json={"text": "hello"}, headers=a)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    assert [e["type"] for e in events] == ["token", "tool_call", "token", "done"]
    assert client.post("/api/agent/threads/999/messages", json={"text": "x"}, headers=a).status_code == 404
    h.factory.fail_mid_stream = True
    r = client.post(f"/api/agent/threads/{tid}/messages", json={"text": "hello"}, headers=a)
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    assert events[-1] == {"type": "error", "code": "internal_error", "message": "The agent failed."}
    # the connection was released (not pinned forever)
    assert all(hd.pins == 0 for hd in h.accounts.userdbs._entries.values())


def test_export_and_delete_account(h, client, alice):
    a = auth(alice["access_token"])
    client.post("/api/people", json={"pseudonym": "Sam", "mode": "potential"}, headers=a)
    ex = client.post("/api/account/export", json={"include_messages": False}, headers=a)
    assert ex.status_code == 200 and ex.headers["content-type"].startswith("application/json")
    assert "attachment" in ex.headers["content-disposition"]
    body = ex.json()
    assert body["user"]["email"] == "alice@example.com" and body["data"]["people"][0]["pseudonym"] == "Sam"

    uid = alice["user"]["id"]
    path = h.accounts.userdbs.path(uid)
    assert path.exists()
    assert client.request("DELETE", "/api/account", json={"confirm": "delete"}, headers=a).status_code == 400
    wrong = client.request("DELETE", "/api/account", json={"confirm": "DELETE MY ACCOUNT", "password": "nope"}, headers=a)
    assert wrong.status_code == 403 and path.exists()
    ok = client.request("DELETE", "/api/account", json={"confirm": "DELETE MY ACCOUNT", "password": PASSWORD}, headers=a)
    assert ok.status_code == 204
    assert not path.exists()
    assert h.accounts.users.get(uid) is None
    assert h.accounts.db.one("SELECT count(*) FROM refresh_tokens WHERE user_id=?", (uid,))[0] == 0
    assert client.get("/api/auth/me", headers=a).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": alice["refresh_token"]},
                       headers={"X-Client": "native"}).status_code == 401
    assert ("account_deleted" in [e[1] for e in h.accounts.audit.events(uid)])


def test_lru_eviction_and_reopen(tmp_path):
    h = Harness(tmp_path, user_db_cache_size=2)
    with h.client() as c:
        users = [h.signup(c, f"u{i}@example.com") for i in range(4)]
        for i, u in enumerate(users):
            r = c.post("/api/people", json={"pseudonym": f"P{i}", "mode": "potential"}, headers=auth(u["access_token"]))
            assert r.status_code == 201
        assert h.accounts.userdbs.open_count() <= 2
        h.accounts.userdbs.wait_closers()                  # evictions are closed on a background thread
        assert any(s.closed for s in h.factory.services)   # evicted services were closed
        for i, u in enumerate(users):   # reopen evicted DBs with the right DEK
            people = c.get("/api/people", headers=auth(u["access_token"])).json()
            assert [p["pseudonym"] for p in people] == [f"P{i}"]


def test_seed_demo(tmp_path):
    h = Harness(tmp_path, seed_demo=True, demo_password="demo-password-for-judges")
    with h.client() as c:
        assert len(h.factory.seeded) == 2
        r = c.post("/api/auth/login", json={"email": "judge1@demo.lvs", "password": "demo-password-for-judges"})
        assert r.status_code == 200
        people = c.get("/api/people", headers=auth(r.json()["access_token"])).json()
        assert people[0]["pseudonym"] == "Yu Cheng"
    h2 = Harness(tmp_path, seed_demo=True, demo_password="demo-password-for-judges")   # idempotent
    assert h2.factory.seeded == []
    h2.accounts.close()
