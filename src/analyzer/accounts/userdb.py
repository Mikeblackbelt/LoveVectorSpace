"""Per-user SQLCipher databases: path layout, LRU connection cache, per-user locks.

Lifetime contract with the service layer (docs/api.md "Service lifetime"): the per-user lock is the
service's own `service.lock` (one RLock per user, shared by every service object of that user). To evict
or delete: `service.close(timeout)` WITHOUT holding any lock, then `with service.lock: conn.close()`.
"""
from __future__ import annotations

import logging
import re
import threading
from collections import OrderedDict
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from analyzer.store.db import open_db

log = logging.getLogger("analyzer.accounts")
_ID = re.compile(r"^[0-9a-f]{32}$")
CLOSE_TIMEOUT_S = 10.0


@dataclass
class UserHandle:
    user_id: str
    conn: Any
    service: Any
    lock: Any
    pins: int = 0


class UserDBManager:
    """Opens each user's DB with their DEK (hex) and keeps at most `capacity` open.

    Entries are pinned while a request or stream uses them and are only evicted when unpinned.
    All facade calls for one user are serialised by `handle.lock` (== `service.lock`).
    """

    def __init__(self, data_dir: Path, key_for: Callable[[str], str],
                 make_service: Callable[[str, Any], Any], capacity: int = 32,
                 close_user: Callable[[str], None] | None = None):
        self.users_dir = Path(data_dir) / "users"
        self.users_dir.mkdir(parents=True, exist_ok=True)
        self._key_for = key_for
        self._make_service = make_service
        self._close_user = close_user
        self.capacity = capacity
        self._entries: OrderedDict[str, UserHandle] = OrderedDict()
        self._cv = threading.Condition(threading.RLock())

    def path(self, user_id: str) -> Path:
        if not _ID.match(user_id):
            raise ValueError("bad user id")
        return self.users_dir / f"{user_id}.db"

    def open_existing(self, user_id: str):
        """conn_opener for background jobs: never creates a file (raises for a deleted user)."""
        return open_db(self.path(user_id), self._key_for(user_id), create=False)

    def open_count(self) -> int:
        with self._cv:
            return len(self._entries)

    @contextmanager
    def use(self, user_id: str, create: bool = False) -> Iterator[UserHandle]:
        h = self.acquire(user_id, create=create)
        try:
            yield h
        finally:
            self.release(h)

    def acquire(self, user_id: str, create: bool = False) -> UserHandle:
        """Pin and return a handle; the caller must call release(). Only signup passes create=True."""
        with self._cv:
            h = self._entries.get(user_id)
            evicted = self._pin(h) if h is not None else []
        if h is None:
            # Open outside the cache lock: _key_for reads accounts.db and for_user takes the user lock.
            conn = open_db(self.path(user_id), self._key_for(user_id), create=create)
            try:
                service = self._make_service(user_id, conn)
            except Exception:
                conn.close()
                raise
            lock = getattr(service, "lock", None) or threading.RLock()
            fresh: UserHandle | None = UserHandle(user_id, conn, service, lock)
            with self._cv:
                h = self._entries.get(user_id)
                if h is None:
                    self._entries[user_id] = h = fresh
                    fresh = None
                evicted = self._pin(h)
            if fresh is not None:          # lost a race with a concurrent opener
                evicted.append(fresh)
        self._close_all(evicted)
        return h

    def release(self, h: UserHandle) -> None:
        with self._cv:
            h.pins -= 1
            evicted = self._take_overflow()
            self._cv.notify_all()
        self._close_all(evicted)

    def _pin(self, h: UserHandle) -> list[UserHandle]:
        self._entries.move_to_end(h.user_id)
        h.pins += 1
        return self._take_overflow()

    def _take_overflow(self) -> list[UserHandle]:
        """Remove unpinned LRU entries over capacity (under _cv); the caller closes them outside it."""
        out = []
        for uid in list(self._entries):
            if len(self._entries) <= self.capacity:
                break
            h = self._entries[uid]
            if h.pins == 0:
                del self._entries[uid]
                out.append(h)
        return out

    def _close_all(self, handles: list[UserHandle]) -> None:
        for h in handles:
            self._close(h)

    @staticmethod
    def _close(h: UserHandle) -> None:
        close = getattr(h.service, "close", None)
        if callable(close):
            try:
                close(timeout=CLOSE_TIMEOUT_S)        # never while holding the user lock
            except TypeError:
                close()
            except Exception:
                log.exception("service close failed")
        with h.lock:
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
        """Hard-delete the user's database file (and SQLite side files) after stopping all their work."""
        with self._cv:
            h = self._entries.get(user_id)
            if h is not None:
                self._cv.wait_for(lambda: h.pins == 0, timeout=30.0)
                self._entries.pop(user_id, None)
        if self._close_user is not None:
            try:
                self._close_user(user_id)        # closes every service of the user, forgets its state
            except Exception:
                log.exception("close_user failed")
        if h is not None:
            self._close(h)
        base = self.path(user_id)
        for suffix in ("", "-wal", "-shm", "-journal"):
            p = base.with_name(base.name + suffix)
            if p.exists():
                p.unlink()

    def close_all(self) -> None:
        with self._cv:
            handles = list(self._entries.values())
            self._entries.clear()
        self._close_all(handles)
