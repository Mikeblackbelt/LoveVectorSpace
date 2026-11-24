from ._dating import (MatchInfo, RawMsg, clean_text, first_key, load_json, make_info, parse_ts,
                      pick, to_messages)
from .model import Message, ParseError

EXPECTED = "data.json from Tinder's Download My Data"
_MATCH_KEYS = ("match_id", "matchId", "MatchId", "id")
_LIST_KEYS = ("messages", "Messages")
_TEXT_KEYS = ("message", "Message", "body", "text")
_TS_KEYS = ("sent_date", "sentDate", "created_date", "timestamp")


def _groups(raw: str) -> dict[str, list[RawMsg]]:
    data = load_json(raw, "Tinder", EXPECTED)
    try:
        if isinstance(data, dict):
            matches = data.get("Messages", data.get("messages"))
            if matches is None:
                raise KeyError("no 'Messages' array")
        else:
            matches = data
        if not isinstance(matches, list):
            raise TypeError("'Messages' is not a list")
        groups: dict[str, list[RawMsg]] = {}
        for i, m in enumerate(matches, 1):
            mid = first_key(m, _MATCH_KEYS)
            mid = str(mid) if mid is not None else f"match-{i}"
            lst = first_key(m, _LIST_KEYS)
            if not isinstance(lst, list):
                raise KeyError("match without a messages list")
            out = groups.setdefault(mid, [])
            for it in lst:
                text = first_key(it, _TEXT_KEYS)
                if not isinstance(text, str) or not text.strip():
                    continue
                mid_ = it.get("message_id", it.get("id"))
                out.append(RawMsg(parse_ts(first_key(it, _TS_KEYS)), clean_text(text),
                                  str(mid_) if mid_ is not None else None))
    except (KeyError, TypeError, AttributeError, ValueError, OverflowError, OSError) as e:
        raise ParseError(f"not a Tinder export (expected {EXPECTED}): {e}") from e
    return groups


def list_matches(raw: str) -> list[MatchInfo]:
    return [make_info(mid, i, ms, True) for i, (mid, ms) in enumerate(_groups(raw).items(), 1)]


def parse_match(raw: str, match_id: str, owner_name: str) -> tuple[list[Message], bool]:
    """Tinder exports hold only the owner's sent messages: all "me", one_sided True."""
    return to_messages(pick(_groups(raw), match_id, "Tinder"), owner_name, "tinder_import")
