from datetime import datetime, timedelta, timezone

from analyzer.signals.evidence import Metric, insufficient
from analyzer.store.models import Interaction

EV = "self-report heuristic"
NOTE = "only logged hangouts count"
MIN_POINTS = 3


def _utc(ts: datetime) -> datetime:
    return ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)


def _ok(mid, value, note, per_speaker=None) -> Metric:
    return Metric(mid, value, per_speaker, EV, "ok", f"{note}; {NOTE}")


def _insuf(mid, note) -> Metric:
    return insufficient(mid, EV, f"{note}; {NOTE}")


def _slope_per_30d(points: list[tuple[datetime, int]]) -> float | None:
    t0 = points[0][0]
    xs = [(t - t0).total_seconds() / 86400 for t, _ in points]
    ys = [float(y) for _, y in points]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return None
    return 30.0 * sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx


def interaction_metrics(
    interactions: list[Interaction], window_days: int = 90, now: datetime | None = None
) -> list[Metric]:
    now = _utc(now) if now else datetime.now(timezone.utc)
    start = now - timedelta(days=window_days)
    xs = sorted(
        (i for i in interactions if start <= _utc(i.fields.ts) <= now),
        key=lambda i: _utc(i.fields.ts),
    )
    n = len(xs)
    out: list[Metric] = []

    if n == 0:
        out.append(_insuf("meetups_per_month", "no logged hangouts in window"))
    else:
        out.append(_ok("meetups_per_month", n / (window_days / 30.0), f"{n} hangouts in {window_days} days"))

    if n < MIN_POINTS:
        out.append(_insuf("meetup_initiation_share", "fewer than 3 hangouts"))
    else:
        me = sum(1.0 if i.fields.initiated_by == "me" else 0.5 if i.fields.initiated_by == "mutual" else 0.0
                 for i in xs) / n
        out.append(_ok("meetup_initiation_share", me, "mutual counts half each",
                       {"me": me, "them": 1.0 - me}))

    ft = [i.fields.followed_through_prev for i in xs if i.fields.followed_through_prev is not None]
    if len(ft) < MIN_POINTS:
        out.append(_insuf("plan_follow_through_rate", "fewer than 3 hangouts with follow-through recorded"))
    else:
        out.append(_ok("plan_follow_through_rate", sum(ft) / len(ft), f"{len(ft)} rated"))

    for mid, attr in (("closeness_trend", "closeness_1_7"), ("comfort_trend", "comfort_1_7")):
        pts = [(_utc(i.fields.ts), getattr(i.fields, attr)) for i in xs]
        slope = _slope_per_30d(pts) if len(pts) >= MIN_POINTS else None
        if slope is None:
            out.append(_insuf(mid, "fewer than 3 hangouts spread over time"))
        else:
            out.append(_ok(mid, slope, "rating points per 30 days"))

    if n < MIN_POINTS:
        out.append(_insuf("tension_rate", "fewer than 3 hangouts"))
    else:
        t = sum(1 for i in xs if (i.fields.tension or "").strip()) / n
        out.append(_ok("tension_rate", t, "share of hangouts with tension logged"))
    return out
