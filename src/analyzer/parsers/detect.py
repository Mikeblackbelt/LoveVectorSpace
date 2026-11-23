import json
import re

from .model import ParseError

FORMATS = ("whatsapp", "plaintext", "instagram", "discord", "tinder", "hinge", "grindr")
_WA_LINE = re.compile(r"^\[?\d{1,2}/\d{1,2}/\d{2,4},?\s+\d{1,2}:\d{2}", re.M)
_HELP = ("expected a WhatsApp _chat.txt / .txt, Instagram message_N.json, Discord messages.json, "
         "Tinder data.json, Hinge matches.json or a Grindr chat export (.json)")


def detect_format(filename: str, raw: bytes) -> str:
    """Identify the chat-export format from the file name and content."""
    name = filename.replace("\\", "/").rsplit("/", 1)[-1].lower()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ParseError(f"could not read {filename!r} as UTF-8 text; {_HELP}") from e
    stripped = text.lstrip()
    if name.endswith(".json") or stripped[:1] in "[{":
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise ParseError(f"{filename!r} is not valid JSON; {_HELP}") from e
        return _sniff_json(name, data, filename)
    if _WA_LINE.search(text):
        return "whatsapp"
    if stripped:
        return "plaintext"
    raise ParseError(f"{filename!r} is empty; {_HELP}")


def _sniff_json(name: str, data, filename: str) -> str:
    if isinstance(data, dict):
        if isinstance(data.get("messages"), list) and any(
                isinstance(m, dict) and ("timestamp_ms" in m or "sender_name" in m)
                for m in data["messages"][:5]) or ("participants" in data and "messages" in data):
            return "instagram"
        msgs = data.get("Messages")
        if isinstance(msgs, list) and any(isinstance(m, dict) and "messages" in m for m in msgs[:5]):
            return "tinder"
        if msgs is not None and "match_id" in json.dumps(msgs[:2] if isinstance(msgs, list) else msgs):
            return "tinder"
        if name.startswith("message_") and "messages" in data:
            return "instagram"
        if any(k in data for k in ("conversations", "chats", "Conversations", "Chats",
                                   "chat_messages", "messages", "Messages")):
            return "grindr"
    elif isinstance(data, list):
        head = [x for x in data[:5] if isinstance(x, dict)]
        if head:
            if any(("Contents" in x or "content" in x) and ("Timestamp" in x or "timestamp" in x)
                   for x in head):
                return "discord"
            if any(k in x for x in head for k in ("chats", "like", "match", "block", "we_met")):
                return "hinge"
            if any("match_id" in x for x in head):
                return "tinder"
            if "matches" in name:
                return "hinge"
            if "grindr" in name or any(
                    k in x for x in head for k in ("conversation_id", "conversationId", "chatId")):
                return "grindr"
    raise ParseError(f"unrecognised JSON structure in {filename!r}; {_HELP}")
