"""Model scoring runs without the per-user lock, is capped per run, and drops results for deleted people."""
import threading
from types import SimpleNamespace

import numpy as np
import pytest

from analyzer.service import analysis
from analyzer.service.facade import NotFound
from lvs_fakes import wa_export


class GateClf:
    """Fake toxicity classifier that blocks inside predict until `gate` is set."""

    def __init__(self, block=True):
        self.labels = ["toxic", "insult"]
        self.started, self.gate = threading.Event(), threading.Event()
        self.calls: list[int] = []
        if not block:
            self.gate.set()

    def predict(self, texts):
        self.started.set()
        assert self.gate.wait(10), "test never released the scorer"
        self.calls.append(len(texts))
        return np.full((len(texts), len(self.labels)), 0.1, dtype=np.float32)


def _imported(svc, factory, person, **kw):
    svc.import_file(person["id"], "c.txt", wa_export(**kw), "UTC", ["Alex"])
    assert factory.wait_idle(20)  # first analysis without models
    return person["id"]


def _in_thread(fn):
    out: dict = {}

    def run():
        try:
            out["value"] = fn()
        except BaseException as e:  # noqa: BLE001 - handed back to the test
            out["error"] = e
    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t, out


def test_list_people_completes_while_scoring(factory, svc, person):
    pid = _imported(svc, factory, person)
    clf = GateClf()
    factory._clf = SimpleNamespace(emotion=None, toxicity=clf)
    t, out = _in_thread(lambda: svc.analyze_now(pid))
    assert clf.started.wait(10)
    t2, out2 = _in_thread(svc.list_people)       # same user, same lock: must not wait for the model
    t2.join(5)
    assert not t2.is_alive() and [p["id"] for p in out2["value"]] == [pid]
    clf.gate.set()
    t.join(10)
    assert "error" not in out, out.get("error")
    tox = next(m for m in out["value"]["metrics"] if m["id"] == "toxicity_rate")
    assert tox["status"] == "ok" and "queued" not in tox["note"]
    n = svc.conn.execute("SELECT COUNT(*) FROM message_scores").fetchone()[0]
    assert n == len(svc.conn.execute("SELECT id FROM messages").fetchall())


def test_person_deleted_mid_score_discards_results(factory, svc, person):
    pid = _imported(svc, factory, person)
    clf = GateClf()
    factory._clf = SimpleNamespace(emotion=None, toxicity=clf)
    snaps_before = svc.conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
    t, out = _in_thread(lambda: svc.analyze_now(pid))
    assert clf.started.wait(10)
    svc.delete_person(pid)                       # the lock is free while the model runs
    clf.gate.set()
    t.join(10)
    assert isinstance(out.get("error"), NotFound)
    assert svc.conn.execute("SELECT COUNT(*) FROM message_scores").fetchone()[0] == 0
    assert svc.conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] <= snaps_before
    assert svc.list_people() == []


def test_job_for_person_deleted_mid_score_ends_cleanly(factory, svc, person):
    pid = _imported(svc, factory, person)
    clf = GateClf()
    factory._clf = SimpleNamespace(emotion=None, toxicity=clf)
    svc.start_analysis(pid)
    assert clf.started.wait(10)
    svc.delete_person(pid)
    clf.gate.set()
    assert factory.wait_idle(20)
    assert svc.conn.execute("SELECT COUNT(*) FROM message_scores").fetchone()[0] == 0


def test_closed_service_mid_score_writes_nothing(factory, svc, person):
    pid = _imported(svc, factory, person)
    clf = GateClf()
    factory._clf = SimpleNamespace(emotion=None, toxicity=clf)
    t, out = _in_thread(lambda: svc.analyze_now(pid))
    assert clf.started.wait(10)
    closer = threading.Thread(target=lambda: svc.close(timeout=0.2))
    closer.start()
    closer.join(5)
    clf.gate.set()
    t.join(10)
    assert type(out.get("error")).__name__ == "ServiceClosed"
    assert svc.conn.execute("SELECT COUNT(*) FROM message_scores").fetchone()[0] == 0


@pytest.mark.parametrize("cap", [10])
def test_scoring_is_capped_per_run_and_backlog_follows_up(factory, svc, person, monkeypatch, cap):
    pid = _imported(svc, factory, person, n_days=10, per_day=4)   # 40 messages
    monkeypatch.setattr(analysis, "MAX_SYNC_SCORED", cap)
    clf = GateClf(block=False)
    factory._clf = SimpleNamespace(emotion=None, toxicity=clf)
    first = svc.analyze_now(pid)
    assert clf.calls == [cap] and first["_backlog"] == 40 - cap
    tox = next(m for m in first["metrics"] if m["id"] == "toxicity_rate")
    assert f"{cap} of 40 scored so far" in tox["note"]
    assert factory.wait_idle(30)                 # debounced follow-up runs score the rest, then stop
    assert all(c <= cap for c in clf.calls) and sum(clf.calls) == 40
    assert svc.conn.execute("SELECT COUNT(*) FROM message_scores").fetchone()[0] == 40
    assert "queued" not in next(m for m in svc.overview(pid)["metrics"] if m["id"] == "toxicity_rate")["note"]


def test_5000_message_export_never_freezes_the_account(factory, svc, person):
    import time
    pid = _imported(svc, factory, person, n_days=84, per_day=60)   # 5,040 messages
    clf = GateClf()
    factory._clf = SimpleNamespace(emotion=None, toxicity=clf)
    svc.start_analysis(pid)
    assert clf.started.wait(20)
    t0 = time.monotonic()
    assert [p["id"] for p in svc.list_people()] == [pid]           # the account stays usable mid-scoring
    svc.overview(pid)
    svc.list_units(pid)
    assert time.monotonic() - t0 < 5
    clf.gate.set()
    assert factory.wait_idle(120)
    assert clf.calls and max(clf.calls) <= analysis.MAX_SYNC_SCORED and sum(clf.calls) == analysis.MAX_SCORED
    assert len(clf.calls) == analysis.MAX_SCORED // analysis.MAX_SYNC_SCORED
    prog = svc.overview(pid)["scoring"]
    assert prog == {"scored": analysis.MAX_SCORED, "total": analysis.MAX_SCORED, "complete": True}


def test_partial_progress_is_reported(factory, svc, person, monkeypatch):
    pid = _imported(svc, factory, person, n_days=10, per_day=4)
    monkeypatch.setattr(analysis, "MAX_SYNC_SCORED", 15)
    factory._clf = SimpleNamespace(emotion=None, toxicity=GateClf(block=False))
    data = svc.analyze_now(pid)
    assert data["scoring"] == {"scored": 15, "total": 40, "complete": False}
