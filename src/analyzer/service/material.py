"""Material-change detection (v2 7a.4): decides whether auto next-steps may run."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .analysis import max_severity


def material_change(prev: dict | None, cur: dict, last_cards_at: datetime | None,
                    now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    if prev is None:
        return any(m["status"] == "ok" for m in cur["metrics"])
    pi, ci = prev.get("_internal", {}), cur.get("_internal", {})
    if pi.get("bands") != ci.get("bands"):
        return True
    if ci.get("change_points"):
        return True
    if max_severity(prev) != max_severity(cur):
        return True
    pscales = {s["scale_id"]: s["subscales"] for s in prev["scales"]}
    for s in cur["scales"]:
        if pscales.get(s["scale_id"]) != s["subscales"]:
            return True
    if last_cards_at is None:
        return True
    return now - last_cards_at >= timedelta(days=7)
