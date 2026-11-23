from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from ._base import fmt, now_str, parse, tx
from .models import NextStep, StepStatus

_STATUS = ("open", "done", "dismissed")
_COLS = "id, person_id, kind, title, why, evidence_refs, status, created_at"


def _row(r) -> NextStep:
    return NextStep(id=r[0], person_id=r[1], kind=r[2], title=r[3], why=r[4],
                    evidence_refs=json.loads(r[5]), status=r[6], created_at=parse(r[7]))


class NextSteps:
    def __init__(self, conn):
        self.conn = conn

    def add(self, person_id: int, kind: str, title: str, why: str,
            evidence_refs: list[str]) -> NextStep:
        with tx(self.conn) as c:
            sid = c.execute(
                "INSERT INTO next_steps(person_id, kind, title, why, evidence_refs, created_at)"
                " VALUES (?,?,?,?,?,?)",
                (person_id, kind, title, why, json.dumps(list(evidence_refs)), now_str())).lastrowid
        return _row(self.conn.execute(f"SELECT {_COLS} FROM next_steps WHERE id=?", (sid,)).fetchone())

    def list(self, person_id: int, status: Optional[StepStatus] = None) -> list[NextStep]:
        sql = f"SELECT {_COLS} FROM next_steps WHERE person_id=?"
        args: list = [person_id]
        if status is not None:
            sql += " AND status=?"
            args.append(status)
        return [_row(r) for r in self.conn.execute(sql + " ORDER BY id", args)]

    def set_status(self, step_id: int, status: StepStatus) -> None:
        if status not in _STATUS:
            raise ValueError(f"bad status {status!r}")
        with tx(self.conn) as c:
            if not c.execute("UPDATE next_steps SET status=? WHERE id=?", (status, step_id)).rowcount:
                raise KeyError(step_id)

    def recent_similar(self, person_id: int, kind: str, evidence_refs: list[str],
                       days: int = 14) -> bool:
        """Same kind and same evidence set (order-insensitive) within `days`, any status."""
        cutoff = fmt(datetime.now(timezone.utc) - timedelta(days=days))
        want = set(evidence_refs)
        for (refs,) in self.conn.execute(
                "SELECT evidence_refs FROM next_steps WHERE person_id=? AND kind=? AND created_at>=?",
                (person_id, kind, cutoff)):
            if set(json.loads(refs)) == want:
                return True
        return False
