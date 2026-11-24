from __future__ import annotations

from typing import Optional

from ._base import now_str, parse, tx
from .models import Mode, Person

_MODES = ("potential", "established")
_COLS = "id, pseudonym, mode, timezone, created_at"


def _row(r) -> Person:
    return Person(id=r[0], pseudonym=r[1], mode=r[2], timezone=r[3], created_at=parse(r[4]))


class People:
    def __init__(self, conn):
        self.conn = conn

    def add(self, pseudonym: str, mode: Mode, timezone: str = "UTC") -> Person:
        if mode not in _MODES:
            raise ValueError(f"bad mode {mode!r}")
        with tx(self.conn) as c:
            pid = c.execute("INSERT INTO people(pseudonym, mode, timezone, created_at) VALUES (?,?,?,?)",
                            (pseudonym, mode, timezone, now_str())).lastrowid
        return self.get(pid)

    def get(self, person_id: int) -> Optional[Person]:
        r = self.conn.execute(f"SELECT {_COLS} FROM people WHERE id=?", (person_id,)).fetchone()
        return _row(r) if r else None

    def list(self) -> list[Person]:
        return [_row(r) for r in self.conn.execute(f"SELECT {_COLS} FROM people ORDER BY id")]

    def delete(self, person_id: int) -> None:
        """Remove the person and everything hanging off them (FK cascades), then VACUUM."""
        if self.conn.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            raise RuntimeError("foreign keys are off; refusing a partial delete")
        with tx(self.conn) as c:
            c.execute("DELETE FROM people WHERE id=?", (person_id,))
        self.conn.execute("VACUUM")
