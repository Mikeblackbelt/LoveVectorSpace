"""In-memory sliding-window counters (single process)."""
from __future__ import annotations

import math
import threading
import time
from collections import deque


class SlidingWindow:
    def __init__(self, limit: int, window_s: float, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window_s, clock
        self._hits: dict[object, deque] = {}
        self._lock = threading.Lock()

    def _prune(self, key: object, now: float) -> deque:
        dq = self._hits.setdefault(key, deque())
        while dq and now - dq[0][0] >= self.window:
            dq.popleft()
        return dq

    def retry_after(self, key: object, cost: int = 0) -> int:
        """0 if `cost` more hits fit in the window, else seconds until they would."""
        with self._lock:
            now = self.clock()
            dq = self._prune(key, now)
            used = sum(n for _, n in dq)
            if cost > self.limit:
                return math.ceil(self.window)
            if used + cost <= self.limit and (cost > 0 or used < self.limit):
                return 0
            if not dq:
                return 0
            return max(1, math.ceil(self.window - (now - dq[0][0])))

    def hit(self, key: object, n: int = 1) -> None:
        with self._lock:
            now = self.clock()
            self._prune(key, now).append((now, n))

    def reset(self, key: object) -> None:
        with self._lock:
            self._hits.pop(key, None)
