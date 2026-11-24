from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import numpy as np

from analyzer.service import analysis
from analyzer.service.material import material_change
from lvs_fakes import wa_export
from test_facade import batch  # noqa


def jobs_of(conn, kind):
    return conn.execute("SELECT status FROM jobs WHERE kind=?", (kind,)).fetchall()


def test_ingest_debounce_snapshot_events(factory, svc, conn, events, person):
    pid = person["id"]
    svc.ext_link(pid, "whatsapp", "c1")
    svc.ingest_capture(batch("c1", n=30))
    svc.ingest_capture(batch("c1", n=30))  # second ingest inside the window adds no second job
    assert svc.list_next_steps(pid) == []
    assert factory.wait_idle(20)
    assert len(jobs_of(conn, "reanalysis")) == 1 and jobs_of(conn, "reanalysis")[0][0] == "done"
    assert svc.overview(pid)["mode"] == "potential"
    kinds = events.types()
    assert "ingest" in kinds and "snapshot" in kinds and "job" in kinds
    assert all(e["person_id"] == pid for _, e in events.items)
    assert all(u == "u1" for u, _ in events.items)


def test_run_now_bypasses_debounce(make_factory, conn, events):
    f = make_factory(debounce_s=3600)
    svc = f.for_user("u1", conn, events)
    p = svc.create_person("P", "potential", "UTC")
    svc.ext_link(p["id"], "whatsapp", "c1")
    svc.ingest_capture(batch("c1", n=30))
    assert f._states["u1"].pending  # timer waiting an hour
    jid = svc.run_now(p["id"])
    assert f.wait_idle(20)
    assert svc.job(jid)["status"] == "done" and svc.overview(p["id"])["person"]["id"] == p["id"]
    assert not f._states["u1"].pending


def test_failed_job_records_error(factory, svc, person, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret message text")
    monkeypatch.setattr(analysis, "compute_overview", boom)
    jid = svc.start_analysis(person["id"])
    assert factory.wait_idle(20)
    j = svc.job(jid)
    assert j["status"] == "error" and "secret" not in j["error"]


def _ov(bands=None, scales=None, sev="none", cps=None):
    return {"metrics": [{"status": "ok"}], "scales": scales or [],
            "safety": {"flags": [] if sev == "none" else [{"severity": sev}]},
            "_internal": {"bands": bands or {"message_share": "balanced"}, "change_points": cps or []}}


def test_material_change_rules():
    now = datetime.now(timezone.utc)
    recent = now - timedelta(days=1)
    base = _ov()
    assert material_change(base, _ov(), recent, now) is False
    assert material_change(base, _ov(bands={"message_share": "they lead"}), recent, now) is True
    assert material_change(base, _ov(cps=["message_share"]), recent, now) is True
    assert material_change(base, _ov(sev="concern"), recent, now) is True
    scale = [{"scale_id": "csi16", "subscales": {"total": 50}}]
    assert material_change(base, _ov(scales=scale), recent, now) is True
    assert material_change(_ov(scales=scale), _ov(scales=scale), recent, now) is False
    assert material_change(base, _ov(), now - timedelta(days=8), now) is True
    assert material_change(base, _ov(), None, now) is True
    assert material_change(None, _ov(), recent, now) is True


def test_unchanged_reanalysis_is_not_material(factory, svc, loaded):
    pid, _ = loaded
    assert factory.wait_idle(20)
    assert svc.analyze_now(pid)["_material"] is False  # same data, cards created < 7 days ago


class FakeClf:
    def __init__(self, labels):
        self.labels, self.seen = labels, []

    def predict(self, texts):
        self.seen += texts
        return np.full((len(texts), len(self.labels)), 0.1, dtype=np.float32)


def test_model_scoring_window_and_note(factory, svc, person, monkeypatch):
    start = datetime.now(timezone.utc) - timedelta(days=150)
    svc.import_file(person["id"], "c.txt", wa_export(n_days=150, start=start, per_day=4), "UTC", ["Alex"])
    assert factory.wait_idle(30)
    emo, tox = FakeClf(["joy", "anger"]), FakeClf(["toxic", "insult"])
    factory._clf = SimpleNamespace(emotion=emo, toxicity=tox)
    o = svc.overview(person["id"])
    svc.analyze_now(person["id"])
    n_recent = 90 * 4 + 4
    assert 0 < len(emo.seen) <= n_recent < 600  # only the last 90 days of 600 messages scored
    assert len(tox.seen) <= n_recent
    monkeypatch.setattr(analysis, "MAX_SCORED", 10)
    emo.seen.clear()
    from analyzer.store.scores import Scores  # cache: ids scored before are not re-predicted
    conn = svc.conn
    conn.execute("DELETE FROM message_scores"); conn.commit()
    svc.analyze_now(person["id"])
    assert len(emo.seen) <= 10
    new = svc.overview(person["id"])
    emo_m = [m for m in new["metrics"] if m["id"].startswith("emotion_share")]
    assert emo_m and "most recent 90 days" in emo_m[0]["note"]
    assert "most recent 90 days" in next(m for m in new["metrics"] if m["id"] == "toxicity_rate")["note"]


def test_old_change_point_in_window_is_not_material_every_run():
    now = datetime.now(timezone.utc)
    recent = now - timedelta(days=1)
    old = _ov(cps=["message_share@2025-03-03"])
    assert material_change(old, _ov(cps=["message_share@2025-03-03"]), recent, now) is False
    assert material_change(old, _ov(cps=["message_share@2025-03-10"]), recent, now) is True
