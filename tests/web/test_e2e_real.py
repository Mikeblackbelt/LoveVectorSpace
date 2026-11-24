"""End-to-end through the HTTP API with the REAL ServiceFactoryImpl (tmp DATA_DIR, no Groq, no ONNX models)."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from analyzer.service.impl import ServiceFactoryImpl
from analyzer.web.app import create_app

from .conftest import FAST_PW, RecordingMailer, auth, make_settings

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "chats"


@pytest.fixture
def real(tmp_path, monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("MODELS_DIR", str(tmp_path / "no-models"))

    def build(**over):
        settings = make_settings(tmp_path, **over)
        factory = ServiceFactoryImpl.from_settings(settings, debounce_s=0.05)
        app = create_app(settings, factory, mailer=RecordingMailer(), passwords=FAST_PW)
        return app, factory
    return build


def test_full_flow_with_real_service(real):
    app, factory = real()
    acc = app.state.accounts
    assert factory.conn_opener is not None            # wired by create_app (create=False opener)
    with TestClient(app, base_url="https://testserver") as c:
        code = acc.invites.create("e2e-invite", None, None, 14)["code"]
        r = c.post("/api/auth/signup", json={"email": "e2e@example.com", "password": "Tangerine-Rocket-42",
                                             "invite_code": code}, headers={"X-Client": "native"})
        assert r.status_code == 201, r.text
        a = auth(r.json()["access_token"])

        pid = c.post("/api/people", json={"pseudonym": "Alex", "mode": "potential", "timezone": "America/New_York"},
                     headers=a).json()["id"]
        raw = (FIXTURES / "wa_us.txt").read_bytes()
        prev = c.post(f"/api/people/{pid}/imports/preview", files={"file": ("wa_us.txt", raw)}, headers=a)
        assert prev.status_code == 200 and "Sam" in prev.json()["speakers"], prev.text
        imp = c.post(f"/api/people/{pid}/imports", files={"file": ("wa_us.txt", raw)},
                     data={"tz": "America/New_York", "me_names": ["Alex"]}, headers=a)
        assert imp.status_code == 201, imp.text
        assert imp.json()["added"] > 0

        job = c.post(f"/api/people/{pid}/analyze", headers=a)
        assert job.status_code == 202
        assert factory.wait_idle(60)
        assert c.get(f"/api/jobs/{job.json()['job_id']}", headers=a).json()["status"] == "done"
        ov = c.get(f"/api/people/{pid}/overview", headers=a)
        assert ov.status_code == 200, ov.text
        body = ov.json()
        assert body["person"]["id"] == pid and "success" in body and "safety" in body

        ext = c.post("/api/tokens", json={"kind": "extension"}, headers=a).json()["token"]
        e = auth(ext)
        assert c.post("/api/ext/link", json={"person_id": pid, "platform": "whatsapp", "chat_key": "chat-alex"},
                      headers=e).status_code == 204
        batch = {"platform": "whatsapp", "chat_key": "chat-alex", "tz": "America/New_York", "messages": [
            {"platform_msg_id": f"m{i}", "ts_local": f"2026-11-2{i}T19:0{i}:00", "ts_precision": "minute",
             "direction": "outgoing" if i % 2 else "incoming", "speaker_raw": "Alex" if i % 2 else "Sam",
             "text": f"captured message number {i}"} for i in range(1, 5)]}
        ing = c.post("/api/ingest", json=batch, headers=e)
        assert ing.status_code == 200, ing.text
        assert ing.json()["added"] == 4
        s = c.get("/api/ext/summary", params={"platform": "whatsapp", "chat_key": "chat-alex"}, headers=e).json()
        assert s["linked"] is True and s["total"] >= 4 and s["person"]["id"] == pid
        assert "captured message" not in str(s)
        unlinked = c.post("/api/ingest", json={**batch, "chat_key": "other"}, headers=e)
        assert unlinked.status_code == 409 and unlinked.json()["error"]["code"] == "chat_not_linked"
        assert c.get(f"/api/people/{pid}/agent/threads", headers=a).status_code == 503   # no GROQ_API_KEY
        factory.wait_idle(30)


def test_seed_demo_judge_sees_overviews(real):
    app, factory = real(seed_demo=True, demo_password="demo-password-for-judges")
    with TestClient(app, base_url="https://testserver") as c:
        assert app.state.seed_done.wait(120)
        r = c.post("/api/auth/login", json={"email": "judge1@demo.lvs", "password": "demo-password-for-judges"})
        assert r.status_code == 200
        a = auth(r.json()["access_token"])
        people = c.get("/api/people", headers=a).json()
        assert {p["pseudonym"] for p in people} == {"Yu Cheng", "Sam", "Jordan"}
        for p in people:
            ov = c.get(f"/api/people/{p['id']}/overview", headers=a)
            assert ov.status_code == 200, (p["pseudonym"], ov.text)
            assert ov.json()["person"]["pseudonym"] == p["pseudonym"]
        # judge2 is a separate account with its own copy
        r2 = c.post("/api/auth/login", json={"email": "judge2@demo.lvs", "password": "demo-password-for-judges"})
        assert {p["pseudonym"] for p in c.get("/api/people", headers=auth(r2.json()["access_token"])).json()} == \
            {"Yu Cheng", "Sam", "Jordan"}


def test_partial_demo_seed_is_repaired_on_next_start(real):
    from analyzer.store.people import People
    app, factory = real(seed_demo=True, demo_password="demo-password-for-judges")
    acc = app.state.accounts
    with TestClient(app, base_url="https://testserver"):
        assert app.state.seed_done.wait(120)
        uid = acc.users.by_email("judge1@demo.lvs").id
        with acc.userdbs.use(uid) as h, h.lock:      # simulate a crash: Sam gone, Jordan never analysed,
            ppl = {p.pseudonym: p.id for p in People(h.conn).list()}   # Yu Cheng leftovers w/o marker
            People(h.conn).delete(ppl["Sam"])
            h.conn.execute("DELETE FROM snapshots WHERE person_id=? AND json_extract(data, '$.kind')='overview'",
                           (ppl["Jordan"],))
            h.conn.execute("DELETE FROM settings WHERE key='demo_seed:Yu Cheng'")
            h.conn.execute("DELETE FROM snapshots WHERE person_id=?", (ppl["Yu Cheng"],))
            h.conn.commit()
    app2, _ = real(seed_demo=True, demo_password="demo-password-for-judges")
    with TestClient(app2, base_url="https://testserver") as c:
        assert app2.state.seed_done.wait(120)
        r = c.post("/api/auth/login", json={"email": "judge1@demo.lvs", "password": "demo-password-for-judges"})
        a = auth(r.json()["access_token"])
        people = c.get("/api/people", headers=a).json()
        assert sorted(p["pseudonym"] for p in people) == ["Jordan", "Sam", "Yu Cheng"]
        for p in people:
            assert c.get(f"/api/people/{p['id']}/overview", headers=a).status_code == 200, p["pseudonym"]
