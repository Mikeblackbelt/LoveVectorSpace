"""In-process pub/sub EventSink. publish() is thread-safe; subscribers only see their own user's events."""
from __future__ import annotations

import asyncio
import threading
from typing import Any


class _Sub:
    def __init__(self, user_id: str, loop: asyncio.AbstractEventLoop, maxsize: int):
        self.user_id = user_id
        self.loop = loop
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=maxsize)

    def offer(self, event: dict[str, Any]) -> None:
        try:
            self.queue.put_nowait(event)
        except asyncio.QueueFull:
            pass  # slow consumer: drop (clients refetch on reconnect)


class EventBus:
    def __init__(self, maxsize: int = 256):
        self._subs: list[_Sub] = []
        self._lock = threading.Lock()
        self.maxsize = maxsize

    def publish(self, user_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            targets = [s for s in self._subs if s.user_id == user_id]
        for s in targets:
            try:
                s.loop.call_soon_threadsafe(s.offer, dict(event))
            except RuntimeError:
                pass  # loop closed

    def subscribe(self, user_id: str) -> _Sub:
        sub = _Sub(user_id, asyncio.get_running_loop(), self.maxsize)
        with self._lock:
            self._subs.append(sub)
        return sub

    def unsubscribe(self, sub: _Sub) -> None:
        with self._lock:
            if sub in self._subs:
                self._subs.remove(sub)

    def subscriber_count(self, user_id: str | None = None) -> int:
        with self._lock:
            return sum(1 for s in self._subs if user_id is None or s.user_id == user_id)
