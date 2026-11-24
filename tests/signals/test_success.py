import pytest

from analyzer.signals.evidence import Metric
from analyzer.signals.success import uncalibrated_success

TAG = "uncalibrated estimate: hand-set weights, not fitted to outcomes"


def ok(mid, value, them=None):
    ps = None if them is None else {"me": 1 - them, "them": them}
    return Metric(mid, value, ps, "heuristic", "ok", "")


def bad(mid):
    return Metric(mid, None, None, "heuristic", "insufficient_data", "thin")


def balanced():
    return [ok("lsm", 0.6), ok("initiation_share", 0.5, 0.5), ok("message_share", 0.5, 0.5),
            ok("question_rate", 0.2, 0.5), ok("disclosure_rate", 1.0, 0.5)]


def inter(share=0.5):
    return [ok("meetup_initiation_share", share, share)]


def test_balanced_signals_near_intercept():
    e = uncalibrated_success("potential", balanced(), inter(), [])
    assert e.status == "ok"
    assert abs(e.percent - 50) <= 1
    e2 = uncalibrated_success("established", balanced(), inter(), [])
    assert 66 <= e2.percent <= 70  # sigmoid(0.8)


def test_one_sided_initiation_lowers_estimate():
    base = uncalibrated_success("potential", balanced(), inter(), [])
    ms = [m for m in balanced() if m.id != "initiation_share"] + [ok("initiation_share", 0.9, 0.1)]
    low = uncalibrated_success("potential", ms, inter(), [])
    assert low.percent < base.percent
    assert low.top_contributors[0][0] == "initiation_share"
    assert low.top_contributors[0][1] < 0


def test_missing_signals_widen_range():
    full = uncalibrated_success("potential", balanced(), inter(), [])
    part = uncalibrated_success("potential", [m for m in balanced() if m.id != "question_rate"], inter(), [])
    assert part.status == "ok"
    assert (part.high - part.low) == (full.high - full.low) + 10
    assert full.high - full.low >= 30 - 1


def test_insufficient_when_few_core_signals():
    ms = [ok("lsm", 0.6), bad("initiation_share"), bad("message_share"), bad("question_rate")]
    e = uncalibrated_success("potential", ms, [bad("meetup_initiation_share")], [])
    assert e.status == "insufficient_data"
    assert e.percent is None and e.low is None and e.high is None
    assert e.tag == TAG


def test_tag_and_definition_exact():
    p = uncalibrated_success("potential", balanced(), inter(), [])
    s = uncalibrated_success("established", balanced(), inter(), [])
    assert p.tag == TAG
    assert p.definition == "interest is mutual and moves toward dating"
    assert s.definition == "still together and satisfied in 3 months"


def test_calibrated_slot_not_available():
    e = uncalibrated_success("potential", balanced(), inter(), [])
    c = e.calibrated
    assert c.status == "not_available" and c.needed == 20 and c.n_outcomes == 0
    assert c.percent is None
    assert e.model_dump_json()


@pytest.mark.parametrize("extreme", [0.0, 1.0])
def test_percent_within_0_100(extreme):
    ms = [ok("lsm", extreme), ok("initiation_share", extreme, extreme),
          ok("message_share", extreme, extreme), ok("question_rate", 0.2, extreme),
          ok("disclosure_rate", 1, extreme), ok("plan_follow_through_rate", extreme),
          ok("closeness_trend", 5 * (extreme * 2 - 1)), ok("tension_rate", extreme)]
    e = uncalibrated_success("established", ms, inter(extreme), [])
    assert 0 <= e.low <= e.percent <= e.high <= 100
    assert len(e.top_contributors) == 3
