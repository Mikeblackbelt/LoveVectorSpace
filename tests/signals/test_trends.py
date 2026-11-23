from datetime import date, datetime, timedelta, timezone

from analyzer.signals.trends import change_points, weekly_trends
from sig_helpers import msg

UTC = timezone.utc
MON = datetime(2025, 1, 6, tzinfo=UTC)  # a Monday


def at(week, day=0):
    return MON + timedelta(weeks=week, days=day, hours=12)


def count(ms):
    return len(ms)


def test_weekly_trends_gaps_are_none():
    msgs = [msg(0, "me", "a", at(0)), msg(1, "them", "b", at(0, 6)),
            msg(2, "me", "c", at(3)), msg(3, "me", "d", at(3, 1))]
    out = weekly_trends(msgs, {"n": count})["n"]
    assert [w for w, _ in out] == [date(2025, 1, 6) + timedelta(weeks=i) for i in range(4)]
    assert [v for _, v in out] == [2.0, None, None, 2.0]


def test_week_boundary_is_monday_utc():
    sun = datetime(2025, 1, 12, 23, 59, tzinfo=UTC)
    mon = datetime(2025, 1, 13, 0, 0, tzinfo=UTC)
    out = weekly_trends([msg(0, "me", "a", sun), msg(1, "me", "b", mon)], {"n": count})["n"]
    assert out == [(date(2025, 1, 6), 1.0), (date(2025, 1, 13), 1.0)]


def test_uncovered_weeks_are_none():
    msgs = [msg(i, "me", "a", at(i)) for i in range(4)]
    cov = [(at(0, -1), MON + timedelta(weeks=1), "src"), (at(2), at(3, 2), "src")]  # weeks 0, 2, 3 touched; week 1 not
    out = weekly_trends(msgs, {"n": count}, coverage=cov)["n"]
    assert [v for _, v in out] == [1.0, None, 1.0, 1.0]


def test_metric_fn_none_and_empty():
    msgs = [msg(0, "me", "a", at(0))]
    assert weekly_trends(msgs, {"n": lambda m: None})["n"] == [(date(2025, 1, 6), None)]
    assert weekly_trends([], {"n": count}) == {"n": []}


def d(i):
    return date(2025, 1, 6) + timedelta(weeks=i)


def test_change_point_detects_step():
    vals = [0.10, 0.12, 0.09, 0.11, 0.10, 0.11, 0.9]
    assert change_points([(d(i), v) for i, v in enumerate(vals)]) == [d(6)]


def test_change_point_needs_history_and_skips_none():
    assert change_points([(d(0), 0.1), (d(1), 0.1), (d(2), 0.1), (d(3), 5.0)]) == []
    s = [(d(0), 0.1), (d(1), None), (d(2), 0.12), (d(3), 0.1), (d(4), 0.11), (d(5), None), (d(6), 3.0)]
    assert change_points(s) == [d(6)]
    flat = [(d(i), 0.5) for i in range(8)]
    assert change_points(flat) == []
