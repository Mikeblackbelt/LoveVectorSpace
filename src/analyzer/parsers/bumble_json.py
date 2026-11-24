"""Bumble export importer. The format is UNCONFIRMED (see DATING_FORMATS.md); parsing is tolerant."""
from ._dating import (SELF_NAMES, MatchInfo, RawMsg, clean_text, first_key, load_json, make_info,
                      parse_ts, pick, to_messages)
from .model import Message, ParseError

EXPECTED = "the chat JSON file (e.g. chat.json / messages.json) from Bumble's Download My Data"
_CONV_KEYS = ("conversations", "chats", "chat", "Chats", "Conversations", "messages", "Messages", "matches", "Matches")
_ID_KEYS = ("conversation_id", "match_id", "matchId", "other_user_id", "otherUserId", "user_id", "conversationId", "chat_id", "chatId", "profile_id", "profileId",
            "partner_id", "partnerId", "id")
_FLAT_ID_KEYS = ("conversation_id", "match_id", "matchId", "other_user_id", "otherUserId", "match_id", "matchId", "other_user_id", "otherUserId", "user_id", "conversationId", "chat_id", "chatId", "recipient", "to",
                 "profile_id", "profileId")
_LIST_KEYS = ("messages", "Messages", "chat_messages", "chatMessages")
_TEXT_KEYS = ("body", "message_text", "messageText", "text", "message", "content", "Body")
_TS_KEYS = ("timestamp", "date_sent", "dateSent", "send_time", "sendTime", "sent_date", "sentDate", "sent_at", "sentAt", "created_at", "createdAt",
            "time", "date")
_SENDER_KEYS = ("sender", "from_person", "from_user_id", "author", "senderId", "sender_id", "from")
_MSGID_KEYS = ("message_id", "messageId", "msg_id", "id")


def _msg(it: dict) -> RawMsg | None:
    text = first_key(it, _TEXT_KEYS)
    if not isinstance(text, str) or not text.strip():
        return None
    ts = first_key(it, _TS_KEYS)
    if ts is None:
        raise KeyError("message without a timestamp")
    s = first_key(it, _SENDER_KEYS)
    mid = first_key(it, _MSGID_KEYS)
    return RawMsg(parse_ts(ts), clean_text(text), str(mid) if mid is not None else None,
                  str(s) if s is not None else None)


def _groups(raw: str) -> dict[str, list[RawMsg]]:
    data = load_json(raw, "Bumble", EXPECTED)
    try:
        if isinstance(data, dict):
            convs = first_key(data, _CONV_KEYS)
            if convs is None:
                raise KeyError("no conversations/chats/messages key")
        else:
            convs = data
        if isinstance(convs, dict):  # {conversation_id: [messages]} or {id: {messages: [...]}}
            convs = [{"conversation_id": k,
                      "messages": v.get("messages", v.get("Messages")) if isinstance(v, dict) else v}
                     for k, v in convs.items()]
        if not isinstance(convs, list):
            raise TypeError("conversations is not a list")
        groups: dict[str, list[RawMsg]] = {}
        for i, c in enumerate(convs, 1):
            if not isinstance(c, dict):
                raise TypeError("entry is not an object")
            lst = first_key(c, _LIST_KEYS)
            if isinstance(lst, list):  # a conversation holding its messages
                cid = first_key(c, _ID_KEYS)
                dest = groups.setdefault(str(cid) if cid is not None else f"chat-{i}", [])
                dest.extend(m for m in (_msg(x) for x in lst) if m)
            else:  # flat message list; group by conversation id
                cid = first_key(c, _FLAT_ID_KEYS)
                dest = groups.setdefault(str(cid) if cid is not None else "chat-1", [])
                m = _msg(c)
                if m:
                    dest.append(m)
    except (KeyError, TypeError, AttributeError, ValueError, OverflowError, OSError) as e:
        raise ParseError(f"not a Bumble export (expected {EXPECTED}): {e}") from e
    return groups


def _senders(groups: dict[str, list[RawMsg]]) -> set[str]:
    return {m.sender for ms in groups.values() for m in ms if m.sender}


def list_matches(raw: str) -> list[MatchInfo]:
    groups = _groups(raw)
    one = len(_senders(groups)) <= 1
    return [make_info(mid, i, ms, one) for i, (mid, ms) in enumerate(groups.items(), 1)]


def parse_match(raw: str, match_id: str, owner_name: str) -> tuple[list[Message], bool]:
    """Role "me" when the sender is the owner name / "you"; if the whole file has a single
    sender (or none) everything is "me" (one-sided). With several senders and no name match,
    the others are "them"."""
    groups = _groups(raw)
    ms = pick(groups, match_id, "Bumble")
    many = len(_senders(groups)) > 1
    owner = owner_name.strip().casefold()

    def is_me(m: RawMsg) -> bool:
        if m.sender is None or not many:
            return True
        s = m.sender.strip().casefold()
        return s == owner or s in SELF_NAMES

    return to_messages(ms, owner_name, "bumble_import", is_me)
