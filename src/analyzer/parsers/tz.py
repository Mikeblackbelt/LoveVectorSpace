from datetime import UTC, datetime
from zoneinfo import ZoneInfo


def to_utc(local: datetime, tz: str) -> datetime:
    """Convert a wall-clock time in IANA zone `tz` to an aware UTC datetime.

    Naive input is interpreted in `tz` with zoneinfo's default fold=0: an
    ambiguous time (DST end) resolves to the first occurrence, and a
    nonexistent time (DST start gap) is interpreted using the offset before
    the transition. Aware input is just converted.
    """
    if local.tzinfo is None:
        local = local.replace(tzinfo=ZoneInfo(tz), fold=0)
    return local.astimezone(UTC)
