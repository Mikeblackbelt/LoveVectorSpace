"""Next-step cards: propose (tool), auto/on-demand generation, check-in trigger cards."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from analyzer.service.facade import InvalidInput

from .checkins import checkin_triggers
from .loop import run_agent
from .tools import STEP_KINDS

log = logging.getLogger("analyzer.agent")
AUTO_CAP = timedelta(days=1)
GENERATE_PROMPT = ("Review the owner's current overview and context and propose next-step cards "
                   "with propose_next_step, only where warranted.")


def propose(svc, pid: int, args: dict) -> dict:
    kind = args.get("kind")
    if kind not in STEP_KINDS:
        raise InvalidInput(f"kind must be one of {list(STEP_KINDS)}", "kind")
    title, why = str(args.get("title", "")).strip(), str(args.get("why", "")).strip()
    refs = args.get("evidence_refs") or []
    if not title or not why:
        raise InvalidInput("title and why are required", "title")
    if not isinstance(refs, list) or not all(isinstance(r, str) for r in refs):
        raise InvalidInput("evidence_refs must be a list of strings", "evidence_refs")
    card = svc._add_step_dedup(pid, kind, title[:200], why[:600], refs[:10])
    return card if card is not None else {"duplicate": True, "note": "a similar card exists; dropped"}


def generate_next_steps(svc, pid: int, on_demand: bool, now: datetime | None = None) -> list[dict]:
    """Returns the cards created. Auto runs are capped at one per person per day."""
    now = now or datetime.now(timezone.utc)
    if not on_demand and not svc._auto_run_allowed(pid, now):
        return []
    created: list[dict] = []
    for draft in checkin_triggers(svc, pid, now):
        card = svc._add_step_dedup(pid, draft["kind"], draft["title"], draft["why"], draft["evidence_refs"])
        if card:
            created.append(card)
    client = svc._agent_client()
    if client is not None:
        before = svc._max_step_id()
        try:
            for ev in run_agent(svc, client, None, GENERATE_PROMPT, "chat", pid, background=True):
                if ev["type"] == "error":
                    break
        except Exception as e:
            log.warning("next-step generation failed: %s", e.__class__.__name__)
        created += svc._steps_after(pid, before)
    if created:
        svc._events.publish(svc.user_id, {"type": "next_steps", "person_id": pid, "count": len(created)})
    return created
