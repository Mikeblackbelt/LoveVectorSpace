from dataclasses import dataclass
from datetime import datetime
from typing import Literal


class ParseError(ValueError):
    """Raised when input cannot be parsed as the expected chat format."""


@dataclass(frozen=True)
class Message:
    ts: datetime  # tz-aware UTC
    role: Literal["me", "them"] | None
    speaker_raw: str
    text: str
    ts_precision: Literal["second", "minute", "approx"]
    platform_msg_id: str | None
    source: str  # whatsapp_import | instagram_import | discord_import | plaintext
