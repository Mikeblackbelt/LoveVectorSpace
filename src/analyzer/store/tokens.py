from __future__ import annotations

import hashlib
import hmac
import secrets

from ._base import now_str, parse, tx
from .models import TokenInfo, TokenKind


def _hash(plain: str) -> str:
    return hashlib.sha256(plain.encode()).hexdigest()


class Tokens:
    def __init__(self, conn):
        self.conn = conn

    def create(self, kind: TokenKind) -> str:
        """Return the plaintext token; only its sha256 is stored, so it is never shown again."""
        if kind not in ("api", "extension"):
            raise ValueError(f"bad kind {kind!r}")
        plain = secrets.token_urlsafe(32)
        with tx(self.conn) as c:
            c.execute("INSERT INTO tokens(kind, token_hash, created_at) VALUES (?,?,?)",
                      (kind, _hash(plain), now_str()))
        return plain

    def verify(self, kind: TokenKind, plaintext: str) -> bool:
        h = _hash(plaintext or "")
        ok = False
        for (stored,) in self.conn.execute(
                "SELECT token_hash FROM tokens WHERE kind=? AND revoked_at IS NULL", (kind,)):
            if hmac.compare_digest(stored, h):
                ok = True
        return ok

    def revoke(self, token_id: int) -> None:
        with tx(self.conn) as c:
            c.execute("UPDATE tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
                      (now_str(), token_id))

    def list(self) -> list[TokenInfo]:
        return [TokenInfo(id=r[0], kind=r[1], created_at=parse(r[2]),
                          revoked_at=parse(r[3]) if r[3] else None)
                for r in self.conn.execute(
                    "SELECT id, kind, created_at, revoked_at FROM tokens ORDER BY id")]
