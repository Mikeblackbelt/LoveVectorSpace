from ._dating import (MatchInfo, RawMsg, clean_text, first_key, load_json, make_info, parse_ts,
                      pick, to_messages)
from .model import Message, ParseError

EXPECTED = "matches.json from Hinge's Download My Data"
_CHAT_KEYS = ("chats", "chat", "Chats", "messages")
_TEXT_KEYS = ("body", "message", "text")
_TS_KEYS = ("timestamp", "sent_at", "sent_date", "time")


def _groups(raw: str) -> dict[str, list[RawMsg]]:
    data = load_json(raw, "Hinge", EXPECTED)
    try:
        if isinstance(data, dict):
            data = data.get("matches", data.get("Matches"))
        if not isinstance(data, list):
            raise TypeError("expected a list of matches")
        groups: dict[str, list[RawMsg]] = {}
        for i, m in enumerate(data, 1):
            if not isinstance(m, dict):
                raise TypeError("match entry is not an object")
            if not any(k in m for k in _CHAT_KEYS + ("match", "like", "block")):
                raise KeyError("entry has none of chats/match/like/block")
            # Hinge has no match id: the position in matches.json identifies it.
            chats = first_key(m, _CHAT_KEYS) or []
            if not isinstance(chats, list):
                raise TypeError("'chats' is not a list")
            out = []
            for c in chats:
                text = first_key(c, _TEXT_KEYS)
                if isinstance(text, str) and text.strip():
                    out.append(RawMsg(parse_ts(first_key(c, _TS_KEYS)), clean_text(text)))
            groups[str(i)] = out
    except (KeyError, TypeError, AttributeError, ValueError, OverflowError, OSError) as e:
        raise ParseError(f"not a Hinge export (expected {EXPECTED}): {e}") from e
    return groups


def list_matches(raw: str) -> list[MatchInfo]:
    """Only matches that contain chat messages are listed (likes/blocks alone are skipped)."""
    return [make_info(mid, int(mid), ms, True) for mid, ms in _groups(raw).items() if ms]


def parse_match(raw: str, match_id: str, owner_name: str) -> tuple[list[Message], bool]:
    """match_id is the 1-based index in matches.json. Only the owner's messages: all "me"."""
    return to_messages(pick(_groups(raw), match_id, "Hinge"), owner_name, "hinge_import")
