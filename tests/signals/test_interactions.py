from datetime import datetime, timedelta, timezone

from analyzer.signals.interactions import interaction_metrics
from analyzer.store.models import Interaction, InteractionFields

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def mk(i, days_ago=1, **kw):
    f = dict(ts=NOW - timedelta(days=days_ago), initiated_by="me", closeness_1_7=4, comfort_1_7=4)
    f.update(kw)
    return Interaction(id=i, person_id=1, fields=InteractionFields(**f), notes="")


def get(ms, mid):
    return next(m for m in ms if m.id == mid)


def test_initiation_share_mutual_half():
    xs = [mk(1, 1, initiated_by="me"), mk(2, 2, initiated_by="them"), mk(3, 3, initiated_by="mutual"),
          mk(4, 4, initiated_by="mutual")]
    m = get(interaction_metrics(xs, now=NOW), "meetup_initiation_share")
    assert m.status == "ok"
    assert m.value == 0.5 and m.per_speaker == {"me": 0.5, "them": 0.5}
    assert m.evidence == "self-report heuristic"
    assert "only logged hangouts count" in m.note


def test_follow_through_ignores_null():
    xs = [mk(1, 1, followed_through_prev=True), mk(2, 2, followed_through_prev=None),
          mk(3, 3, followed_through_prev=False), mk(4, 4, followed_through_prev=True)]
    m = get(interaction_metrics(xs, now=NOW), "plan_follow_through_rate")
    assert m.status == "ok" and abs(m.value - 2 / 3) < 1e-9


def test_trend_needs_three_points():
    xs = [mk(1, 10, closeness_1_7=3), mk(2, 5, closeness_1_7=5)]
    m = get(interaction_metrics(xs, now=NOW), "closeness_trend")
    assert m.value is None and m.status == "insufficient_data"
    xs.append(mk(3, 0, closeness_1_7=7))
    m = get(interaction_metrics(xs, now=NOW), "closeness_trend")
    assert m.status == "ok" and m.value > 0


def test_insufficient_when_no_interactions():
    ms = interaction_metrics([], now=NOW)
    assert {m.id for m in ms} == {"meetups_per_month", "meetup_initiation_share", "plan_follow_through_rate",
                                  "closeness_trend", "comfort_trend", "tension_rate"}
    assert all(m.status == "insufficient_data" and m.value is None for m in ms)
    assert all("only logged hangouts count" in m.note for m in ms)


def test_window_and_rates():
    xs = [mk(1, 1, tension="argued"), mk(2, 2), mk(3, 3), mk(4, 200)]
    ms = interaction_metrics(xs, now=NOW)
    assert abs(get(ms, "meetups_per_month").value - 1.0) < 1e-9
    assert abs(get(ms, "tension_rate").value - 1 / 3) < 1e-9
