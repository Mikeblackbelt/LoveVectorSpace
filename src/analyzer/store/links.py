from __future__ import annotations

from typing import Optional

from ._base import tx
from .models import ChatLink, Role, SpeakerMapping


class SpeakerMap:
    def __init__(self, conn):
        self.conn = conn

    def set(self, person_id: int, source: str, speaker_raw: str, role: Role) -> None:
        if role not in ("me", "them"):
            raise ValueError(f"bad role {role!r}")
        with tx(self.conn) as c:
            c.execute(
                "INSERT INTO speaker_map(person_id, source, speaker_raw, role) VALUES (?,?,?,?)"
                " ON CONFLICT(person_id, source, speaker_raw) DO UPDATE SET role=excluded.role",
                (person_id, source, speaker_raw, role))

    def get(self, person_id: int) -> list[SpeakerMapping]:
        return [SpeakerMapping(person_id=r[0], source=r[1], speaker_raw=r[2], role=r[3])
                for r in self.conn.execute(
                    "SELECT person_id, source, speaker_raw, role FROM speaker_map"
                    " WHERE person_id=? ORDER BY source, speaker_raw", (person_id,))]


class ChatLinks:
    def __init__(self, conn):
        self.conn = conn

    def link(self, person_id: int, platform: str, chat_key: str) -> None:
        with tx(self.conn) as c:
            c.execute(
                "INSERT INTO chat_links(person_id, platform, chat_key) VALUES (?,?,?)"
                " ON CONFLICT(platform, chat_key) DO UPDATE SET person_id=excluded.person_id",
                (person_id, platform, chat_key))

    def person_for(self, platform: str, chat_key: str) -> Optional[int]:
        r = self.conn.execute("SELECT person_id FROM chat_links WHERE platform=? AND chat_key=?",
                              (platform, chat_key)).fetchone()
        return r[0] if r else None

    def list(self, person_id: int) -> list[ChatLink]:
        return [ChatLink(person_id=r[0], platform=r[1], chat_key=r[2])
                for r in self.conn.execute(
                    "SELECT person_id, platform, chat_key FROM chat_links WHERE person_id=?"
                    " ORDER BY platform, chat_key", (person_id,))]

    def unlink(self, platform: str, chat_key: str) -> None:
        with tx(self.conn) as c:
            c.execute("DELETE FROM chat_links WHERE platform=? AND chat_key=?", (platform, chat_key))
