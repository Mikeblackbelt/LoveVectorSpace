"""Agent loop: streaming Groq chat with tool calls, persisted messages, max 8 tool rounds.

Logging policy: nothing from message text, fact values or agent content is ever logged.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator

from analyzer.service.facade import InvalidInput, NotFound

from .prompts import system_prompt
from .tools import ToolSpec, build_registry

log = logging.getLogger("analyzer.agent")
MAX_TOOL_ROUNDS = 8
HISTORY_LIMIT = 40
FALLBACK_TEXT = "I got stuck gathering information. Let's pick this up again; what would you like to focus on?"


def _context_message(svc, pid: int) -> str:
    try:
        o = svc.overview(pid)
    except NotFound:
        return f"Context: person {pid}; no analysis yet."
    s = o["success"]
    head = ("headline: insufficient data" if s["status"] != "ok" else
            f"headline: {s['percent']}% (range {s['low']} to {s['high']}), tag: {s['tag']}")
    flags = sorted({f"{f['category']} ({f['severity']})" for f in o["safety"]["flags"]})
    return (f"Context: {o['person']['pseudonym']} ({o['mode']} mode). {head}. "
            + (f"Safety flags: {', '.join(flags)}; mention once, neutrally." if flags else "No safety flags."))


def _history(msgs) -> list[dict]:
    out = []
    for m in msgs[-HISTORY_LIMIT:]:
        if m.role == "assistant":
            d = {"role": "assistant", "content": m.content}
            if m.tool_calls:
                d["tool_calls"] = m.tool_calls
            out.append(d)
        elif m.role == "tool":
            tc = (m.tool_calls or [{}])[0]
            out.append({"role": "tool", "tool_call_id": tc.get("tool_call_id", ""), "content": m.content})
        elif m.role == "user":
            out.append({"role": "user", "content": m.content})
    while out and out[0]["role"] == "tool":  # never start with an orphaned tool result
        out.pop(0)
    return out


def _run_tool(tools: dict[str, ToolSpec], name: str, raw_args: str) -> tuple[dict, bool]:
    spec = tools.get(name)
    if spec is None:
        return {"error": f"unknown tool {name!r}"}, False
    try:
        args = json.loads(raw_args or "{}")
        if not isinstance(args, dict):
            raise ValueError("arguments must be an object")
    except ValueError as e:
        return {"error": f"bad arguments: {e}"}, False
    try:
        return spec.handler(args), True
    except (InvalidInput, NotFound, ValueError, KeyError, TypeError) as e:
        return {"error": str(e) or e.__class__.__name__}, False
    except Exception as e:  # tool bugs must not kill the turn
        log.warning("tool %s failed: %s", name, e.__class__.__name__)
        return {"error": "tool failed"}, False


def run_agent(svc, client, thread_id: int | None, user_text: str | None, kind: str, person_id: int,
              background: bool = False) -> Iterator[dict]:
    """Yield AgentEvent dicts. `user_text=None` runs without a new user message (background)."""
    settings = svc.get_settings()
    registry = build_registry(svc, settings, person_id, kind, background)
    tools = {t.name: t for t in registry}
    schemas = [t.schema() for t in registry]
    ephemeral = thread_id is None  # background runs leave no thread behind

    def persist(role, content, tool_calls=None):
        return None if ephemeral else svc._persist_message(thread_id, role, content, tool_calls)

    if user_text is not None:
        persist("user", user_text)
    history = [] if ephemeral else _history(svc._thread_messages(thread_id))
    if ephemeral and user_text is not None:
        history = [{"role": "user", "content": user_text}]
    messages = [{"role": "system", "content": system_prompt(kind, background)},
                {"role": "system", "content": _context_message(svc, person_id)}, *history]
    final_text, final_id = "", None
    try:
        for round_no in range(MAX_TOOL_ROUNDS + 1):
            last = round_no == MAX_TOOL_ROUNDS
            text, calls = "", []
            for d in client.chat(messages, [] if last else schemas, stream=True):
                if d["type"] == "token":
                    text += d["text"]
                    if not background:
                        yield {"type": "token", "text": d["text"]}
                elif d["type"] == "tool_calls" and not last:
                    calls = d["calls"]
            if not calls:
                final_text = text or (FALLBACK_TEXT if last else "")
                if last and not text and not background:
                    yield {"type": "token", "text": final_text}
                final_id = persist("assistant", final_text)
                break
            tc = [{"id": c["id"], "type": "function",
                   "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}} for c in calls]
            persist("assistant", text, tc)
            messages.append({"role": "assistant", "content": text, "tool_calls": tc})
            for c in calls:
                try:
                    shown = json.loads(c["arguments"] or "{}")
                except ValueError:
                    shown = {}
                yield {"type": "tool_call", "name": c["name"], "args": shown if isinstance(shown, dict) else {}}
                result, ok = _run_tool(tools, c["name"], c["arguments"])
                payload = json.dumps(result, default=str)
                persist("tool", payload, [{"tool_call_id": c["id"], "name": c["name"]}])
                messages.append({"role": "tool", "tool_call_id": c["id"], "content": payload})
                yield {"type": "tool_result", "name": c["name"], "ok": ok,
                       "summary": "done" if ok else str(result.get("error", "failed"))[:120]}
    except Exception as e:
        log.warning("agent turn failed: %s", e.__class__.__name__)
        yield {"type": "error", "code": "agent_error", "message": "The assistant ran into a problem. Try again."}
        return
    yield {"type": "done", "message_id": final_id}
