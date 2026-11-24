"""Quarantine for data of accounts that were taken over before their email was verified.

When an unverified account is claimed by the address owner (password reset, or first Google/Apple
sign-in), the old database is not deleted: its file moves to DATA_DIR/quarantine/<user_id>-<ts>.db and its
wrapped data key is kept in accounts.db, so an admin can restore it for QUARANTINE_DAYS
(`scripts/restore_quarantine.py <user_id>`). Older entries are purged at startup and daily.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import timedelta
from pathlib import Path
from typing import Any

from .repos import AccountsDB, iso, now_iso, utcnow

log = logging.getLogger("analyzer.accounts")
QUARANTINE_DAYS = 30
SIDE_SUFFIXES = ("-wal", "-shm", "-journal")


def move_with_retry(src: Path, dst: Path, attempts: int = 50, delay: float = 0.1) -> None:
    """os.replace with bounded retries (Windows may hold a just-closed handle briefly)."""
    for attempt in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay)


def move_db(src: Path, dst: Path, attempts: int = 50) -> None:
    """Move a SQLite file and its side files; on failure, put back whatever already moved and re-raise."""
    moved: list[tuple[Path, Path]] = []
    try:
        for suffix in ("", *SIDE_SUFFIXES):
            s, d = src.with_name(src.name + suffix), dst.with_name(dst.name + suffix)
            if s.exists():
                move_with_retry(s, d, attempts)
                moved.append((s, d))
    except OSError:
        for s, d in reversed(moved):
            try:
                os.replace(d, s)
            except OSError:
                log.error("could not roll back a quarantine move")
        raise


class Quarantine:
    def __init__(self, db: AccountsDB, data_dir: Path):
        self.db = db
        self.dir = Path(data_dir) / "quarantine"
        self.dir.mkdir(parents=True, exist_ok=True)

    def target(self, user_id: str) -> Path:
        return self.dir / f"{user_id}-{time.time_ns()}.db"

    def add(self, user_id: str, path: Path, wrapped_dek: bytes) -> None:
        self.db.x("INSERT INTO quarantine(user_id, path, wrapped_dek, created_at) VALUES (?,?,?,?)",
                  (user_id, str(path), wrapped_dek, now_iso()))

    def entries(self, user_id: str) -> list[dict[str, Any]]:
        rows = self.db.q("SELECT id, user_id, path, wrapped_dek, created_at FROM quarantine WHERE user_id=?"
                         " ORDER BY id DESC", (user_id,))
        return [{"id": r[0], "user_id": r[1], "path": Path(r[2]), "wrapped_dek": bytes(r[3]), "created_at": r[4]}
                for r in rows]

    def remove(self, entry_id: int) -> None:
        self.db.x("DELETE FROM quarantine WHERE id=?", (entry_id,))

    def purge(self, days: int = QUARANTINE_DAYS) -> int:
        """Delete quarantined files and rows older than `days`."""
        cutoff = iso(utcnow() - timedelta(days=days))
        rows = self.db.q("SELECT id, path FROM quarantine WHERE created_at < ?", (cutoff,))
        for entry_id, path in rows:
            p = Path(path)
            for suffix in ("", *SIDE_SUFFIXES):
                try:
                    p.with_name(p.name + suffix).unlink(missing_ok=True)
                except OSError:
                    log.warning("could not delete a quarantined file; will retry")
                    break
            else:
                self.remove(entry_id)
        return len(rows)


def restore(db: AccountsDB, data_dir: Path, user_id: str) -> Path:
    """Put the user's most recent quarantined database back (run while the server is stopped).

    The database currently in place, if any, is itself quarantined first, so nothing is lost."""
    q = Quarantine(db, data_dir)
    entries = q.entries(user_id)
    if not entries:
        raise LookupError("no quarantined data for this user")
    entry = entries[0]
    row = db.one("SELECT wrapped_dek FROM users WHERE id=?", (user_id,))
    if row is None:
        raise LookupError("unknown user")
    live = Path(data_dir) / "users" / f"{user_id}.db"
    if live.exists():
        aside = q.target(user_id)
        move_db(live, aside)
        q.add(user_id, aside, bytes(row[0]))
    move_db(entry["path"], live)
    with db.lock:
        db.conn.execute("UPDATE users SET wrapped_dek=? WHERE id=?", (entry["wrapped_dek"], user_id))
        db.conn.execute("DELETE FROM quarantine WHERE id=?", (entry["id"],))
        db.conn.commit()
    return live
