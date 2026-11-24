"""Review-fix coverage: capture chunking/roles, from_settings, logging hygiene, small behaviours."""
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from analyzer.service.impl import ServiceFactoryImpl
from analyzer.store.messages import MessageStore
from lvs_fakes import FakeGroq, say, tool_call, wa_export
from test_facade import batch


def test_direction_sets_role(svc, person):
    pid = person["id"]
    svc.ext_link(pid, "whatsapp", "chat1")
    svc.ingest_capture(batch("chat1", n=4))
    roles = [m["role"] for m in svc.export(True)["people"][0]["messages"]]
    assert roles == ["me", "them", "me", "them"]  # outgoing -> me, incoming -> them


def test_large_capture_batch_is_chunked(svc, person, monkeypatch):
    pid = person["id"]
    svc.ext_link(pid, "whatsapp", "big")
    t0 = datetime(2025, 1, 1, tzinfo=timezone.utc)
    msgs = [{"platform_msg_id": f"m{i}", "ts_utc": (t0 + timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "ts_precision": "minute", "direction": "outgoing" if i % 2 else "incoming", "speaker_raw": "x",
             "text": f"this is a perfectly fine message that we are sending, number {i}"} for i in range(10_000)]
    sizes = []
    real = MessageStore.ingest

    def spy(self, person_id, ms, unit_id):
        sizes.append(len(ms))
        return real(self, person_id, ms, unit_id)
    monkeypatch.setattr(MessageStore, "ingest", spy)
    r = svc.ingest_capture({"platform": "whatsapp", "chat_key": "big", "tz": "UTC", "unit_id": "capture:big",
                            "messages": msgs})
    assert r["added"] == 10_000 and sum(sizes) == 10_000
    assert len(sizes) >= 5 and max(sizes) <= 2100  # never one giant transaction
    assert sum(u["message_count"] for u in svc.list_units(pid)) == 10_000


def test_auto_run_allowed_stores_passed_now(svc, person):
    pid = person["id"]
    t = datetime(2030, 5, 5, 12, 0, tzinfo=timezone.utc)
    assert svc._auto_run_allowed(pid, t) is True
    assert svc._auto_run_allowed(pid, t + timedelta(minutes=5)) is False
    assert svc._auto_run_allowed(pid, t + timedelta(minutes=11)) is True


def test_safety_fact_changes_schedule_reanalysis(svc, factory, person):
    pid = person["id"]
    f = svc.add_fact(pid, "safety.fear", "yes", "owner_sure")
    assert factory.wait_idle(10)
    n = lambda: svc.conn.execute("SELECT COUNT(*) FROM jobs WHERE kind='reanalysis'").fetchone()[0]
    assert n() == 1
    svc.update_fact(f["id"], value="no")
    assert factory.wait_idle(10) and n() == 2
    svc.delete_fact(f["id"])
    assert factory.wait_idle(10) and n() == 3
    plain = svc.add_fact(pid, "met.how", "party", "owner_sure")
    svc.update_fact(plain["id"], value="work")
    assert factory.wait_idle(10) and n() == 3


def test_safety_dates_are_iso_datetimes_and_export_has_no_dead_keys(svc, factory, person):
    pid = person["id"]
    ts = [{"text": "Send me your live location right now", "role": "them",
           "ts_utc": f"2025-03-0{i}T10:00:00Z", "ts_precision": "second"} for i in (1, 2)]
    svc.import_messages(pid, "android_sms", "UTC", ts)
    assert factory.wait_idle(30)
    flag = svc.overview(pid)["safety"]["flags"][0]
    assert flag["first_seen"] == "2025-03-01T00:00:00Z" and flag["last_seen"] == "2025-03-02T00:00:00Z"
    ex = svc.export(False)
    assert "scale_results" not in ex and "overviews" not in ex and "scale_results" in ex["people"][0]


def test_from_settings_wires_paths_and_groq(monkeypatch, tmp_path):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    f = ServiceFactoryImpl.from_settings(SimpleNamespace(groq_api_key=None))
    assert f.models_dir.name == "models" and f.groq_client_factory is None  # agent off without a key
    assert "cdaq_items" in f.scales
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    monkeypatch.setattr("analyzer.agent.groq_client.GroqClient.__init__", lambda self, *a, **k: None)
    f2 = ServiceFactoryImpl.from_settings(SimpleNamespace())
    assert callable(f2.groq_client_factory) and f2.groq_client_factory() is not None
    (tmp_path / "scale_items").mkdir()
    assert ServiceFactoryImpl.from_settings(SimpleNamespace(), debounce_s=1).debounce_s == 1
    f.shutdown(1), f2.shutdown(1)


SECRETS = ["sounds good to me and we can talk", "ZEBRA-FACT-VALUE", "PLATYPUS-REPLY", "OCELOT-NOTE"]


def test_no_private_text_in_logs(make_factory, conn, events, caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    fake = FakeGroq([tool_call("save_context_fact", {"key": "met.how", "value": "ZEBRA-FACT-VALUE"}),
                     tool_call("search_messages", {"query": "sounds good"}, cid="c2"),
                     tool_call("bad_tool_PLATYPUS", {}, cid="c3"), say("PLATYPUS-REPLY")])
    f = make_factory(fake)
    svc = f.for_user("u1", conn, events)
    pid = svc.create_person("Sam", "potential", "UTC")["id"]
    svc.import_file(pid, "c.txt", wa_export(), "UTC", ["Alex"])
    assert f.wait_idle(30)
    svc.add_interaction(pid, {"ts": "2025-03-01T10:00:00Z", "place": "OCELOT-NOTE", "duration_min": 30,
                              "initiated_by": "me", "closeness_1_7": 4, "comfort_1_7": 4}, "OCELOT-NOTE")
    fake.script[:] = [tool_call("save_context_fact", {"key": "met.how", "value": "ZEBRA-FACT-VALUE"}),
                      tool_call("search_messages", {"query": "sounds good"}, cid="c2"),
                      tool_call("bad_tool_PLATYPUS", {}, cid="c3"), say("PLATYPUS-REPLY")]
    tid = svc.create_thread(pid, "chat")["id"]
    list(svc.send_message(tid, "OCELOT-NOTE hello"))
    from analyzer.service import analysis

    def boom(*a, **k):
        raise RuntimeError("sounds good to me and we can talk ZEBRA-FACT-VALUE")
    monkeypatch.setattr(analysis, "build_overview", boom)
    svc.start_analysis(pid)
    assert f.wait_idle(20)
    for s in SECRETS:
        assert s not in caplog.text, s
