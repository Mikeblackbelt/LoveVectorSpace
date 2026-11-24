"""Per-user SQLCipher databases: path layout, LRU connection cache, per-user locks.

Lifetime contract with the service layer (docs/api.md "Service lifetime"): the per-user lock is the
service's own `service.lock` (one RLock per user, shared by every service object of that user). To evict
or delete: `factory.close_user(user_id)` (or `service.close`) WITHOUT holding any lock, then
`with service.lock: conn.close()`. Evictions are closed on a background thread so the request that
triggered them (usually another user's) is not delayed; the evicted user waits until that close finished.
"""
from __future__ import annotations

import logging
import re
import threading
import time
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


class UserGone(Exception):
    """The user no longer exists (deleted or deletion in progress)."""


class UserBusy(Exception):
    """The user's database is being replaced (takeover in progress): retry shortly."""


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
                 make_service: Callable[[str, Any], Any], capacity: int = 256,
                 close_user: Callable[[str], None] | None = None,
                 is_active: Callable[[str], bool] | None = None):
        self.users_dir = Path(data_dir) / "users"
        self.users_dir.mkdir(parents=True, exist_ok=True)
        self._key_for = key_for
        self._make_service = make_service
        self._close_user = close_user
        self._is_active = is_active
        self.capacity = capacity
        self._entries: OrderedDict[str, UserHandle] = OrderedDict()
        self._closing: dict[str, threading.Event] = {}
        self._cv = threading.Condition(threading.RLock())
        self._closers: list[threading.Thread] = []

    def path(self, user_id: str) -> Path:
        if not _ID.match(user_id):
            raise ValueError("bad user id")
        return self.users_dir / f"{user_id}.db"

    def _key(self, user_id: str) -> str:
        try:
            return self._key_for(user_id)
        except KeyError:
            raise UserGone(user_id) from None

    def open_existing(self, user_id: str):
        """conn_opener for background jobs: never creates a file (raises for a deleted user)."""
        return open_db(self.path(user_id), self._key(user_id), create=False)

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
        """Pin and return a handle; the caller must call release(). Only signup passes create=True.
        Refuses (UserGone) users that are deleted or being deleted, even if a connection is cached."""
        if self._is_active is not None and not self._is_active(user_id):
            raise UserGone(user_id)
        while True:
            with self._cv:
                closing = self._closing.get(user_id)
                h = self._entries.get(user_id) if closing is None else None
                evicted = self._pin(h) if h is not None else []
            if closing is None:
                break
            closing.wait(CLOSE_TIMEOUT_S * 3)   # only this user waits for its own eviction to finish
        if h is None:
            # Open outside the cache lock: _key_for reads accounts.db and for_user takes the user lock.
            if not create and not self.path(user_id).exists():
                raise UserBusy(user_id)
            conn = open_db(self.path(user_id), self._key(user_id), create=create)
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
            if fresh is not None:          # lost a race with a concurrent opener: close only our duplicate
                self._close_conn(fresh, "service")
        self._close_in_background(evicted)
        return h

    def release(self, h: UserHandle) -> None:
        with self._cv:
            h.pins -= 1
            evicted = self._take_overflow()
            self._cv.notify_all()
        self._close_in_background(evicted)

    def _pin(self, h: UserHandle) -> list[UserHandle]:
        self._entries.move_to_end(h.user_id)
        h.pins += 1
        return self._take_overflow()

    def _take_overflow(self) -> list[UserHandle]:
        """Remove unpinned LRU entries over capacity (under _cv) and mark them closing."""
        out = []
        for uid in list(self._entries):
            if len(self._entries) <= self.capacity:
                break
            h = self._entries[uid]
            if h.pins == 0:
                del self._entries[uid]
                self._closing[uid] = threading.Event()
                out.append(h)
        return out

    def _close_in_background(self, handles: list[UserHandle]) -> None:
        if not handles:
            return
        t = threading.Thread(target=self._finish_evictions, args=(handles,), name="userdb-evict", daemon=True)
        with self._cv:
            self._closers = [c for c in self._closers if c.is_alive()] + [t]
        t.start()

    def _finish_evictions(self, handles: list[UserHandle]) -> None:
        for h in handles:
            try:
                self._close_conn(h, "evict")
            finally:
                with self._cv:
                    ev = self._closing.pop(h.user_id, None)
                if ev is not None:
                    ev.set()

    def wait_closers(self, timeout: float = 30.0) -> None:
        with self._cv:
            closers = list(self._closers)
        for t in closers:
            t.join(timeout)

    @staticmethod
    def _still_busy(service: Any) -> bool:
        """True if the user's background work did not stop within the close timeout (service-layer state)."""
        st = getattr(service, "_state", None)
        cv = getattr(st, "cv", None)
        if st is None or cv is None:
            return False
        with cv:
            return bool(getattr(st, "running", 0) or getattr(st, "firing", 0))

    def _close_conn(self, h: UserHandle, mode: str) -> None:
        """Stop the user's work (never while holding a lock), then close the connection under the user lock.

        mode "evict": close the service; forget the user's service state (`close_user`) only if its background
        work actually stopped, so a job still running on its own connection is never marked failed by the
        recovery that runs on the next open. "remove": always `close_user` (deletion / quarantine).
        "service": close only this service object."""
        close = getattr(h.service, "close", None)
        if callable(close):
            try:
                close(timeout=CLOSE_TIMEOUT_S)
            except TypeError:
                close()
            except Exception:
                log.exception("service close failed")
        if mode in ("evict", "remove") and self._close_user is not None:
            if mode == "evict" and self._still_busy(h.service):
                log.warning("eviction: background work still running; keeping its state (jobs recover later)")
            else:
                try:
                    self._close_user(h.user_id)   # closes every service of the user and forgets its state
                except Exception:
                    log.exception("close_user failed")
        with h.lock:
            try:
                h.conn.close()
            except Exception:
                log.exception("connection close failed")

    def evict(self, user_id: str, timeout: float = 30.0) -> None:
        """Close the user's connection now, waiting for in-flight users to release it."""
        with self._cv:
            h = self._entries.get(user_id)
            if h is None:
                return
            self._cv.wait_for(lambda: h.pins == 0, timeout=timeout)
            self._entries.pop(user_id, None)
        self._close_conn(h, "evict")

    def _stop_user(self, user_id: str) -> None:
        """Wait for any eviction in progress, close the cached connection and forget the user's service state."""
        with self._cv:
            closing = self._closing.get(user_id)
        if closing is not None:
            closing.wait(CLOSE_TIMEOUT_S * 3)
        with self._cv:
            h = self._entries.get(user_id)
            if h is not None:
                self._cv.wait_for(lambda: h.pins == 0, timeout=30.0)
                self._entries.pop(user_id, None)
        if h is not None:
            self._close_conn(h, "remove")
        elif self._close_user is not None:
            try:
                self._close_user(user_id)
            except Exception:
                log.exception("close_user failed")

    def delete(self, user_id: str, unlink_attempts: int = 50) -> None:
        """Hard-delete the user's database file (and SQLite side files) after stopping all their work."""
        self._stop_user(user_id)
        base = self.path(user_id)
        for suffix in ("", "-wal", "-shm", "-journal"):
            p = base.with_name(base.name + suffix)
            for attempt in range(unlink_attempts):    # Windows: a just-closed handle may linger briefly
                try:
                    p.unlink(missing_ok=True)
                    break
                except PermissionError:
                    if attempt == unlink_attempts - 1:
                        raise
                    time.sleep(0.1)

    def quarantine_file(self, user_id: str, dest: Path, attempts: int = 50) -> bool:
        """Stop the user's work and move their database (and side files) to `dest`.
        Returns False if there was no file; raises OSError (nothing moved) if the move fails."""
        from .quarantine import move_db
        self._stop_user(user_id)
        src = self.path(user_id)
        if not src.exists():
            return False
        move_db(src, dest, attempts)
        return True

    def close_all(self) -> None:
        self.wait_closers()
        with self._cv:
            handles = list(self._entries.values())
            self._entries.clear()
        for h in handles:
            self._close_conn(h, "service")
