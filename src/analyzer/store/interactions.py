from __future__ import annotations

from datetime import datetime
from typing import Optional

from ._base import fmt, tx
from .models import Interaction, InteractionFields

__all__ = ["Interactions", "InteractionFields", "Interaction"]


def _row(r) -> Interaction:
    return Interaction(id=r[0], person_id=r[1], fields=InteractionFields.model_validate_json(r[2]),
                       notes=r[3])


class Interactions:
    def __init__(self, conn):
        self.conn = conn

    def add(self, person_id: int, fields: InteractionFields, notes: str = "") -> Interaction:
        with tx(self.conn) as c:
            iid = c.execute("INSERT INTO interactions(person_id, ts, fields, notes) VALUES (?,?,?,?)",
                            (person_id, fmt(fields.ts), fields.model_dump_json(), notes)).lastrowid
        return self.get(iid)

    def get(self, interaction_id: int) -> Optional[Interaction]:
        r = self.conn.execute("SELECT id, person_id, fields, notes FROM interactions WHERE id=?",
                              (interaction_id,)).fetchone()
        return _row(r) if r else None

    def list(self, person_id: int, since: Optional[datetime] = None) -> list[Interaction]:
        sql = "SELECT id, person_id, fields, notes FROM interactions WHERE person_id=?"
        args: list = [person_id]
        if since is not None:
            sql += " AND ts>=?"
            args.append(fmt(since))
        return [_row(r) for r in self.conn.execute(sql + " ORDER BY ts, id", args)]

    def update(self, interaction_id: int, fields: Optional[InteractionFields] = None,
               notes: Optional[str] = None) -> Interaction:
        cur = self.get(interaction_id)
        if cur is None:
            raise KeyError(interaction_id)
        f = fields or cur.fields
        with tx(self.conn) as c:
            c.execute("UPDATE interactions SET ts=?, fields=?, notes=? WHERE id=?",
                      (fmt(f.ts), f.model_dump_json(), cur.notes if notes is None else notes,
                       interaction_id))
        return self.get(interaction_id)

    def delete(self, interaction_id: int) -> None:
        with tx(self.conn) as c:
            c.execute("DELETE FROM interactions WHERE id=?", (interaction_id,))
