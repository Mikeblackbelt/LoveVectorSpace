from __future__ import annotations

import json
from typing import Any, Optional

from ._base import now_str, parse, tx
from .models import Snapshot

_COLS = "id, person_id, created_at, data"


def _row(r) -> Snapshot:
    return Snapshot(id=r[0], person_id=r[1], created_at=parse(r[2]), data=json.loads(r[3]))


class Snapshots:
    def __init__(self, conn):
        self.conn = conn

    def save(self, person_id: int, data: Any) -> Snapshot:
        with tx(self.conn) as c:
            sid = c.execute("INSERT INTO snapshots(person_id, created_at, data) VALUES (?,?,?)",
                            (person_id, now_str(), json.dumps(data))).lastrowid
        return _row(self.conn.execute(f"SELECT {_COLS} FROM snapshots WHERE id=?", (sid,)).fetchone())

    def list(self, person_id: int) -> list[Snapshot]:
        """Newest first."""
        return [_row(r) for r in self.conn.execute(
            f"SELECT {_COLS} FROM snapshots WHERE person_id=? ORDER BY id DESC", (person_id,))]

    def latest(self, person_id: int) -> Optional[Snapshot]:
        r = self.conn.execute(
            f"SELECT {_COLS} FROM snapshots WHERE person_id=? ORDER BY id DESC LIMIT 1",
            (person_id,)).fetchone()
        return _row(r) if r else None
