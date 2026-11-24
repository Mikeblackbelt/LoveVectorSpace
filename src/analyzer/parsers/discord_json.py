import json
from datetime import UTC, datetime

from .model import Message, ParseError


def _author(item: dict) -> str | None:
    a = item.get("Author", item.get("author"))
    if isinstance(a, dict):
        a = a.get("name") or a.get("username")
    return a if isinstance(a, str) and a else None


def parse_discord_json(raw: str, owner_name: str) -> tuple[list[Message], bool]:
    """Parse a Discord data-package `messages.json`.

    The package holds only the owner's own messages (no author field), so
    those are all role "me". If an Author field is present it is compared to
    owner_name. Returns (messages oldest-first, one_sided) where one_sided is
    True when there is no author info or every author is the owner.
    """
    try:
        items = json.loads(raw)
        if not isinstance(items, list):
            raise TypeError("expected a list")
        msgs: list[Message] = []
        one_sided = True
        for it in items:
            text = it.get("Contents", it.get("content"))
            if not isinstance(text, str) or not text:
                continue
            ts = datetime.fromisoformat(it.get("Timestamp", it.get("timestamp")))
            ts = ts.replace(tzinfo=UTC) if ts.tzinfo is None else ts.astimezone(UTC)
            author = _author(it)
            is_me = author is None or author.strip().casefold() == owner_name.strip().casefold()
            one_sided = one_sided and is_me
            mid = it.get("ID", it.get("id"))
            msgs.append(Message(ts, "me" if is_me else "them", author or owner_name, text,
                                "second", str(mid) if mid is not None else None, "discord_import"))
    except (json.JSONDecodeError, KeyError, TypeError, AttributeError, ValueError) as e:
        raise ParseError(f"not a Discord export: {e}") from e
    return sorted(msgs, key=lambda m: m.ts), one_sided
