"""Shared helpers for the dating-app importers (Tinder, Hinge, Grindr, Bumble)."""
import html
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

from .model import Message, ParseError

_ZW = re.compile("[‎‏​‪-‮﻿]")
SELF_NAMES = {"you", "me", "self", "owner"}


@dataclass(frozen=True)
class MatchInfo:
    match_id: str
    label: str
    first_ts: datetime | None
    last_ts: datetime | None
    message_count: int
    one_sided: bool


@dataclass(frozen=True)
class RawMsg:
    ts: datetime
    text: str
    msg_id: str | None = None
    sender: str | None = None


def clean_text(s: str) -> str:
    return _ZW.sub("", html.unescape(s)).replace(" ", " ").replace(" ", " ")


def parse_ts(v: Any) -> datetime:
    """Epoch (s or ms, number or numeric string), ISO 8601 or RFC 2822 -> UTC. Naive -> UTC."""
    if isinstance(v, bool) or v is None:
        raise ValueError(f"bad timestamp {v!r}")
    if isinstance(v, str):
        s = v.strip()
        if re.fullmatch(r"-?\d+(\.\d+)?", s):
            v = float(s)
        else:
            try:
                d = datetime.fromisoformat(s.replace("Z", "+00:00"))
            except ValueError:
                d = parsedate_to_datetime(s)
            return d.replace(tzinfo=UTC) if d.tzinfo is None else d.astimezone(UTC)
    if isinstance(v, (int, float)):
        x = float(v)
        if abs(x) > 1e14:  # microseconds
            x /= 1e6
        elif abs(x) > 1e11:  # milliseconds
            x /= 1e3
        return datetime.fromtimestamp(x, UTC)
    raise ValueError(f"bad timestamp {v!r}")


def load_json(raw: str, app: str, expected: str) -> Any:
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        raise ParseError(f"not a {app} export (expected {expected}): invalid JSON: {e}") from e


def first_key(d: dict, keys: tuple[str, ...]) -> Any:
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def make_info(match_id: str, index: int, msgs: list[RawMsg], one_sided: bool) -> MatchInfo:
    if msgs:
        first = min(m.ts for m in msgs)
        last = max(m.ts for m in msgs)
        label = f"Match {index} · first msg {first:%Y-%m-%d}"
    else:
        first = last = None
        label = f"Match {index} · no messages"
    return MatchInfo(match_id, label, first, last, len(msgs), one_sided)


def to_messages(msgs: list[RawMsg], owner_name: str, source: str,
                is_me=lambda m: True) -> tuple[list[Message], bool]:
    out = []
    one_sided = True
    for m in msgs:
        me = is_me(m)
        one_sided = one_sided and me
        out.append(Message(m.ts, "me" if me else "them", owner_name if me else (m.sender or "them"),
                           m.text, "second", m.msg_id, source))
    return sorted(out, key=lambda x: x.ts), one_sided


def pick(groups: dict[str, list[RawMsg]], match_id: str, app: str) -> list[RawMsg]:
    if match_id not in groups:
        raise ParseError(f"match {match_id!r} not found in {app} export")
    return groups[match_id]
