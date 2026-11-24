import json
from datetime import datetime, timedelta, timezone

from analyzer.agent.checkins import checkin_triggers
from analyzer.agent.interview import INTERVIEW_TOPICS, topics_for
from analyzer.agent.next_steps import generate_next_steps
from analyzer.store._base import fmt
from analyzer.store.snapshots import Snapshots
from lvs_fakes import say, tool_call, wa_export
from test_agent import boot, run

CARD = {"title": "Suggest a plan", "why": "You start most chats.", "evidence_refs": ["metric:initiation_share"],
        "kind": "plan"}


def test_completed_analysis_refreshes_next_steps_capped_per_10_minutes(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [], import_chat=False)
    fake.script[:] = [tool_call("propose_next_step", CARD), say("done")]
    svc.import_file(pid, "c.txt", wa_export(), "UTC", ["Alex"])  # first analysis is material
    assert f.wait_idle(30)
    assert len(fake.calls) == 2
    assert [s["kind"] for s in svc.list_next_steps(pid) if s["kind"] == "plan"] == ["plan"]
    assert "next_steps" in events.types()
    n = len(fake.calls)
    svc.start_analysis(pid)  # within 10 minutes of the last auto run: capped
    assert f.wait_idle(30)
    assert len(fake.calls) == n
    conn.execute("UPDATE settings SET value=? WHERE key=?",
                 (json.dumps(fmt(datetime(2000, 1, 1, tzinfo=timezone.utc))), f"next_steps_auto_at:{pid}")); conn.commit()
    fake.script[:] = [say("none")]
    svc.submit_questionnaire(pid, "reciprocity", {i: 4 for i in (
        "reciprocity_01", "reciprocity_02", "reciprocity_03", "reciprocity_04", "reciprocity_05",
        "reciprocity_06")})   # a questionnaire (even with unchanged data) refreshes once the cap has passed
    assert f.wait_idle(30)
    assert len(fake.calls) == n + 1


def test_auto_cap_and_on_demand_unlimited(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [say("none"), say("none"), say("none")])
    # boot's import already used today's auto-run for this person
    assert generate_next_steps(svc, pid, on_demand=False) == [] and fake.calls == []
    conn.execute("DELETE FROM settings WHERE key LIKE 'next_steps_auto_at:%'"); conn.commit()
    generate_next_steps(svc, pid, on_demand=False)
    assert len(fake.calls) == 1
    assert generate_next_steps(svc, pid, on_demand=False) == [] and len(fake.calls) == 1  # capped
    generate_next_steps(svc, pid, on_demand=True)
    generate_next_steps(svc, pid, on_demand=True)
    assert len(fake.calls) == 3
    other = svc.create_person("Other", "potential", None)["id"]  # a different person has their own cap
    fake.script.append(say("none"))
    generate_next_steps(svc, other, on_demand=False)
    assert len(fake.calls) == 4


def test_duplicate_cards_dropped(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events,
                             [tool_call("propose_next_step", CARD), say("x"),
                              tool_call("propose_next_step", {**CARD, "title": "Different title"}), say("y")])
    generate_next_steps(svc, pid, on_demand=True)
    new = generate_next_steps(svc, pid, on_demand=True)  # same kind + same evidence refs within 14 days
    plans = [s for s in svc.list_next_steps(pid) if s["kind"] == "plan"]
    assert len(plans) == 1 and not [c for c in new if c["kind"] == "plan"]
    second = json.loads(next(m for m in fake.calls[3]["messages"] if m["role"] == "tool")["content"])
    assert second.get("duplicate") is True
    svc.set_next_step_status(plans[0]["id"], "dismissed")  # a dismissed card still blocks duplicates
    fake.script[:] = [tool_call("propose_next_step", {**CARD, "title": "Again"}), say("z")]
    generate_next_steps(svc, pid, on_demand=True)
    assert len([s for s in svc.list_next_steps(pid) if s["kind"] == "plan"]) == 1


def test_no_safety_kind_cards(make_factory, conn, events):
    bad = {**CARD, "kind": "safety"}
    f, svc, pid, fake = boot(make_factory, conn, events, [tool_call("propose_next_step", bad), say("ok")])
    generate_next_steps(svc, pid, on_demand=True)
    assert all(s["kind"] in ("talk", "plan", "reflect", "pause") for s in svc.list_next_steps(pid))
    assert not [s for s in svc.list_next_steps(pid) if s["title"] == CARD["title"]]
    spec = next(t for t in fake.calls[0]["tools"] if t["function"]["name"] == "propose_next_step")
    assert spec["function"]["parameters"]["properties"]["kind"]["enum"] == ["talk", "plan", "reflect", "pause"]


def test_background_mode_cannot_write_facts(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events,
                             [tool_call("save_context_fact", {"key": "met.how", "value": "x"}), say("ok")])
    generate_next_steps(svc, pid, on_demand=True)
    names = {t["function"]["name"] for t in fake.calls[0]["tools"]}
    assert "save_context_fact" not in names and "log_interaction" not in names
    assert "propose_next_step" in names and "get_person_overview" in names
    assert svc.list_facts(pid) == []
    assert svc.list_threads(pid) == []  # background runs leave no thread


def test_agent_disabled_skips_llm_but_checkin_cards_still_work(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [say("none")])
    svc.update_settings({"agent_enabled": False})
    generate_next_steps(svc, pid, on_demand=True)
    assert fake.calls == [] and any(c["kind"] == "reflect" for c in svc.list_next_steps(pid))


# ---- interview ----------------------------------------------------------------
def test_interview_has_no_safety_topics():
    for mode, ids in INTERVIEW_TOPICS.items():
        assert not [i for i in ids if "safety" in i or "abuse" in i or "cdaq" in i]
        for tid, label, q in topics_for(mode):
            assert "safe" not in (label + q).lower() and "abus" not in (label + q).lower()
    assert {"met", "known", "inperson", "goals", "unsure", "suggests", "signals"} <= set(INTERVIEW_TOPICS["potential"])
    assert {"stage", "living", "going_well", "disagreements", "stressors", "plans"} <= set(
        INTERVIEW_TOPICS["established"])


def test_interview_resumes_at_first_open_topic(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [], import_chat=False)
    first = svc.create_thread(pid, "interview")
    msgs = svc.get_thread(first["id"])["messages"]
    assert [m["role"] for m in msgs] == ["assistant"] and "How did you two meet" in msgs[0]["content"]
    assert svc.interview_progress(pid)["open"][0] == "met"
    fake.script[:] = [tool_call("save_context_fact", {"key": "met.how", "value": "a party",
                                                       "confidence": "owner_unsure"}), say("Thanks!")]
    run(svc, first["id"], "we met at a party")
    fact = svc.list_facts(pid)[0]
    assert fact["key"] == "met.how" and fact["source"] == "interview" and fact["confidence"] == "owner_unsure"
    prog = svc.interview_progress(pid)
    assert prog["covered"] == ["met"] and prog["open"][0] == "known"
    assert {t["id"] for t in prog["topics"]} == set(INTERVIEW_TOPICS["potential"])
    resumed = svc.create_thread(pid, "interview")
    first_q = svc.get_thread(resumed["id"])["messages"][0]["content"]
    assert "How long have you known" in first_q and "left off" in first_q
    fake.script[:] = [tool_call("save_context_fact", {"key": "known.skipped", "value": "skipped"}), say("ok")]
    run(svc, resumed["id"], "skip")  # skipping a topic counts as covered
    assert "known" in svc.interview_progress(pid)["covered"]
    fake.script[:] = [tool_call("save_context_fact", {"key": "safety.hit", "value": "x"}), say("ok")]
    ev = run(svc, resumed["id"], "hm")  # the agent cannot collect safety facts
    assert [e["ok"] for e in ev if e["type"] == "tool_result"] == [False]


# ---- check-ins ---------------------------------------------------------------
def test_hangout_checkin_logs_interaction_fields(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [], import_chat=False)
    t = svc.create_thread(pid, "checkin")
    assert "hangout" in svc.get_thread(t["id"])["messages"][0]["content"].lower()
    ts = (datetime.now(timezone.utc) - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    fields = {"ts": ts, "place": "the park", "duration_min": 90, "initiated_by": "them", "activity": "walk",
              "closeness_1_7": 6, "comfort_1_7": 5, "responsiveness": ["asked about my week"],
              "next_plan_proposed_by": "me", "followed_through_prev": True}
    fake.script[:] = [tool_call("log_interaction", {"fields": fields, "notes": "good one"}), say("Logged.")]
    run(svc, t["id"], "we walked in the park")
    i = svc.list_interactions(pid)[0]
    assert i["fields"]["closeness_1_7"] == 6 and i["fields"]["initiated_by"] == "them"
    assert i["fields"]["followed_through_prev"] is True and i["notes"] == "good one"
    assert "Hangout check-in" in fake.calls[0]["messages"][0]["content"]


def test_checkin_trigger_after_10_days(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [say("n")])
    drafts = checkin_triggers(svc, pid)
    assert [d["kind"] for d in drafts] == ["reflect"] and "10 days" in drafts[0]["why"]
    svc.add_interaction(pid, {"ts": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
                              "initiated_by": "me", "closeness_1_7": 4, "comfort_1_7": 4}, "")
    assert checkin_triggers(svc, pid) == []
    other = svc.create_person("Quiet", "potential", None)["id"]  # no recent chat: never triggers
    assert checkin_triggers(svc, other) == []


def test_checkin_trigger_on_message_share_band_change(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [], import_chat=False)
    snaps = Snapshots(conn)
    snaps.save(pid, {"kind": "overview", "_internal": {"bands": {"message_share": "balanced"}}})
    assert checkin_triggers(svc, pid) == []
    snaps.save(pid, {"kind": "overview", "_internal": {"bands": {"message_share": "they lead"}}})
    d = checkin_triggers(svc, pid)
    assert d and d[0]["kind"] == "reflect" and d[0]["evidence_refs"] == ["metric:message_share"]
    assert "balanced" in d[0]["why"] and "they lead" in d[0]["why"]
