from contextlib import contextmanager
from datetime import datetime, timezone

from .messages import _fmt, _parse

__all__ = ["now_str", "fmt", "parse", "tx"]

fmt = _fmt
parse = _parse


def now_str() -> str:
    return _fmt(datetime.now(timezone.utc))


@contextmanager
def tx(conn):
    """Commit on success, roll back and re-raise on any failure."""
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
