"""In-memory sliding-window counters (single process)."""
from __future__ import annotations

import math
import threading
import time
from collections import deque


class SlidingWindow:
    def __init__(self, limit: int, window_s: float, clock=time.monotonic, sweep_every_s: float = 60.0):
        self.limit, self.window, self.clock = limit, window_s, clock
        self._hits: dict[object, deque] = {}
        self._lock = threading.Lock()
        self._sweep_every = sweep_every_s
        self._last_sweep = clock()

    def _prune(self, key: object, now: float) -> deque:
        dq = self._hits.setdefault(key, deque())
        while dq and now - dq[0][0] >= self.window:
            dq.popleft()
        return dq

    def _sweep(self, now: float) -> None:
        """Drop keys whose hits have all expired (bounded memory)."""
        if now - self._last_sweep < self._sweep_every:
            return
        self._last_sweep = now
        for key in list(self._hits):
            dq = self._hits[key]
            while dq and now - dq[0][0] >= self.window:
                dq.popleft()
            if not dq:
                del self._hits[key]

    def _wait(self, dq: deque, now: float, cost: int) -> int:
        if cost > self.limit:
            return math.ceil(self.window)
        used = sum(n for _, n in dq)
        if used + cost <= self.limit:
            return 0
        return max(1, math.ceil(self.window - (now - dq[0][0]))) if dq else 0

    def retry_after(self, key: object, cost: int = 1) -> int:
        """0 if `cost` more hits fit in the window, else seconds until they would."""
        with self._lock:
            now = self.clock()
            return self._wait(self._prune(key, now), now, cost)

    def try_hit(self, key: object, n: int = 1) -> int:
        """Atomically reserve `n` slots: returns 0 (reserved) or the Retry-After seconds (nothing reserved)."""
        with self._lock:
            now = self.clock()
            self._sweep(now)
            dq = self._prune(key, now)
            wait = self._wait(dq, now, n)
            if wait == 0:
                dq.append((now, n))
            return wait

    def hit(self, key: object, n: int = 1) -> None:
        with self._lock:
            now = self.clock()
            self._sweep(now)
            self._prune(key, now).append((now, n))

    def refund(self, key: object) -> None:
        """Give back the most recent reservation of `key` (e.g. the attempt succeeded)."""
        with self._lock:
            dq = self._hits.get(key)
            if dq:
                dq.pop()

    def reset(self, key: object) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def key_count(self) -> int:
        with self._lock:
            return len(self._hits)
