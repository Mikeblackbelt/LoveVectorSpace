import json
from datetime import datetime, timedelta, timezone

import pytest

from analyzer.service.facade import AgentUnavailable, ChatNotLinked, InvalidInput, NotFound
from lvs_fakes import FakeGroq, wa_export

NOW = datetime.now(timezone.utc)


def fields(**kw):
    base = {"ts": (NOW - timedelta(days=1)).isoformat().replace("+00:00", "Z"), "initiated_by": "me",
            "closeness_1_7": 5, "comfort_1_7": 5}
    return {**base, **kw}


# ---- people ----------------------------------------------------------------
def test_people_crud(svc):
    p = svc.create_person("Pat", "potential", "America/New_York")
    assert set(p) == {"id", "pseudonym", "mode", "timezone", "created_at"} and p["created_at"].endswith("Z")
    assert svc.get_person(p["id"])["pseudonym"] == "Pat"
    assert svc.update_person(p["id"], pseudonym="Pat2", mode="established")["mode"] == "established"
    s = svc.list_people()[0]
    assert s["success"]["status"] == "insufficient_data" and s["safety"] == "none" and s["sources"] == []
    svc.delete_person(p["id"])
    assert svc.list_people() == []


def test_people_not_found_and_invalid(svc):
    for fn in (lambda: svc.get_person(99), lambda: svc.update_person(99, pseudonym="x"),
               lambda: svc.delete_person(99), lambda: svc.list_units(99), lambda: svc.coverage(99),
               lambda: svc.overview(99), lambda: svc.start_analysis(99)):
        with pytest.raises(NotFound):
            fn()
    with pytest.raises(InvalidInput):
        svc.create_person("", "potential", None)
    with pytest.raises(InvalidInput) as e:
        svc.create_person("x", "bogus", None)
    assert e.value.field == "mode"
    with pytest.raises(InvalidInput):
        svc.create_person("x", "potential", "Mars/Base")


# ---- import / units / speakers / coverage ----------------------------------
def test_preview_and_import(svc, factory, person):
    pv = svc.preview_import("chat.txt", wa_export())
    assert pv["format"] == "whatsapp" and pv["speakers"] == ["Alex", "Sam"] and pv["lines"] == 84
    assert pv["one_sided"] is False
    r = svc.import_file(person["id"], "chat.txt", wa_export(), "UTC", ["Alex"])
    assert set(r) == {"unit_id", "added", "merged", "skipped_non_english", "one_sided", "job_id"}
    assert r["added"] == 84 and r["one_sided"] is False
    assert factory.wait_idle(20)
    assert svc.job(r["job_id"])["status"] == "done"
    u = svc.list_units(person["id"])
    assert u[0]["message_count"] == 84 and u[0]["source"] == "whatsapp_import"
    assert svc.coverage(person["id"])[0]["source"] == "whatsapp_import"
    assert {m["role"] for m in svc.get_speakers(person["id"])} == {"me", "them"}


def test_import_requires_me_names_and_valid_file(svc, person):
    with pytest.raises(InvalidInput) as e:
        svc.import_file(person["id"], "c.txt", wa_export(), "UTC", [])
    assert e.value.field == "me_names"
    with pytest.raises(InvalidInput) as e:
        svc.import_file(person["id"], "c.txt", wa_export(), "UTC", ["Nobody"])
    assert e.value.field == "me_names"
    with pytest.raises(InvalidInput):
        svc.import_file(person["id"], "c.txt", b"not a chat", "UTC", ["Alex"])
    with pytest.raises(NotFound):
        svc.import_file(99, "c.txt", wa_export(), "UTC", ["Alex"])


def test_discord_import_is_one_sided(svc, person):
    raw = json.dumps([{"ID": "1", "Timestamp": "2025-01-01T10:00:00+00:00", "Contents": "hello there my friend"},
                      {"ID": "2", "Timestamp": "2025-01-01T10:01:00+00:00", "Contents": "how are you today"}])
    r = svc.import_file(person["id"], "messages.json", raw.encode(), "UTC", ["Alex"])
    assert r["one_sided"] is True


def test_delete_unit_and_speakers(svc, factory, loaded):
    pid, r = loaded
    sp = svc.get_speakers(pid)
    swapped = [{"source": m["source"], "speaker_raw": m["speaker_raw"],
                "role": "them" if m["role"] == "me" else "me"} for m in sp]
    out = svc.set_speakers(pid, swapped)
    assert {m["speaker_raw"]: m["role"] for m in out}["Alex"] == "them"
    with pytest.raises(InvalidInput):
        svc.set_speakers(pid, [{"source": "x", "speaker_raw": "y", "role": "bogus"}])
    res = svc.delete_unit(r["unit_id"])
    assert res["removed_messages"] == 84
    with pytest.raises(NotFound):
        svc.delete_unit("nope")


# ---- analysis ---------------------------------------------------------------
def test_overview_shape(svc, loaded):
    pid, _ = loaded
    o = svc.overview(pid)
    assert {"person", "mode", "generated_at", "success", "safety", "reciprocity", "metrics",
            "interaction_metrics", "scales", "weekly", "coverage_ratio", "skipped_non_english",
            "next_steps"} <= set(o)
    assert "_internal" not in o and "kind" not in o
    m = o["metrics"][0]
    assert {"id", "label", "plain_label", "value", "per_speaker", "evidence", "status", "note", "band"} <= set(m)
    plain = {x["id"]: x["plain_label"] for x in o["reciprocity"]}
    assert plain["initiation_share"] == "Who starts conversations"
    assert plain["message_share"] == "Who sends more" and plain["lsm"] == "Texting style match"
    assert plain["question_rate"] == "Questions asked" and plain["disclosure_rate"] == "Opening up"
    ids = {x["id"] for x in o["metrics"]}
    assert "toxicity_rate" in ids  # present (insufficient: model not installed)
    tox = next(x for x in o["metrics"] if x["id"] == "toxicity_rate")
    assert tox["status"] == "insufficient_data" and "not installed" in tox["note"]
    assert o["success"]["tag"].startswith("uncalibrated estimate")
    assert o["weekly"] and set(o["weekly"][0]) == {"week", "me", "them", "covered"}
    assert svc.list_people()[0]["updated_at"] is not None


def test_overview_not_found_before_analysis(svc, person):
    with pytest.raises(NotFound):
        svc.overview(person["id"])


def test_start_analysis_job_history_explain(svc, factory, loaded):
    pid, _ = loaded
    jid = svc.start_analysis(pid)
    assert factory.wait_idle(20)
    j = svc.job(jid)
    assert j["status"] == "done" and j["finished_at"].endswith("Z") and j["error"] is None
    h = svc.history(pid, "message_share")
    assert len(h) >= 2 and set(h[0]) == {"ts", "value"}
    assert svc.explain_metric("lsm")["id"] == "lsm"
    with pytest.raises(NotFound):
        svc.job(9999)
    with pytest.raises(NotFound):
        svc.explain_metric("nope")
    with pytest.raises(NotFound):
        svc.history(99, "lsm")


# ---- questionnaires ---------------------------------------------------------
def test_scales_and_questionnaires(svc, factory, loaded):
    pid, _ = loaded
    scales = {s["id"]: s for s in svc.list_scales()}
    assert "csi16" in scales and scales["csi16"]["items"][0]["display_text"]
    answers = {i["id"]: 4 for i in scales["reciprocity"]["items"]}
    res = svc.submit_questionnaire(pid, "reciprocity", answers)
    assert set(res) >= {"subscales", "bands", "cutoff_flags", "status", "notes"}
    hist = svc.questionnaire_history(pid)
    assert hist[0]["scale_id"] == "reciprocity" and hist[0]["submitted_at"].endswith("Z")
    assert factory.wait_idle(20)
    assert svc.overview(pid)["scales"][0]["scale_id"] == "reciprocity"
    with pytest.raises(NotFound):
        svc.submit_questionnaire(pid, "nope", {})
    with pytest.raises(InvalidInput) as e:
        svc.submit_questionnaire(pid, "reciprocity", {"reciprocity_01": 99})
    assert e.value.field == "reciprocity_01"


# ---- context ----------------------------------------------------------------
def test_facts(svc, person):
    pid = person["id"]
    f = svc.add_fact(pid, "met.how", "at a party", "owner_sure")
    assert f["source"] == "owner_edit" and f["updated_at"].endswith("Z")
    assert svc.update_fact(f["id"], value="at a cafe", confidence="owner_unsure")["confidence"] == "owner_unsure"
    assert svc.list_facts(pid)[0]["value"] == "at a cafe"
    svc.delete_fact(f["id"])
    assert svc.list_facts(pid) == []
    for fn in (lambda: svc.update_fact(99, value="x"), lambda: svc.delete_fact(99),
               lambda: svc.list_facts(99), lambda: svc.add_fact(99, "k", "v", "owner_sure")):
        with pytest.raises(NotFound):
            fn()
    with pytest.raises(InvalidInput):
        svc.add_fact(pid, "k", "v", "very_sure")


def test_interactions(svc, person):
    pid = person["id"]
    i = svc.add_interaction(pid, fields(place="park"), "nice")
    assert i["fields"]["ts"].endswith("Z") and i["notes"] == "nice" and i["person_id"] == pid
    assert svc.update_interaction(i["id"], fields={"closeness_1_7": 7}, notes="great")["fields"]["closeness_1_7"] == 7
    assert svc.update_interaction(i["id"], place="cafe")["fields"]["place"] == "cafe"
    assert len(svc.list_interactions(pid)) == 1
    svc.delete_interaction(i["id"])
    assert svc.list_interactions(pid) == []
    with pytest.raises(InvalidInput) as e:
        svc.add_interaction(pid, fields(closeness_1_7=11), "")
    assert e.value.field == "closeness_1_7"
    for fn in (lambda: svc.update_interaction(99), lambda: svc.delete_interaction(99),
               lambda: svc.add_interaction(99, fields(), ""), lambda: svc.list_interactions(99)):
        with pytest.raises(NotFound):
            fn()


# ---- next steps -------------------------------------------------------------
def test_next_steps_status_and_generate(svc, factory, loaded):
    pid, _ = loaded
    card = svc._add_step_dedup(pid, "talk", "Say hi", "why", ["metric:lsm"])
    assert set(card) == {"id", "kind", "title", "why", "evidence_refs", "status", "created_at"}
    assert svc.set_next_step_status(card["id"], "done")["status"] == "done"
    assert card["id"] not in [c["id"] for c in svc.list_next_steps(pid, "open")]
    assert card["id"] in [c["id"] for c in svc.list_next_steps(pid)]
    with pytest.raises(InvalidInput):
        svc.set_next_step_status(card["id"], "weird")
    with pytest.raises(NotFound):
        svc.set_next_step_status(999, "done")
    jid = svc.generate_next_steps(pid)
    assert factory.wait_idle(20) and svc.job(jid)["status"] == "done"
    with pytest.raises(NotFound):
        svc.generate_next_steps(99)


# ---- agent gating -----------------------------------------------------------
def test_agent_unavailable_without_key(svc, person):
    for fn in (lambda: svc.list_threads(person["id"]), lambda: svc.create_thread(person["id"], "chat"),
               lambda: svc.get_thread(1), lambda: svc.send_message(1, "hi"),
               lambda: svc.interview_progress(person["id"])):
        with pytest.raises(AgentUnavailable):
            fn()


def test_agent_unavailable_when_disabled(make_factory, conn, events):
    svc = make_factory(FakeGroq([])).for_user("u", conn, events)
    p = svc.create_person("P", "potential", None)
    svc.update_settings({"agent_enabled": False})
    with pytest.raises(AgentUnavailable):
        svc.create_thread(p["id"], "chat")


def test_threads_with_agent(make_factory, conn, events):
    svc = make_factory(FakeGroq([])).for_user("u", conn, events)
    p = svc.create_person("P", "potential", None)
    t = svc.create_thread(p["id"], "chat")
    assert set(t) == {"id", "kind", "title", "created_at", "updated_at"}
    th = svc.get_thread(t["id"])
    assert th["messages"] == [] and th["thread"]["id"] == t["id"]
    assert [x["id"] for x in svc.list_threads(p["id"])] == [t["id"]]
    with pytest.raises(NotFound):
        svc.get_thread(99)
    with pytest.raises(NotFound):
        svc.send_message(99, "hi")
    with pytest.raises(InvalidInput):
        svc.create_thread(p["id"], "weird")
    with pytest.raises(NotFound):
        svc.create_thread(99, "chat")


# ---- settings ---------------------------------------------------------------
def test_settings_defaults_and_patch(svc):
    s = svc.get_settings()
    assert s["theme"] == "signal" and s["text_size"] == "m" and s["reduce_motion"] is False
    assert s["contrast_boost"] is False and s["agent_enabled"] is True and s["agent_reads_text"] is True
    assert s["catchup_enabled"] is True and s["owner_timezone"] is None
    assert s["auto_theme"] == {"mode": "system", "day": "journal", "night": "signal",
                               "day_start": "07:00", "day_end": "19:00"}
    out = svc.update_settings({"theme": "crt", "reduce_motion": True, "auto_theme": {"mode": "time"},
                               "owner_timezone": "America/New_York"})
    assert out["theme"] == "crt" and out["reduce_motion"] is True and out["auto_theme"]["mode"] == "time"
    assert out["auto_theme"]["day"] == "journal"
    for bad in ({"theme": "neon"}, {"text_size": "xl"}, {"reduce_motion": "yes"}, {"bogus": 1},
                {"auto_theme": {"day_start": "7am"}}, {"owner_timezone": "Nowhere/X"}):
        with pytest.raises(InvalidInput):
            svc.update_settings(bad)


# ---- extension --------------------------------------------------------------
def batch(person_key="chat1", n=3, **kw):
    msgs = [{"platform_msg_id": f"m{i}", "ts_local": f"2025-03-09T{9 + i:02d}:15:00", "ts_precision": "minute",
             "direction": "outgoing" if i % 2 == 0 else "incoming", "speaker_raw": "x",
             "text": f"this is a fine message that we are sending today number {i}"} for i in range(n)]
    return {"platform": "whatsapp", "chat_key": person_key, "tz": "America/New_York", "messages": msgs, **kw}


def test_extension_flow(svc, person):
    pid = person["id"]
    assert svc.ext_people() == [{"id": pid, "pseudonym": "Sam"}]
    assert svc.ext_summary("whatsapp", "chat1")["linked"] is False
    with pytest.raises(ChatNotLinked):
        svc.ingest_capture(batch())
    svc.ext_link(pid, "whatsapp", "chat1")
    r = svc.ingest_capture(batch())
    assert r == {"added": 3, "merged": 0, "skipped": 0}
    assert svc.ingest_capture(batch()) == {"added": 0, "merged": 0, "skipped": 3}  # idempotent
    s = svc.ext_summary("whatsapp", "chat1")
    assert s["linked"] and s["person"] == {"id": pid, "pseudonym": "Sam"} and s["total"] == 3
    assert s["last_captured_ids"] and s["last_captured_ts"].endswith("Z")
    assert set(s) == {"linked", "person", "total", "today", "last7d", "my_share_30d", "last_captured_ts",
                      "last_captured_ids"}
    # local 09:15 New York is EDT (DST began 02:00 that day) = 13:15 UTC
    assert svc.list_units(pid)[0]["start_ts"].startswith("2025-03-09T13:15")
    assert svc.list_units(pid)[0]["unit_id"] == "capture:whatsapp:chat1:2025-03-09"
    svc.ext_unlink("whatsapp", "chat1")
    with pytest.raises(ChatNotLinked):
        svc.ingest_capture(batch())
    with pytest.raises(NotFound):
        svc.ext_link(99, "whatsapp", "k")
    with pytest.raises(InvalidInput):
        svc.ext_link(pid, "signal", "k")


def test_export(svc, loaded):
    pid, _ = loaded
    svc.add_fact(pid, "met.how", "x", "owner_sure")
    out = svc.export(False)
    assert out["people"][0]["facts"] and "messages" not in out["people"][0]
    assert len(svc.export(True)["people"][0]["messages"]) == 84
