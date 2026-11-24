"""Per-user SQLCipher databases: path layout, LRU connection cache, per-user locks."""
from __future__ import annotations

import logging
import re
import threading
from collections import OrderedDict
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from analyzer.store.db import open_db

log = logging.getLogger("analyzer.accounts")
_ID = re.compile(r"^[0-9a-f]{32}$")


@dataclass
class UserHandle:
    user_id: str
    conn: Any
    service: Any
    lock: threading.RLock = field(default_factory=threading.RLock)
    pins: int = 0


class UserDBManager:
    """Opens each user's DB with their DEK (hex) and keeps at most `capacity` open.

    Entries are pinned while a request or stream uses them and are only evicted when unpinned.
    All facade calls for one user are serialised by `handle.lock`.
    """

    def __init__(self, data_dir: Path, key_for: Callable[[str], str],
                 make_service: Callable[[str, Any], Any], capacity: int = 32):
        self.users_dir = Path(data_dir) / "users"
        self.users_dir.mkdir(parents=True, exist_ok=True)
        self._key_for = key_for
        self._make_service = make_service
        self.capacity = capacity
        self._entries: OrderedDict[str, UserHandle] = OrderedDict()
        self._cv = threading.Condition(threading.RLock())

    def path(self, user_id: str) -> Path:
        if not _ID.match(user_id):
            raise ValueError("bad user id")
        return self.users_dir / f"{user_id}.db"

    def open_count(self) -> int:
        with self._cv:
            return len(self._entries)

    @contextmanager
    def use(self, user_id: str) -> Iterator[UserHandle]:
        h = self._acquire(user_id)
        try:
            yield h
        finally:
            self.release(h)

    def acquire(self, user_id: str) -> UserHandle:
        """Pin and return a handle; the caller must call release()."""
        return self._acquire(user_id)

    def _acquire(self, user_id: str) -> UserHandle:
        with self._cv:
            h = self._entries.get(user_id)
            if h is not None:
                return self._pin(h)
        # Open outside the cache lock: _key_for reads accounts.db, whose lock may be held by a caller that is
        # itself waiting for this cache (signup creating the DB). Never hold both in cache-then-accounts order.
        conn = open_db(self.path(user_id), self._key_for(user_id))
        try:
            service = self._make_service(user_id, conn)
        except Exception:
            conn.close()
            raise
        fresh = UserHandle(user_id, conn, service)
        with self._cv:
            h = self._entries.get(user_id)
            if h is None:
                self._entries[user_id] = h = fresh
                fresh = None
            pinned = self._pin(h)
        if fresh is not None:          # lost a race with a concurrent opener
            self._close(fresh)
        return pinned

    def _pin(self, h: UserHandle) -> UserHandle:
        self._entries.move_to_end(h.user_id)
        h.pins += 1
        self._evict_overflow()
        return h

    def release(self, h: UserHandle) -> None:
        with self._cv:
            h.pins -= 1
            self._evict_overflow()
            self._cv.notify_all()

    def _evict_overflow(self) -> None:
        if len(self._entries) <= self.capacity:
            return
        for uid in list(self._entries):
            if len(self._entries) <= self.capacity:
                break
            h = self._entries[uid]
            if h.pins == 0:
                del self._entries[uid]
                self._close(h)

    @staticmethod
    def _close(h: UserHandle) -> None:
        with h.lock:
            close = getattr(h.service, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    log.exception("service close failed")
            try:
                h.conn.close()
            except Exception:
                log.exception("connection close failed")

    def evict(self, user_id: str, timeout: float = 30.0) -> None:
        """Close the user's connection, waiting for in-flight users to release it."""
        with self._cv:
            h = self._entries.get(user_id)
            if h is None:
                return
            self._cv.wait_for(lambda: h.pins == 0, timeout=timeout)
            self._entries.pop(user_id, None)
            self._close(h)

    def delete(self, user_id: str) -> None:
        """Hard-delete the user's database file (and SQLite side files)."""
        self.evict(user_id)
        base = self.path(user_id)
        for suffix in ("", "-wal", "-shm", "-journal"):
            p = base.with_name(base.name + suffix)
            if p.exists():
                p.unlink()

    def close_all(self) -> None:
        with self._cv:
            for h in list(self._entries.values()):
                self._close(h)
            self._entries.clear()
