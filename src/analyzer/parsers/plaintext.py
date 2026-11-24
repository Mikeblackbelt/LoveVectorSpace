import re
from datetime import datetime

from .model import Message, ParseError
from .tz import to_utc

_LINE = re.compile(r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) \| ([^|]*?) \| (.*)$")


def parse_plaintext(raw: str, tz: str) -> list[Message]:
    """Parse `YYYY-MM-DD HH:MM | speaker | text` lines (local time in `tz`)."""
    rows: list[list] = []
    for line in raw.splitlines():
        m = _LINE.match(line)
        if m:
            try:
                ts = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H:%M")
            except ValueError as e:
                raise ParseError(f"bad timestamp: {e}") from e
            rows.append([ts, m.group(3).strip(), [m.group(4)]])
        elif rows:
            rows[-1][2].append(line)
    if not rows:
        raise ParseError("no plaintext lines found")
    return [
        Message(to_utc(ts, tz), None, sp, "\n".join(t).rstrip(), "minute", None, "plaintext")
        for ts, sp, t in rows
    ]
