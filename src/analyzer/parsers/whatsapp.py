import re
from datetime import datetime

from .model import Message, ParseError
from .tz import to_utc

_HEADER = re.compile(
    r"^\[?(\d{1,2})/(\d{1,2})/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?\.?[Mm]?\.?\]?\s*(?:-\s*)?(.*)$"
)


def _clean(s: str) -> str:
    return (
        s.replace("‎", "").replace("‏", "")
        .replace(" ", " ").replace(" ", " ")
    )


def _is_media(text: str) -> bool:
    t = text.strip().lower()
    return t == "<media omitted>" or t.startswith("<attached:")


def parse_whatsapp(raw: str, tz: str) -> list[Message]:
    """Parse a WhatsApp export (US, EU 24h or iOS bracket style).

    Timestamps are local wall-clock in `tz` and converted to UTC. Day/month
    order: if any first field exceeds 12 the file is day-first, otherwise
    month-first. System lines and media placeholders are dropped.
    """
    entries: list[tuple[tuple | None, str]] = []
    for line in _clean(raw).splitlines():
        m = _HEADER.match(line)
        if m:
            entries.append((m.groups()[:7], m.group(8)))
        else:
            entries.append((None, line))
    headers = [e[0] for e in entries if e[0]]
    if not headers:
        raise ParseError("no WhatsApp timestamps found")
    day_first = any(int(h[0]) > 12 for h in headers) and not any(int(h[1]) > 12 for h in headers)

    out: list[Message] = []
    cur: list | None = None  # [ts, speaker, text_lines]

    def flush() -> None:
        if cur and not _is_media("\n".join(cur[2])):
            out.append(Message(to_utc(cur[0], tz), None, cur[1], "\n".join(cur[2]).rstrip(),
                               "minute", None, "whatsapp_import"))

    for hdr, rest in entries:
        if hdr is None:
            if cur is not None:
                cur[2].append(rest)
            continue
        flush()
        cur = None
        a, b, y, hh, mm, ss, ap = hdr
        day, mon = (int(a), int(b)) if day_first else (int(b), int(a))
        year = int(y) + (2000 if len(y) == 2 else 0)
        hour = int(hh)
        if ap:
            hour = hour % 12 + (12 if ap.lower() == "p" else 0)
        try:
            ts = datetime(year, mon, day, hour, int(mm), int(ss or 0))
        except ValueError as e:
            raise ParseError(f"bad timestamp: {e}") from e
        speaker, sep, text = rest.partition(": ")
        if not sep:
            continue  # system line; its continuation lines are dropped too
        cur = [ts, speaker.strip(), [text]]
    flush()
    return out
