"""Re-review round: quarantine instead of wipe, restore script, deferred deletion, CAS rehash, eviction while busy,
BodyLimit after response start, proxy warning, nonce-free conftest default."""
import asyncio
import importlib.util
import json
import logging
import threading
from pathlib import Path
from types import SimpleNamespace

from analyzer.accounts import quarantine as qmod
from analyzer.accounts.userdb import UserDBManager
from analyzer.web.middleware import BodyLimit

from .conftest import PASSWORD, Harness, auth

NATIVE = {"X-Client": "native"}
ROOT = Path(__file__).resolve().parents[2]


def _squatter_with_data(h, c, email):
    res = h.signup(c, email)
    a = auth(res["access_token"])
    c.post("/api/people", json={"pseudonym": "SQUAT", "mode": "potential"}, headers=a)
    api = c.post("/api/tokens", json={"kind": "api"}, headers=a).json()["token"]
    return res, api


def test_reset_takeover_quarantines_then_restore_script(h, client, monkeypatch):
    res, api = _squatter_with_data(h, client, "victim@example.com")
    uid = res["user"]["id"]
    old_dek = h.accounts.users.get(uid).wrapped_dek
    client.post("/api/auth/password/forgot", json={"email": "victim@example.com"})
    tok = h.mailer.token_for("victim@example.com", "reset")
    assert client.post("/api/auth/password/reset", json={"token": tok, "new_password": "Owner-Reclaims-77"}).status_code == 204
    entries = h.accounts.quarantine.entries(uid)
    assert len(entries) == 1 and entries[0]["wrapped_dek"] == old_dek and entries[0]["path"].exists()
    assert entries[0]["path"].parent == Path(h.settings.data_dir) / "quarantine"
    assert h.accounts.users.get(uid).wrapped_dek != old_dek          # new key committed after the move
    owner = client.post("/api/auth/login", json={"email": "victim@example.com", "password": "Owner-Reclaims-77"}).json()
    assert client.get("/api/people", headers=auth(owner["access_token"])).json() == []

    # admin restore (server stopped): the squatter's data comes back, the owner's fresh DB is set aside
    h.accounts.close()
    monkeypatch.setenv("MASTER_KEY", h.settings.master_key)
    monkeypatch.setenv("JWT_SECRET", h.settings.jwt_secret)
    monkeypatch.setenv("DATA_DIR", h.settings.data_dir)
    spec = importlib.util.spec_from_file_location("restore_quarantine", ROOT / "scripts" / "restore_quarantine.py")
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    assert script.main(["restore_quarantine.py", uid]) == 0
    assert script.main(["restore_quarantine.py", "f" * 32]) == 1
    h2 = Harness(Path(h.settings.data_dir).parent)
    assert h2.accounts.users.get(uid).wrapped_dek == old_dek
    with h2.accounts.userdbs.use(uid) as hd, hd.lock:
        assert [p["pseudonym"] for p in hd.service.list_people()] == ["SQUAT"]
    assert len(h2.accounts.quarantine.entries(uid)) == 1                  # the owner's DB, kept
    h2.accounts.close()


def test_quarantine_move_failure_changes_nothing(h, client, monkeypatch):
    res, api = _squatter_with_data(h, client, "victim@example.com")
    uid = res["user"]["id"]
    before = h.accounts.users.get(uid)
    client.post("/api/auth/password/forgot", json={"email": "victim@example.com"})
    tok = h.mailer.token_for("victim@example.com", "reset")

    def boom(*a, **k):
        raise PermissionError("locked")
    monkeypatch.setattr(qmod, "move_with_retry", boom)
    r = client.post("/api/auth/password/reset", json={"token": tok, "new_password": "Owner-Reclaims-77"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "unavailable" and r.headers["Retry-After"] == "1"
    after = h.accounts.users.get(uid)
    assert (after.password_hash, after.wrapped_dek, after.email_verified) == \
        (before.password_hash, before.wrapped_dek, before.email_verified)
    assert h.accounts.quarantine.entries(uid) == [] and h.accounts.userdbs.path(uid).exists()
    monkeypatch.undo()
    # nothing was consumed: the same link still works once the file can be moved
    assert client.post("/api/auth/password/reset", json={"token": tok, "new_password": "Owner-Reclaims-77"}).status_code == 204


def test_social_takeover_move_failure_is_503(h, client, monkeypatch):
    res, api = _squatter_with_data(h, client, "victim@example.com")
    monkeypatch.setattr(qmod, "move_with_retry", lambda *a, **k: (_ for _ in ()).throw(PermissionError()))
    r = client.post("/api/auth/google/token", json={"id_token": h.idp.token(email="victim@example.com", sub="g-v")},
                    headers=NATIVE)
    assert r.status_code == 503
    assert client.get("/api/people", headers=auth(api)).status_code == 200     # nothing changed yet
    assert h.accounts.users.get(res["user"]["id"]).google_sub is None


def test_quarantine_purge_after_30_days(h, client):
    res, _ = _squatter_with_data(h, client, "victim@example.com")
    uid = res["user"]["id"]
    client.post("/api/auth/google/token", json={"id_token": h.idp.token(email="victim@example.com", sub="g-v")},
                headers=NATIVE)
    entry = h.accounts.quarantine.entries(uid)[0]
    assert h.accounts.quarantine.purge() == 0 and entry["path"].exists()
    h.accounts.db.x("UPDATE quarantine SET created_at='2020-01-01T00:00:00Z'")
    h.accounts.maintenance()
    assert not entry["path"].exists() and h.accounts.quarantine.entries(uid) == []


def test_failed_deletion_stays_soft_deleted_and_is_finished_later(h, client, alice, monkeypatch):
    uid = alice["user"]["id"]
    a = auth(alice["access_token"])
    real = h.accounts.userdbs.delete
    monkeypatch.setattr(h.accounts.userdbs, "delete", lambda *a, **k: (_ for _ in ()).throw(PermissionError()))
    r = client.request("DELETE", "/api/account", json={"confirm": "DELETE MY ACCOUNT", "password": PASSWORD}, headers=a)
    assert r.status_code == 204
    row = h.accounts.users.get_any(uid)
    assert row is not None and row.deleted_at is not None
    assert client.get("/api/auth/me", headers=a).status_code == 401
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 401
    monkeypatch.setattr(h.accounts.userdbs, "delete", real)
    assert h.accounts.finish_pending_deletions() == 0                    # younger than a minute: left alone
    assert h.accounts.finish_pending_deletions(older_than=__import__("datetime").timedelta(0)) == 1
    assert h.accounts.users.get_any(uid) is None and not h.accounts.userdbs.path(uid).exists()


def test_rehash_is_compare_and_set(h, client, alice):
    uid = alice["user"]["id"]
    current = h.accounts.users.get(uid).password_hash
    assert h.accounts.users.replace_password_hash(uid, "stale-hash", "x") is False
    assert h.accounts.users.get(uid).password_hash == current
    assert h.accounts.users.replace_password_hash(uid, current, current) is True


def test_eviction_keeps_state_when_background_work_is_still_running(tmp_path):
    closed_users = []
    st = SimpleNamespace(cv=threading.Condition(), running=1, firing=0)

    class Svc:
        lock = threading.RLock()
        _state = st

        def close(self, timeout=10.0):
            pass

    from analyzer.store.db import open_db
    mgr = UserDBManager(tmp_path, lambda uid: "k" * 64, lambda uid, conn: Svc(), capacity=1,
                        close_user=closed_users.append)
    a, b = "a" * 32, "b" * 32
    for uid in (a, b):
        open_db(mgr.path(uid), "k" * 64).close()
    with mgr.use(a):
        pass
    with mgr.use(b):     # evicts a while its "job" is still running
        pass
    mgr.wait_closers()
    assert closed_users == []                    # state kept: no fail_unfinished on the next open
    st.running = 0
    with mgr.use(a):     # evicts b, idle now
        pass
    mgr.wait_closers()
    assert closed_users == [b]
    mgr.close_all()


def test_bodylimit_never_sends_a_second_start():
    sent = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"partial", "more_body": True})
        while True:
            await receive()

    msgs = [{"type": "http.request", "body": b"x" * 600, "more_body": True}] * 3

    async def run():
        it = iter(msgs)

        async def receive():
            return next(it)

        async def send(m):
            sent.append(m)
        await BodyLimit(app, import_limit=10, ingest_limit=1000)(
            {"type": "http", "path": "/api/ingest", "headers": [], "method": "POST"}, receive, send)
    asyncio.run(run())
    starts = [m for m in sent if m["type"] == "http.response.start"]
    assert len(starts) == 1 and starts[0]["status"] == 200
    assert sent[-1] == {"type": "http.response.body", "body": b"", "more_body": False}


def test_untrusted_proxy_warning_once(tmp_path, caplog, monkeypatch):
    from analyzer.web import deps
    monkeypatch.setattr(deps, "_proxy_warned", False)
    caplog.set_level(logging.WARNING)
    h = Harness(tmp_path)
    with h.client() as c:
        for _ in range(3):
            c.post("/api/auth/login", json={"email": "a@example.com", "password": "x" * 12},
                   headers={"X-Forwarded-For": "1.2.3.4"})
    warnings = [r for r in caplog.records if "TRUSTED_PROXIES is unset" in r.getMessage()]
    assert len(warnings) == 1


def test_auth_ip_limit_default_is_60():
    from analyzer.web.settings import AppSettings
    s = AppSettings(_env_file=None, master_key="m" * 32, jwt_secret="j" * 48)
    assert s.auth_ip_limit == 60 and s.native_nonce_required is True
    assert json.loads(json.dumps(s.user_db_cache_size)) == 256
