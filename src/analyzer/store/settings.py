import json
from typing import Any

from ._base import tx

DEFAULTS: dict[str, Any] = {
    "owner_timezone": None,
    "agent_reads_text": True,
    "agent_enabled": True,
    "catchup_enabled": True,
}


class Settings:
    def __init__(self, conn):
        self.conn = conn

    def get(self, key: str, default: Any = None) -> Any:
        r = self.conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        if r is not None:
            return json.loads(r[0])
        if default is not None:
            return default
        return DEFAULTS.get(key)

    def set(self, key: str, value: Any) -> None:
        with tx(self.conn) as c:
            c.execute("INSERT INTO settings(key, value) VALUES (?,?)"
                      " ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))
