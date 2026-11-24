import json

import pytest

from analyzer.agent.prompts import DISCLAIMER, SYSTEM_PROMPT, system_prompt
from analyzer.agent.tools import build_registry
from analyzer.service.facade import AgentUnavailable
from lvs_fakes import FakeGroq, say, tool_call, wa_export


def boot(make_factory, conn, events, script, import_chat=True):
    fake = FakeGroq(script)
    f = make_factory(fake)
    svc = f.for_user("u1", conn, events)
    p = svc.create_person("Sam", "potential", "UTC")
    if import_chat:
        svc.import_file(p["id"], "c.txt", wa_export(), "UTC", ["Alex"])
        assert f.wait_idle(30)
        fake.script[:] = script  # background runs before the test must not eat the script
        fake.calls.clear()
    return f, svc, p["id"], fake


def run(svc, tid, text="hi"):
    return list(svc.send_message(tid, text))


def test_tool_round_trip_streams_and_persists(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events,
                             [tool_call("get_person_overview", {}), say("Your style ", "match looks ok.")])
    tid = svc.create_thread(pid, "chat")["id"]
    ev = run(svc, tid, "how are we doing?")
    assert [e["type"] for e in ev] == ["tool_call", "tool_result", "token", "token", "done"]
    assert ev[0] == {"type": "tool_call", "name": "get_person_overview", "args": {}}
    assert ev[1]["ok"] is True and ev[1]["name"] == "get_person_overview"
    assert "".join(e["text"] for e in ev if e["type"] == "token") == "Your style match looks ok."
    # the tool result was fed back to the model
    second = fake.calls[1]["messages"]
    tool_msg = next(m for m in second if m["role"] == "tool")
    assert "success" in json.loads(tool_msg["content"]) and tool_msg["tool_call_id"] == "c1"
    # persisted: user, assistant(tool_calls), tool, assistant
    msgs = svc.get_thread(tid)["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "tool", "assistant"]
    assert msgs[1]["tool_calls"][0]["function"]["name"] == "get_person_overview"
    assert msgs[3]["content"] == "Your style match looks ok." and ev[-1]["message_id"] == msgs[3]["id"]
    # tool schemas follow the Groq/OpenAI function format
    t0 = fake.calls[0]["tools"][0]
    assert t0["type"] == "function" and {"name", "description", "parameters"} <= set(t0["function"])
    # history is replayed on the next turn
    fake.script.append(say("fine"))
    run(svc, tid, "thanks")
    roles = [m["role"] for m in fake.calls[-1]["messages"]]
    assert roles.count("user") == 2 and "tool" in roles


def test_tool_errors_returned_to_model(make_factory, conn, events):
    script = [tool_call("no_such_tool", {}), tool_call("propose_next_step",
              {"title": "t", "why": "w", "evidence_refs": [], "kind": "safety"}), say("done")]
    f, svc, pid, fake = boot(make_factory, conn, events, script)
    steps_before = svc.list_next_steps(pid)
    tid = svc.create_thread(pid, "chat")["id"]
    ev = run(svc, tid)
    results = [e for e in ev if e["type"] == "tool_result"]
    assert [r["ok"] for r in results] == [False, False] and ev[-1]["type"] == "done"
    second_tool = next(m for m in fake.calls[1]["messages"] if m["role"] == "tool")
    assert "error" in json.loads(second_tool["content"])
    assert svc.list_next_steps(pid) == steps_before  # the invalid proposal created nothing


def test_max_tool_rounds(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [])
    fake.script[:] = [tool_call("get_context", {}, cid=f"c{i}") for i in range(20)]
    tid = svc.create_thread(pid, "chat")["id"]
    ev = run(svc, tid)
    assert len(fake.calls) == 9 and fake.calls[-1]["tools"] == []  # 8 tool rounds, then a tool-free wrap-up
    assert sum(e["type"] == "tool_call" for e in ev) == 8 and ev[-1]["type"] == "done"
    assert svc.get_thread(tid)["messages"][-1]["role"] == "assistant"


def test_search_messages_hidden_when_setting_off(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [say("a"), say("b")])
    tid = svc.create_thread(pid, "chat")["id"]
    run(svc, tid)
    names = {t["function"]["name"] for t in fake.calls[0]["tools"]}
    assert "search_messages" in names and {"save_context_fact", "log_interaction",
                                           "get_interview_progress", "propose_next_step"} <= names
    svc.update_settings({"agent_reads_text": False})
    run(svc, tid)
    assert "search_messages" not in {t["function"]["name"] for t in fake.calls[1]["tools"]}
    reg = build_registry(svc, svc.get_settings(), pid)
    assert "search_messages" not in {t.name for t in reg}


def test_search_messages_tool(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events,
                             [tool_call("search_messages", {"query": "sounds good", "limit": 2}), say("ok")])
    tid = svc.create_thread(pid, "chat")["id"]
    run(svc, tid)
    out = json.loads(next(m for m in fake.calls[1]["messages"] if m["role"] == "tool")["content"])
    assert len(out["matches"]) == 2 and "sounds good" in out["matches"][0]["text"]


def test_agent_failure_yields_error_event(make_factory, conn, events):
    def boom(messages, tools):
        raise RuntimeError("network down with secret text")
    f, svc, pid, fake = boot(make_factory, conn, events, [boom])
    tid = svc.create_thread(pid, "chat")["id"]
    ev = run(svc, tid)
    assert ev[-1]["type"] == "error" and ev[-1]["code"] == "agent_error" and "secret" not in ev[-1]["message"]


def test_unavailable_without_key_or_when_factory_none(make_factory, conn, events):
    f = make_factory(None)
    svc = f.for_user("u", conn, events)
    p = svc.create_person("P", "potential", None)
    with pytest.raises(AgentUnavailable):
        svc.create_thread(p["id"], "chat")


def test_system_prompt_contains_rules():
    p = SYSTEM_PROMPT
    assert DISCLAIMER in p
    for phrase in ("Warnings only", "mention them once", "suggestions only", "Never offer to contact",
                   "do not help plan a confrontation or an exit", "Never claim to be a therapist",
                   "uncalibrated estimate: hand-set weights, not fitted to outcomes",
                   "Never state outcome probabilities", "monitor, track or", "talk, plan, reflect or pause"):
        assert phrase in p
    iv = system_prompt("interview")
    for phrase in ("exactly one question per turn", "skippable", "observable behaviour",
                   "No leading questions", "explicitly opts in", "covertly"):
        assert phrase in iv
    assert "log_interaction" in system_prompt("checkin")
    assert "cannot talk to the owner" in system_prompt("chat", background=True)


CONTROL = [{"text": t, "role": "them", "ts_utc": f"2025-03-0{i + 1}T10:00:00Z", "ts_precision": "second"}
           for i, t in enumerate(["Send me your live location right now " + "x" * 30,
                                  "Send me your live location again " + "y" * 30])]


def tool_payload(fake, call_idx=1):
    return json.loads(next(m for m in fake.calls[call_idx]["messages"] if m["role"] == "tool")["content"])


@pytest.mark.parametrize("reads_text", [True, False])
def test_safety_snippets_only_reach_model_when_text_allowed(make_factory, conn, events, reads_text):
    f, svc, pid, fake = boot(make_factory, conn, events, [tool_call("get_person_overview", {}), say("ok")])
    svc.import_messages(pid, "android_sms", "UTC", CONTROL)
    assert f.wait_idle(30)
    svc.update_settings({"agent_reads_text": reads_text})
    fake.script[:] = [tool_call("get_person_overview", {}), say("ok")]
    tid = svc.create_thread(pid, "chat")["id"]
    run(svc, tid)
    flags = tool_payload(fake)["safety"]["flags"]
    assert flags, "fixture should trigger a safety flag"
    assert all(bool(fl.get("snippets")) is reads_text for fl in flags)
    if not reads_text:
        assert "live location" not in json.dumps(fake.calls[1]["messages"])


def test_update_next_step_cannot_cross_people(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [])
    other = svc.create_person("Other", "potential", "UTC")["id"]
    theirs = svc._add_step_dedup(other, "talk", "t", "w", [])
    mine = svc._add_step_dedup(pid, "talk", "m", "w", [])
    fake.script[:] = [tool_call("update_next_step", {"id": theirs["id"], "status": "done"}, cid="a"),
                      tool_call("update_next_step", {"id": mine["id"], "status": "done"}, cid="b"), say("ok")]
    tid = svc.create_thread(pid, "chat")["id"]
    ev = run(svc, tid)
    assert [e["ok"] for e in ev if e["type"] == "tool_result"] == [False, True]
    status = {s["id"]: s["status"] for s in svc.list_next_steps(other) + svc.list_next_steps(pid)}
    assert status[theirs["id"]] == "open" and status[mine["id"]] == "done"


def test_search_limit_is_clamped(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [])
    assert len(svc.search_messages(pid, "sounds good", 0)) == 1
    assert len(svc.search_messages(pid, "sounds good", 10_000)) <= 50
    reg = {t.name: t for t in build_registry(svc, svc.get_settings(), pid)}
    assert len(reg["search_messages"].handler({"query": "sounds good", "limit": -5})["matches"]) == 1


def test_disconnect_mid_turn_does_not_poison_thread(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events,
                             [tool_call("get_person_overview", {}), say("never reached")])
    tid = svc.create_thread(pid, "chat")["id"]
    gen = svc.send_message(tid, "hello")
    assert next(gen)["type"] == "tool_call"
    gen.close()  # client went away before the tool ran
    msgs = svc.get_thread(tid)["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "tool"]
    assert json.loads(msgs[2]["content"]) == {"error": "interrupted"}
    fake.script[:] = [say("recovered")]
    ev = run(svc, tid, "are you there?")
    assert ev[-1]["type"] == "done" and "".join(e["text"] for e in ev if e["type"] == "token") == "recovered"
    sent = fake.calls[-1]["messages"]
    ids = {c["id"] for m in sent for c in m.get("tool_calls", [])}
    assert ids == {t["tool_call_id"] for t in sent if t["role"] == "tool"}


def test_history_repairs_old_poisoned_thread(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [say("fine")])
    tid = svc.create_thread(pid, "chat")["id"]
    svc._persist_message(tid, "user", "first")
    svc._persist_message(tid, "assistant", "", [{"id": "dangling", "type": "function",
                                                 "function": {"name": "get_context", "arguments": "{}"}}])
    svc._persist_message(tid, "tool", "{}", [{"tool_call_id": "orphan", "name": "x"}])
    ev = run(svc, tid, "second")
    assert ev[-1]["type"] == "done"
    sent = fake.calls[-1]["messages"]
    assert not any(m.get("tool_calls") for m in sent) and not any(m["role"] == "tool" for m in sent)
    assert [m["content"] for m in sent if m["role"] == "user"] == ["first", "second"]


def test_blank_final_round_is_not_persisted(make_factory, conn, events):
    f, svc, pid, fake = boot(make_factory, conn, events, [say("")], import_chat=False)
    tid = svc.create_thread(pid, "chat")["id"]
    evs = list(svc.send_message(tid, "hello"))
    assert evs[-1] == {"type": "done", "message_id": None}
    assert [m["role"] for m in svc.get_thread(tid)["messages"]] == ["user"]


def test_log_interaction_schema_has_explicit_fields(make_factory, conn, events):
    from analyzer.agent.tools import build_registry
    f, svc, pid, fake = boot(make_factory, conn, events, [], import_chat=False)
    spec = next(t for t in build_registry(svc, svc.get_settings(), pid) if t.name == "log_interaction")
    fields = spec.schema()["function"]["parameters"]["properties"]["fields"]
    assert {"ts", "initiated_by", "closeness_1_7", "comfort_1_7", "responsiveness"} <= set(fields["properties"])
    assert fields["properties"]["closeness_1_7"]["maximum"] == 7 and "ts" in fields["required"]
