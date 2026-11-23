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
    tid = svc.create_thread(pid, "chat")["id"]
    ev = run(svc, tid)
    results = [e for e in ev if e["type"] == "tool_result"]
    assert [r["ok"] for r in results] == [False, False] and ev[-1]["type"] == "done"
    second_tool = next(m for m in fake.calls[1]["messages"] if m["role"] == "tool")
    assert "error" in json.loads(second_tool["content"])
    assert svc.list_next_steps(pid) == [] or all(s["kind"] != "safety" for s in svc.list_next_steps(pid))


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
