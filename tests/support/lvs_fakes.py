"""Shared test helpers (importable as lvs_fakes via pytest pythonpath)."""
import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCALES = Path(__file__).resolve().parents[2] / "src" / "analyzer" / "scales" / "defs"


class Events:
    def __init__(self):
        self.items = []
        self.lock = threading.Lock()

    def publish(self, user_id, event):
        with self.lock:
            self.items.append((user_id, event))

    def types(self):
        with self.lock:
            return [e["type"] for _, e in self.items]


class FakeGroq:
    """Scripted model: `script` is a list of turns; a turn is a list of deltas, or a callable
    (messages, tools) -> list of deltas. Records every call."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def chat(self, messages, tools, stream=True):
        self.calls.append({"messages": [dict(m) for m in messages], "tools": tools})
        turn = self.script.pop(0) if self.script else [{"type": "token", "text": "ok"}]
        if callable(turn):
            turn = turn(messages, tools)
        yield from turn


def tool_call(name, args, cid="c1"):
    return [{"type": "tool_calls", "calls": [{"id": cid, "name": name, "arguments": json.dumps(args)}]}]


def say(*parts):
    return [{"type": "token", "text": p} for p in parts]


def wa_export(n_days=14, start=None, per_day=6, me="Alex", them="Sam"):
    """A synthetic WhatsApp export (US style) with alternating speakers."""
    start = start or (datetime.now(timezone.utc) - timedelta(days=n_days)).replace(hour=9, minute=0)
    lines = []
    for d in range(n_days):
        for i in range(per_day):
            t = start + timedelta(days=d, minutes=i * 3)
            who = me if (i + d) % 2 == 0 else them
            h12 = t.hour % 12 or 12
            q = "?" if i % 3 == 0 else ""
            lines.append(f"{t.month}/{t.day}/{t.year % 100}, {h12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"
                         f" - {who}: i think that sounds good to me and we can talk about it{q} {d}{i}")
    return "\n".join(lines).encode()


