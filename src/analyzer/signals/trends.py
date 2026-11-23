from datetime import date, datetime, timedelta, timezone

import numpy as np

MIN_PRIOR = 4


def _week_start(ts: datetime) -> date:
    d = ts.astimezone(timezone.utc).date()
    return d - timedelta(days=d.weekday())


def _covered(week: date, coverage) -> bool:
    ws = datetime(week.year, week.month, week.day, tzinfo=timezone.utc)
    we = ws + timedelta(days=7)
    return any(s < we and e > ws for s, e, *_ in coverage)


def weekly_trends(msgs, metric_fns, coverage=None) -> dict[str, list[tuple[date, float | None]]]:
    """Apply each metric fn to every ISO week's messages (Monday start, UTC).

    metric_fns: {name: fn(week_msgs) -> float | None}. Every week from first to last message is
    present; weeks with no messages, no coverage interval overlap, or a None result are None.
    """
    if not msgs:
        return {name: [] for name in metric_fns}
    by_week: dict[date, list] = {}
    for m in msgs:
        by_week.setdefault(_week_start(m.ts), []).append(m)
    first, last = min(by_week), max(by_week)
    weeks = [first + timedelta(weeks=i) for i in range((last - first).days // 7 + 1)]
    out = {}
    for name, fn in metric_fns.items():
        series = []
        for w in weeks:
            wm = by_week.get(w)
            if not wm or (coverage is not None and not _covered(w, coverage)):
                series.append((w, None))
            else:
                v = fn(wm)
                series.append((w, None if v is None else float(v)))
        out[name] = series
    return out


def change_points(series, z: float = 2.0) -> list[date]:
    """Weeks differing from the trailing mean of prior non-None values by more than z x trailing std.

    Needs at least 4 prior points.
    """
    flagged, prior = [], []
    for week, v in series:
        if v is None:
            continue
        if len(prior) >= MIN_PRIOR:
            if abs(v - float(np.mean(prior))) > z * float(np.std(prior)):
                flagged.append(week)
        prior.append(v)
    return flagged
