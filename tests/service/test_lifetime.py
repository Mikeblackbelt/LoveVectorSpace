"""Connection lifetime: close()/close_user()/shutdown() versus timers and queued background tasks."""
import threading
import time
from pathlib import Path

import pytest

from analyzer.service import analysis
from analyzer.service.impl import ServiceClosed, ServiceFactoryImpl
from analyzer.store.db import open_db
from analyzer.store.jobs import Jobs
from lvs_fakes import SCALES, Events, wa_export


def jobs(conn):
    return conn.execute("SELECT kind, status, error FROM jobs ORDER BY id").fetchall()


def new_factory(db, **kw):
    return ServiceFactoryImpl(SCALES, None, Path("no-models"), None, debounce_s=0.05,
                              conn_opener=lambda uid: open_db(db, "k"), **kw)


@pytest.fixture
def env(tmp_path):
    db = tmp_path / "u.db"
    conn = open_db(db, "k")
    f = new_factory(db)
    svc = f.for_user("u1", conn, Events())
    yield db, conn, f, svc
    f.shutdown(5)
    conn.close()


def test_timer_after_close_is_cancelled(env):
    db, conn, f, svc = env
    p = svc.create_person("Sam", "potential", "UTC")
    svc.schedule_reanalysis(p["id"])
    svc.close(2)
    time.sleep(0.25)
    assert jobs(conn) == []
    svc.schedule_reanalysis(p["id"])  # no-op once closed
    assert svc.closed and not svc._state.pending


def test_timer_already_fired_waiting_for_lock_noops_after_close(env):
    db, conn, f, svc = env
    p = svc.create_person("Sam", "potential", "UTC")
    with svc.lock:  # the API holds the per-user lock; the timer fires and blocks on it
        svc.schedule_reanalysis(p["id"], 0.01)
        time.sleep(0.2)
        assert svc._state.firing == 1
        svc.close(0.05)  # times out (the timer is blocked on our lock) but flags closed
    assert f.wait_idle(5)
    assert jobs(conn) == []


def test_timer_already_fired_waiting_for_lock_noops_after_shutdown(env):
    db, conn, f, svc = env
    p = svc.create_person("Sam", "potential", "UTC")
    with svc.lock:
        svc.schedule_reanalysis(p["id"], 0.01)
        time.sleep(0.2)
        f.shutdown(0.1)
    assert f.wait_idle(5)
    assert jobs(conn) == []


def test_submit_rejected_after_shutdown_and_jobs_recovered_as_cancelled(env):
    db, conn, f, svc = env
    p = svc.create_person("Sam", "potential", "UTC")
    job_id = svc.start_analysis(p["id"])
    run_id = Jobs(conn).create(p["id"], "analysis")
    Jobs(conn).update(run_id, "running")
    assert f.wait_idle(10)
    f.shutdown(2)
    with pytest.raises(ServiceClosed):
        f.submit(lambda: None)
    with pytest.raises(ServiceClosed):  # a shut-down service is unusable
        svc.start_analysis(p["id"])
    f2 = new_factory(db)
    try:
        svc2 = f2.for_user("u1", conn, Events())  # next open: unfinished jobs become errors
        assert svc2.job(job_id)["status"] == "done"
        j = svc2.job(run_id)
        assert j["status"] == "error" and j["error"] == "cancelled"
    finally:
        f2.shutdown(2)


def test_queued_task_noops_after_close(env):
    db, conn, f, svc = env
    p = svc.create_person("Sam", "potential", "UTC")
    gate = threading.Event()
    f.submit(gate.wait)  # occupy the single worker
    job_id = svc.start_analysis(p["id"])
    svc.close(0.05)
    gate.set()
    assert f.wait_idle(5)
    assert jobs(conn)[0][1] == "queued"  # never started
    assert job_id


def test_eviction_while_job_in_flight(env, monkeypatch):
    db, conn, f, svc = env
    p = svc.create_person("Sam", "potential", "UTC")
    svc.import_file(p["id"], "c.txt", wa_export(3), "UTC", ["Alex"])
    assert f.wait_idle(20)
    started, gate = threading.Event(), threading.Event()
    real = analysis.build_overview

    def slow(*a, **kw):
        started.set()
        gate.wait(5)
        return real(*a, **kw)
    monkeypatch.setattr(analysis, "build_overview", slow)
    job_id = svc.start_analysis(p["id"])
    assert started.wait(30)
    threading.Timer(0.2, gate.set).start()
    f.close_user("u1", timeout=5)  # waits for the in-flight task
    assert f._states.get("u1") is None  # state pruned
    with svc.lock:  # the API's own sequence: same lock around the connection close
        conn.close()
    c2 = open_db(db, "k")
    try:
        # the task's work finished after the close flag: it stopped without touching the closed service
        assert c2.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()[0] in ("running", "done")
        f3 = new_factory(db)
        svc3 = f3.for_user("u1", c2, Events())
        assert svc3.job(job_id)["status"] in ("done", "error")
        f3.shutdown(2)
    finally:
        c2.close()


def test_closed_service_rejects_use_and_never_reopens_db(env, tmp_path):
    db, conn, f, svc = env
    p = svc.create_person("Sam", "potential", "UTC")
    opened = []
    f.conn_opener = lambda uid: opened.append(uid) or open_db(db, "k")
    svc.close(1)
    with pytest.raises(ServiceClosed):
        svc.list_people()
    assert opened == []
