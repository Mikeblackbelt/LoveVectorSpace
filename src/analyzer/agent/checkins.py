"""Check-in triggers (v2 5.5): deterministic reflect-card drafts, no LLM needed."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .interview import CHECKIN_FIRST as CHECKIN_FIRST_Q  # noqa: F401  (re-export)

IDLE_DAYS = 10
MIN_RECENT_MESSAGES = 5


def checkin_triggers(svc, pid: int, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    drafts: list[dict] = []
    cutoff = now - timedelta(days=IDLE_DAYS)
    last_inter = svc._last_interaction_ts(pid)
    chatting = svc._message_count_since(pid, cutoff) >= MIN_RECENT_MESSAGES
    first_msg = svc._first_message_ts(pid)
    started_before_cutoff = first_msg is not None and first_msg < cutoff
    if chatting and started_before_cutoff and (last_inter is None or last_inter < cutoff):
        drafts.append({
            "kind": "reflect", "title": "Log a recent hangout, or note that you haven't met",
            "why": f"No hangout has been logged for {IDLE_DAYS} days while you have kept chatting. "
                   "A short check-in keeps the in-person side of the picture current.",
            "evidence_refs": ["metric:meetups_per_month"]})
    change = svc._band_change(pid, "message_share")
    if change:
        drafts.append({
            "kind": "reflect", "title": "Message balance shifted; anything change in person?",
            "why": f"Who sends more messages moved from '{change[0]}' to '{change[1]}'. "
                   "Did anything happen offline that might explain it?",
            "evidence_refs": ["metric:message_share"]})
    return drafts
