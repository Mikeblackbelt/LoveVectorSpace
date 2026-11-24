"""Integration-round behaviours: lifetime hooks, SSE end on logout, refresh grace, trusted proxies, new fields."""
import json

from analyzer.service.impl import ServiceClosed

from .conftest import PASSWORD, Harness, auth


def test_sse_stream_ends_on_logout(tmp_path):
    h = Harness(tmp_path, sse_session_check_s=0.2, sse_heartbeat_s=0.1)
    with h.client() as c:
        res = h.signup(c, "alice@example.com")
        at, rt = res["access_token"], res["refresh_token"]
        lines = []
        with c.stream("GET", "/api/events", params={"access_token": at}) as r:
            it = r.iter_lines()
            assert next(it) == ": connected"
            c.post("/api/auth/logout", json={"refresh_token": rt}, headers={**auth(at), "X-Client": "native"})
            for line in it:            # ends by itself (server closes the stream)
                lines.append(line)
        assert 'data: {"type":"session_ended"}' in lines


def test_service_closed_maps_to_503(h, client, alice):
    a = auth(alice["access_token"])
    client.get("/api/people", headers=a)
    for s in h.factory.services:
        s.list_people = lambda: (_ for _ in ()).throw(ServiceClosed("u"))
    r = client.get("/api/people", headers=a)
    assert r.status_code == 503 and r.json()["error"]["code"] == "unavailable" and r.headers["Retry-After"] == "1"


def test_delete_account_closes_user_and_shutdown_on_exit(tmp_path):
    h = Harness(tmp_path)
    calls = []
    h.factory.close_user = lambda uid, timeout=10.0: calls.append(("close_user", uid))
    h.factory.shutdown = lambda timeout=30.0: calls.append(("shutdown",))
    with h.client() as c:
        res = h.signup(c, "alice@example.com")
        c.get("/api/people", headers=auth(res["access_token"]))
        r = c.request("DELETE", "/api/account", json={"confirm": "DELETE MY ACCOUNT", "password": PASSWORD},
                      headers=auth(res["access_token"]))
        assert r.status_code == 204
        assert ("close_user", res["user"]["id"]) in calls
        assert all(s.closed for s in h.factory.services if s.user_id == res["user"]["id"])
    assert calls[-1] == ("shutdown",)


def test_conn_opener_never_recreates_deleted_db(tmp_path):
    h = Harness(tmp_path)
    h.factory.conn_opener = None
    h2 = Harness(tmp_path / "b")
    with h2.client() as c:
        uid = h2.signup(c, "alice@example.com")["user"]["id"]
        h2.accounts.userdbs.delete(uid)
        assert not h2.accounts.userdbs.path(uid).exists()
        import pytest
        with pytest.raises(FileNotFoundError):
            h2.accounts.userdbs.open_existing(uid)
        assert not h2.accounts.userdbs.path(uid).exists()
    h.accounts.close()


def test_web_refresh_grace_for_concurrent_tabs(h, client, alice):
    r = client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    assert r.status_code == 200
    rt, csrf = client.cookies.get("lvs_rt"), client.cookies.get("lvs_csrf")
    hdr = {"X-CSRF-Token": csrf, "Cookie": f"lvs_rt={rt}; lvs_csrf={csrf}"}
    first = client.post("/api/auth/refresh", headers=hdr)
    second = client.post("/api/auth/refresh", headers=hdr)     # other tab, same (now rotated) cookie
    assert first.status_code == second.status_code == 200
    new1 = [c for c in first.headers.get_list("set-cookie") if c.startswith("lvs_rt=")][0].split(";")[0]
    new2 = [c for c in second.headers.get_list("set-cookie") if c.startswith("lvs_rt=")][0].split(";")[0]
    assert new1 == new2


def test_login_rate_limit_ignores_xff_unless_trusted(tmp_path):
    for i, (trusted, limited_after_ip_change) in enumerate(((None, True), ("*", False))):
        h = Harness(tmp_path / f"h{i}", trusted_proxies=trusted)
        with h.client() as c:
            h.signup(c, "alice@example.com")
            for _ in range(5):
                c.post("/api/auth/login", json={"email": "alice@example.com", "password": "bad-bad-bad-1"},
                       headers={"X-Forwarded-For": "1.1.1.1"})
            r = c.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD},
                       headers={"X-Forwarded-For": "2.2.2.2"})
            assert (r.status_code == 429) == limited_after_ip_change, trusted


def test_trusted_proxy_cidr_takes_rightmost_untrusted_hop():
    from types import SimpleNamespace

    from analyzer.web.deps import client_ip

    def req(peer, xff, trusted):
        return SimpleNamespace(client=SimpleNamespace(host=peer), headers={"x-forwarded-for": xff},
                               app=SimpleNamespace(state=SimpleNamespace(settings=SimpleNamespace(
                                   trusted_proxy_list=trusted))))
    assert client_ip(req("10.0.0.5", "9.9.9.9, 8.8.8.8, 10.0.0.7", ["10.0.0.0/8"])) == "8.8.8.8"
    assert client_ip(req("203.0.113.1", "8.8.8.8", ["10.0.0.0/8"])) == "203.0.113.1"   # untrusted peer
    assert client_ip(req("10.0.0.5", "8.8.8.8", [])) == "10.0.0.5"


def test_capture_new_platforms_and_fields(h, client, alice):
    a = auth(alice["access_token"])
    pid = client.post("/api/people", json={"pseudonym": "T", "mode": "potential"}, headers=a).json()["id"]
    assert client.post("/api/ext/link", json={"person_id": pid, "platform": "tinder", "chat_key": "m1"},
                       headers=a).status_code == 204
    batch = {"platform": "tinder", "chat_key": "m1", "tz": "UTC", "unit_id": "capture:tinder:m1:2026-11-23",
             "direction_uncertain": True, "messages": [{"ts_utc": "2026-11-20T18:00:00Z", "ts_precision": "second",
                                                         "direction": "incoming", "speaker_raw": "x", "text": "hi"}]}
    assert client.post("/api/ingest", json=batch, headers=a).status_code == 200
    sent = h.factory.ingested[-1][1]
    assert sent["unit_id"] == "capture:tinder:m1:2026-11-23" and sent["direction_uncertain"] is True
    bad = client.post("/api/ingest", json={**batch, "platform": "myspace"}, headers=a)
    assert bad.status_code == 422
    assert json.loads(client.get("/api/ext/summary", params={"platform": "bumble", "chat_key": "z"},
                                 headers=a).text)["linked"] is False
