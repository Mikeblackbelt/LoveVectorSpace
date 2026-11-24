"""Repositories over accounts.db. All SQL is parameterised; all access goes through one lock."""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from analyzer.store.db import open_db

from .schema import migrate_accounts


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_iso() -> str:
    return iso(utcnow())


def in_iso(delta: timedelta) -> str:
    return iso(utcnow() + delta)


def new_id() -> str:
    return uuid.uuid4().hex


@dataclass
class UserRow:
    id: str
    email: str
    email_verified: bool
    display_name: str | None
    password_hash: str | None
    google_sub: str | None
    apple_sub: str | None
    role: str
    wrapped_dek: bytes
    created_at: str
    deleted_at: str | None

    @property
    def providers(self) -> list[str]:
        out = []
        if self.password_hash:
            out.append("password")
        if self.google_sub:
            out.append("google")
        if self.apple_sub:
            out.append("apple")
        return out

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "email": self.email,
            "email_verified": self.email_verified,
            "display_name": self.display_name,
            "role": self.role,
            "providers": self.providers,
            "created_at": self.created_at,
        }


_USER_COLS = ("id, email, email_verified, display_name, password_hash, google_sub, apple_sub, role, "
              "wrapped_dek, created_at, deleted_at")


def _user(row) -> UserRow | None:
    if row is None:
        return None
    return UserRow(row[0], row[1], bool(row[2]), row[3], row[4], row[5], row[6], row[7], bytes(row[8]),
                   row[9], row[10])


class AccountsDB:
    """accounts.db (SQLCipher keyed by MASTER_KEY) behind a single re-entrant lock."""

    def __init__(self, path: Path, master_key: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = open_db(path, master_key, migrator=migrate_accounts)
        self.lock = threading.RLock()

    def close(self) -> None:
        with self.lock:
            self.conn.close()

    def q(self, sql: str, args: tuple = ()) -> list:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def one(self, sql: str, args: tuple = ()):
        with self.lock:
            return self.conn.execute(sql, args).fetchone()

    def x(self, sql: str, args: tuple = ()) -> int:
        with self.lock:
            cur = self.conn.execute(sql, args)
            self.conn.commit()
            return cur.rowcount


class Users:
    def __init__(self, db: AccountsDB):
        self.db = db

    def get(self, user_id: str) -> UserRow | None:
        return _user(self.db.one(f"SELECT {_USER_COLS} FROM users WHERE id=? AND deleted_at IS NULL", (user_id,)))

    def by_email(self, email: str) -> UserRow | None:
        return _user(self.db.one(f"SELECT {_USER_COLS} FROM users WHERE email=? AND deleted_at IS NULL",
                                 (email.lower(),)))

    def by_sub(self, provider: str, sub: str) -> UserRow | None:
        col = {"google": "google_sub", "apple": "apple_sub"}[provider]
        return _user(self.db.one(f"SELECT {_USER_COLS} FROM users WHERE {col}=? AND deleted_at IS NULL", (sub,)))

    def any_admin(self) -> bool:
        return self.db.one("SELECT 1 FROM users WHERE role='admin' AND deleted_at IS NULL") is not None

    def create(self, *, email: str, wrapped_dek: bytes, user_id: str, password_hash: str | None = None,
               display_name: str | None = None, role: str = "user", email_verified: bool = False,
               google_sub: str | None = None, apple_sub: str | None = None) -> UserRow:
        self.db.x(
            "INSERT INTO users(id, email, email_verified, display_name, password_hash, google_sub, apple_sub, role,"
            " wrapped_dek, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (user_id, email.lower(), int(email_verified), display_name, password_hash, google_sub, apple_sub, role,
             wrapped_dek, now_iso()),
        )
        return self.get(user_id)

    _UPDATABLE = {"email_verified", "display_name", "password_hash", "google_sub", "apple_sub", "role"}

    def update(self, user_id: str, **fields: Any) -> None:
        bad = set(fields) - self._UPDATABLE
        if bad:
            raise ValueError(f"not updatable: {bad}")
        if not fields:
            return
        cols = ", ".join(f"{k}=?" for k in fields)
        vals = tuple(int(v) if isinstance(v, bool) else v for v in fields.values())
        self.db.x(f"UPDATE users SET {cols} WHERE id=?", vals + (user_id,))

    def hard_delete(self, user_id: str) -> None:
        with self.db.lock:
            c = self.db.conn
            for sql in ("DELETE FROM refresh_tokens WHERE user_id=?", "DELETE FROM email_tokens WHERE user_id=?",
                        "DELETE FROM api_tokens WHERE user_id=?", "DELETE FROM invites WHERE created_by=? AND used_by IS NULL",
                        "DELETE FROM users WHERE id=?"):
                c.execute(sql, (user_id,))
            c.commit()


class Invites:
    def __init__(self, db: AccountsDB):
        self.db = db

    @staticmethod
    def _row(r) -> dict[str, Any] | None:
        if r is None:
            return None
        return {"code": r[0], "email": r[1], "created_at": r[2], "expires_at": r[3], "used_by": r[4],
                "created_by": r[5]}

    def create(self, code: str, created_by: str | None, email: str | None, expires_days: int) -> dict[str, Any]:
        self.db.x("INSERT INTO invites(code, created_by, email, created_at, expires_at) VALUES (?,?,?,?,?)",
                  (code, created_by, email.lower() if email else None, now_iso(), in_iso(timedelta(days=expires_days))))
        return self.get(code)

    def get(self, code: str) -> dict[str, Any] | None:
        return self._row(self.db.one(
            "SELECT code, email, created_at, expires_at, used_by, created_by FROM invites WHERE code=?", (code,)))

    def list(self) -> list[dict[str, Any]]:
        return [self._row(r) for r in self.db.q(
            "SELECT code, email, created_at, expires_at, used_by, created_by FROM invites ORDER BY created_at DESC")]

    def delete(self, code: str) -> bool:
        return self.db.x("DELETE FROM invites WHERE code=?", (code,)) > 0

    def usable(self, code: str | None, email: str) -> dict[str, Any] | None:
        if not code:
            return None
        inv = self.get(code)
        if inv is None or inv["used_by"] or inv["expires_at"] <= now_iso():
            return None
        if inv["email"] and inv["email"] != email.lower():
            return None
        return inv

    def consume(self, code: str, user_id: str) -> bool:
        return self.db.x("UPDATE invites SET used_by=? WHERE code=? AND used_by IS NULL", (user_id, code)) == 1


class RefreshTokens:
    def __init__(self, db: AccountsDB):
        self.db = db

    def create(self, user_id: str, family_id: str, token_hash: str, device: str | None, days: int) -> str:
        tid = new_id()
        now = now_iso()
        self.db.x(
            "INSERT INTO refresh_tokens(id, user_id, family_id, token_hash, device, created_at, last_used_at, expires_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (tid, user_id, family_id, token_hash, device, now, now, in_iso(timedelta(days=days))),
        )
        return tid

    def by_hash(self, token_hash: str) -> dict[str, Any] | None:
        r = self.db.one("SELECT id, user_id, family_id, token_hash, device, expires_at, revoked_at, replaced_by"
                        " FROM refresh_tokens WHERE token_hash=?", (token_hash,))
        if r is None:
            return None
        return dict(zip(("id", "user_id", "family_id", "token_hash", "device", "expires_at", "revoked_at",
                         "replaced_by"), r))

    def mark_rotated(self, token_id: str, replaced_by: str) -> bool:
        """Atomically retire a token; False if someone else already did (concurrent reuse)."""
        return self.db.x("UPDATE refresh_tokens SET revoked_at=?, replaced_by=? WHERE id=? AND revoked_at IS NULL",
                         (now_iso(), replaced_by, token_id)) == 1

    def revoke_family(self, family_id: str) -> int:
        return self.db.x("UPDATE refresh_tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL",
                         (now_iso(), family_id))

    def revoke_user(self, user_id: str, except_family: str | None = None) -> int:
        return self.db.x(
            "UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND family_id IS NOT ?",
            (now_iso(), user_id, except_family))

    def family_active(self, family_id: str) -> bool:
        return self.db.one("SELECT 1 FROM refresh_tokens WHERE family_id=? AND revoked_at IS NULL AND expires_at>?",
                           (family_id, now_iso())) is not None

    def family_owner(self, family_id: str) -> str | None:
        r = self.db.one("SELECT user_id FROM refresh_tokens WHERE family_id=? LIMIT 1", (family_id,))
        return r[0] if r else None

    def sessions(self, user_id: str) -> list[dict[str, Any]]:
        rows = self.db.q(
            "SELECT family_id, MIN(created_at), MAX(last_used_at),"
            " (SELECT device FROM refresh_tokens d WHERE d.family_id=t.family_id ORDER BY created_at LIMIT 1)"
            " FROM refresh_tokens t WHERE user_id=? GROUP BY family_id"
            " HAVING SUM(CASE WHEN revoked_at IS NULL AND expires_at>? THEN 1 ELSE 0 END) > 0"
            " ORDER BY MAX(last_used_at) DESC",
            (user_id, now_iso()))
        return [{"id": r[0], "created_at": r[1], "last_used_at": r[2], "device": r[3]} for r in rows]


class EmailTokens:
    def __init__(self, db: AccountsDB):
        self.db = db

    def create(self, user_id: str, kind: str, token_hash: str, ttl: timedelta) -> None:
        self.db.x("INSERT INTO email_tokens(id, user_id, kind, token_hash, expires_at) VALUES (?,?,?,?,?)",
                  (new_id(), user_id, kind, token_hash, in_iso(ttl)))

    def consume(self, kind: str, token_hash: str) -> str | None:
        """Single use: returns the user id if the token is valid, marking it used."""
        with self.db.lock:
            r = self.db.one("SELECT id, user_id, token_hash FROM email_tokens"
                            " WHERE kind=? AND token_hash=? AND used_at IS NULL AND expires_at>?",
                            (kind, token_hash, now_iso()))
            if r is None:
                return None
            self.db.x("UPDATE email_tokens SET used_at=? WHERE id=?", (now_iso(), r[0]))
            return r[1]

    def invalidate(self, user_id: str, kind: str) -> None:
        self.db.x("UPDATE email_tokens SET used_at=? WHERE user_id=? AND kind=? AND used_at IS NULL",
                  (now_iso(), user_id, kind))


class ApiTokens:
    def __init__(self, db: AccountsDB):
        self.db = db
    _COLS = "id, kind, label, created_at, last_used_at, revoked_at"

    @staticmethod
    def _info(r) -> dict[str, Any]:
        return dict(zip(("id", "kind", "label", "created_at", "last_used_at", "revoked_at"), r))

    def create(self, user_id: str, kind: str, label: str | None, token_hash: str) -> dict[str, Any]:
        tid = new_id()
        self.db.x("INSERT INTO api_tokens(id, user_id, kind, label, token_hash, created_at) VALUES (?,?,?,?,?,?)",
                  (tid, user_id, kind, label, token_hash, now_iso()))
        return self._info(self.db.one(f"SELECT {self._COLS} FROM api_tokens WHERE id=?", (tid,)))

    def list(self, user_id: str) -> list[dict[str, Any]]:
        return [self._info(r) for r in self.db.q(
            f"SELECT {self._COLS} FROM api_tokens WHERE user_id=? ORDER BY created_at DESC", (user_id,))]

    def revoke(self, user_id: str, token_id: str) -> bool:
        return self.db.x("UPDATE api_tokens SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL",
                         (now_iso(), token_id, user_id)) == 1

    def owned(self, user_id: str, token_id: str) -> bool:
        return self.db.one("SELECT 1 FROM api_tokens WHERE id=? AND user_id=?", (token_id, user_id)) is not None

    def lookup(self, token_hash: str) -> dict[str, Any] | None:
        r = self.db.one("SELECT id, user_id, kind, token_hash FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL",
                        (token_hash,))
        if r is None:
            return None
        self.db.x("UPDATE api_tokens SET last_used_at=? WHERE id=?", (now_iso(), r[0]))
        return {"id": r[0], "user_id": r[1], "kind": r[2], "token_hash": r[3]}


class Audit:
    def __init__(self, db: AccountsDB):
        self.db = db

    def log(self, user_id: str | None, event: str, ip_hash: str | None = None) -> None:
        self.db.x("INSERT INTO audit(user_id, event, at, ip_hash) VALUES (?,?,?,?)", (user_id, event, now_iso(), ip_hash))

    def events(self, user_id: str | None = None) -> list[tuple]:
        if user_id is None:
            return self.db.q("SELECT user_id, event, at, ip_hash FROM audit ORDER BY id")
        return self.db.q("SELECT user_id, event, at, ip_hash FROM audit WHERE user_id=? ORDER BY id", (user_id,))
