import json
from typing import Any, Optional

from ._base import now_str, parse, tx
from .models import AgentMessage, AgentRole, AgentThread

_ROLES = ("user", "assistant", "tool", "system")
_MSG_COLS = "id, thread_id, role, content, tool_calls, created_at"


def _msg(r) -> AgentMessage:
    return AgentMessage(id=r[0], thread_id=r[1], role=r[2], content=r[3],
                        tool_calls=json.loads(r[4]) if r[4] is not None else None,
                        created_at=parse(r[5]))


class AgentStore:
    def __init__(self, conn):
        self.conn = conn

    def new_thread(self, person_id: int, kind: str) -> AgentThread:
        with tx(self.conn) as c:
            tid = c.execute("INSERT INTO agent_threads(person_id, kind, created_at) VALUES (?,?,?)",
                            (person_id, kind, now_str())).lastrowid
        return self.thread(tid)

    def add_message(self, thread_id: int, role: AgentRole, content: str,
                    tool_calls: Optional[list[dict[str, Any]]] = None) -> AgentMessage:
        if role not in _ROLES:
            raise ValueError(f"bad role {role!r}")
        with tx(self.conn) as c:
            mid = c.execute(
                "INSERT INTO agent_messages(thread_id, role, content, tool_calls, created_at)"
                " VALUES (?,?,?,?,?)",
                (thread_id, role, content,
                 json.dumps(tool_calls) if tool_calls is not None else None, now_str())).lastrowid
        return _msg(self.conn.execute(
            f"SELECT {_MSG_COLS} FROM agent_messages WHERE id=?", (mid,)).fetchone())

    def thread(self, thread_id: int) -> Optional[AgentThread]:
        r = self.conn.execute("SELECT id, person_id, kind, created_at FROM agent_threads WHERE id=?",
                              (thread_id,)).fetchone()
        if r is None:
            return None
        msgs = [_msg(m) for m in self.conn.execute(
            f"SELECT {_MSG_COLS} FROM agent_messages WHERE thread_id=? ORDER BY id", (thread_id,))]
        return AgentThread(id=r[0], person_id=r[1], kind=r[2], created_at=parse(r[3]), messages=msgs)

    def threads(self, person_id: int) -> list[AgentThread]:
        """Thread headers (without messages), oldest first."""
        return [AgentThread(id=r[0], person_id=r[1], kind=r[2], created_at=parse(r[3]))
                for r in self.conn.execute(
                    "SELECT id, person_id, kind, created_at FROM agent_threads"
                    " WHERE person_id=? ORDER BY id", (person_id,))]
