import json
from datetime import UTC, datetime

from .model import Message, ParseError


def fix_mojibake(s: str) -> str:
    """Undo Instagram's latin-1-decoded-UTF-8 export bug when the round trip is valid."""
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def parse_instagram_json(raw: str) -> list[Message]:
    """Parse an Instagram `message_N.json`. Returns oldest-first, role None."""
    try:
        items = json.loads(raw)["messages"]
        msgs = [
            Message(
                datetime.fromtimestamp(it["timestamp_ms"] / 1000, UTC),
                None,
                fix_mojibake(it.get("sender_name", "")),
                fix_mojibake(it["content"]),
                "second",
                None,
                "instagram_import",
            )
            for it in reversed(items)
            if isinstance(it.get("content"), str)
        ]
    except (json.JSONDecodeError, KeyError, TypeError, AttributeError) as e:
        raise ParseError(f"not an Instagram export: {e}") from e
    return sorted(msgs, key=lambda m: m.ts)
