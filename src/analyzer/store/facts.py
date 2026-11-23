from __future__ import annotations

from typing import Optional

from ._base import now_str, parse, tx
from .models import Confidence, Fact, FactSource

_SOURCES = ("interview", "checkin", "owner_edit")
_CONF = ("owner_sure", "owner_unsure")
_COLS = "id, person_id, key, value, source, confidence, updated_at"


def _row(r) -> Fact:
    return Fact(id=r[0], person_id=r[1], key=r[2], value=r[3], source=r[4],
                confidence=r[5], updated_at=parse(r[6]))


def _check(source, confidence) -> None:
    if source is not None and source not in _SOURCES:
        raise ValueError(f"bad source {source!r}")
    if confidence is not None and confidence not in _CONF:
        raise ValueError(f"bad confidence {confidence!r}")


class Facts:
    def __init__(self, conn):
        self.conn = conn

    def upsert(self, person_id: int, key: str, value: str, source: FactSource,
               confidence: Confidence) -> Fact:
        _check(source, confidence)
        with tx(self.conn) as c:
            c.execute(
                "INSERT INTO facts(person_id, key, value, source, confidence, updated_at)"
                " VALUES (?,?,?,?,?,?) ON CONFLICT(person_id, key) DO UPDATE SET"
                " value=excluded.value, source=excluded.source,"
                " confidence=excluded.confidence, updated_at=excluded.updated_at",
                (person_id, key, value, source, confidence, now_str()))
        r = self.conn.execute(f"SELECT {_COLS} FROM facts WHERE person_id=? AND key=?",
                              (person_id, key)).fetchone()
        return _row(r)

    def get(self, fact_id: int) -> Optional[Fact]:
        r = self.conn.execute(f"SELECT {_COLS} FROM facts WHERE id=?", (fact_id,)).fetchone()
        return _row(r) if r else None

    def list(self, person_id: int) -> list[Fact]:
        return [_row(r) for r in self.conn.execute(
            f"SELECT {_COLS} FROM facts WHERE person_id=? ORDER BY key", (person_id,))]

    def update(self, fact_id: int, value: Optional[str] = None, source: Optional[FactSource] = None,
               confidence: Optional[Confidence] = None) -> Fact:
        _check(source, confidence)
        with tx(self.conn) as c:
            n = c.execute(
                "UPDATE facts SET value=COALESCE(?, value), source=COALESCE(?, source),"
                " confidence=COALESCE(?, confidence), updated_at=? WHERE id=?",
                (value, source, confidence, now_str(), fact_id)).rowcount
            if not n:
                raise KeyError(fact_id)
        return self.get(fact_id)

    def delete(self, fact_id: int) -> None:
        with tx(self.conn) as c:
            c.execute("DELETE FROM facts WHERE id=?", (fact_id,))
