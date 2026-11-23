from datetime import timedelta

import pytest

from analyzer.signals.counts import count_metrics
from analyzer.signals.latency import latency_metrics
from analyzer.signals.lsm import lsm
from analyzer.signals.questions import question_rate
from analyzer.signals.disclosure import disclosure_rate
from analyzer.signals.report import core_report, coverage_ratio
from analyzer.signals.sessions import split_sessions

from sig_helpers import T0, alternating, by_id, msg, only_speaker, sessions_all_started_by


def test_lsm_identical_text_near_one():
    m = alternating("I think that we should go to the park", n=30)
    assert lsm(m).value == pytest.approx(1.0, abs=0.01)
    assert lsm(m).evidence == "moderate"


def test_lsm_different_style_lower():
    m = []
    for i in range(30):
        t = "I think that we should not go" if i % 2 == 0 else "Pizza tomorrow Friday"
        m.append(msg(i, "me" if i % 2 == 0 else "them", t, T0 + timedelta(minutes=i)))
    assert lsm(m).value < 0.6


def test_initiation_one_sided():
    m = sessions_all_started_by("me", sessions=5)
    assert by_id(count_metrics(m), "initiation_share").per_speaker["me"] == 1.0


def test_split_sessions():
    m = sessions_all_started_by("me", sessions=3)
    assert len(split_sessions(m)) == 3
    assert len(split_sessions(m, gap_hours=48)) == 1


def test_insufficient_data_empty_and_one_speaker():
    for m in ([], only_speaker("me", 50), only_speaker("them", 50), alternating("hi", n=5)):
        r = core_report(m)
        assert r and all(x.status == "insufficient_data" and x.value is None for x in r)


def test_latency_excludes_session_breaks():
    m = alternating("hi", n=30, step_min=2)
    # one reply after a 10h break: must not count
    m.append(msg(100, "me", "hi", m[-1].ts + timedelta(hours=10)))
    m.append(msg(101, "them", "yo", m[-1].ts + timedelta(minutes=1)))
    lat = by_id(latency_metrics(m), "reply_latency_median_s")
    assert lat.per_speaker["me"] == 120 and lat.per_speaker["them"] == 120
    assert lat.value == 120


def test_latency_skips_approx():
    m = alternating("hi", n=30, step_min=2)
    m += [msg(100 + k, "me" if k % 2 == 0 else "them", "x", m[-1].ts + timedelta(minutes=2 * (k + 1)),
              prec="approx") for k in range(4)]
    lat = by_id(latency_metrics(m), "reply_latency_median_s")
    assert "skipped 4 approx-timestamp messages" in lat.note
    assert lat.per_speaker["me"] == 120


def test_double_text_skips_approx_note():
    m = alternating("hi", n=30) + [msg(99, "me", "x", T0 + timedelta(hours=1), prec="approx")]
    assert "skipped 1 approx-timestamp messages" in by_id(count_metrics(m), "double_text_rate").note


def test_double_text_rate():
    m = alternating("hi", n=30)
    base = m[-1].ts
    m += [msg(50, "me", "a", base + timedelta(minutes=5)), msg(51, "me", "b", base + timedelta(minutes=6))]
    d = by_id(count_metrics(m), "double_text_rate")
    assert d.per_speaker["me"] > 0 and d.per_speaker["them"] == 0


def test_question_and_disclosure():
    m = []
    for i in range(30):
        t = "how are you?" if i % 2 == 0 else "I feel anxious and I miss my family"
        m.append(msg(i, "me" if i % 2 == 0 else "them", t, T0 + timedelta(minutes=i)))
    q = question_rate(m)
    assert q.per_speaker["me"] == 1.0 and q.per_speaker["them"] == 0.0
    d = disclosure_rate(m)
    assert d.per_speaker["them"] > d.per_speaker["me"]
    assert d.evidence == "moderate" and q.evidence == "heuristic"


def test_every_metric_has_evidence_tag():
    for m in (alternating("I feel what?", n=40), []):
        for x in core_report(m):
            assert x.evidence in ("moderate", "heuristic", "descriptive")
            assert x.note
    ids = {x.id for x in core_report(alternating("hi there?", n=40))}
    assert {"message_share", "initiation_share", "ending_share", "double_text_rate",
            "reply_latency_median_s", "lsm", "question_rate", "disclosure_rate"} <= ids


def test_coverage_ratio_overlap():
    w = (T0, T0 + timedelta(days=10))
    cov = [(T0, T0 + timedelta(days=4), "a"), (T0 + timedelta(days=2), T0 + timedelta(days=6), "b"),
           (T0 + timedelta(days=9), T0 + timedelta(days=20), "c")]
    assert coverage_ratio(cov, w) == pytest.approx(0.7)
    assert coverage_ratio([], w) == 0.0


def test_partial_coverage_note():
    m = alternating("hi there?", n=40)
    w = (T0, T0 + timedelta(days=10))
    low = core_report(m, [(T0, T0 + timedelta(days=5), "a")], w)
    assert all(x.note.startswith("partial coverage: ") for x in low)
    ok = core_report(m, [(T0, T0 + timedelta(days=9), "a")], w)
    assert not any("partial coverage" in x.note for x in ok)
    assert not any("partial coverage" in x.note for x in core_report(m))


def test_wordlists_are_all_strings():
    from analyzer.signals.text import load_wordlist
    for name in ("function_words", "disclosure"):
        for words in load_wordlist(name).values():
            assert all(isinstance(w, str) for w in words)
