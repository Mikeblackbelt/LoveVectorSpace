from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from analyzer.safety.check import DISCLAIMER, safety_check
from analyzer.scales.schema import ScaleResult
from analyzer.store.messages import StoredMessage
from analyzer.store.models import Fact

FIX = Path(__file__).parent.parent / "fixtures" / "safety"
T0 = datetime(2025, 3, 1, 12, 0, tzinfo=timezone.utc)


def mk(i, role, text, days=0):
    return StoredMessage(id=i, person_id=1, ts=T0 + timedelta(days=days, minutes=i), role=role,
                         speaker_raw=role, text=text, ts_precision="second", sources=["t"])


def load_fixtures(name):
    rows = yaml.safe_load((FIX / f"{name}.yaml").read_text(encoding="utf-8"))
    return [(r["id"], mk(0, r["role"], r["text"])) for r in rows]


def fact(key, value):
    return Fact(id=1, person_id=1, key=key, value=value, source="interview",
                confidence="owner_sure", updated_at=T0)


def cdaq(**subs):
    base = {"monitoring_experienced": None, "monitoring_done": None,
            "aggression_experienced": None, "aggression_done": None}
    base.update(subs)
    return ScaleResult(subscales=base, bands={}, cutoff_flags={}, status="ok")


def run(msgs, tox=None, c=None, facts=None):
    return safety_check(msgs, tox, c, facts)


def test_fixture_volume():
    for name in ["monitoring", "control", "isolation", "hostility", "threat", "self_harm", "urgent"]:
        assert len(load_fixtures(name)) >= 8, name
    assert len(load_fixtures("benign")) >= 30


def test_urgent_recall_is_total():
    misses = []
    for name in ["urgent", "threat", "self_harm"]:
        for cid, m in load_fixtures(name):
            flags = run([m]).flags
            if not any(f.severity == "urgent" for f in flags):
                misses.append(cid)
    assert not misses, f"urgent misses: {misses}"


@pytest.mark.parametrize("cat", ["monitoring", "control", "isolation", "hostility"])
def test_category_fixtures_are_flagged(cat):
    for cid, m in load_fixtures(cat):
        flags = run([m]).flags
        assert any(f.category == cat for f in flags), cid


def test_owner_messages_are_flagged_too():
    flags = run([mk(0, "me", "Give me your password so I can check")]).flags
    assert [(f.category, f.speaker) for f in flags] == [("monitoring", "me")]


def test_repeated_monitoring_is_concern():
    msgs = [mk(i, "them", "Send me your live location", days=i * 5) for i in range(3)]
    f = [x for x in run(msgs).flags if x.category == "monitoring"][0]
    assert f.severity == "concern" and f.count == 3 and f.speaker == "them"
    assert f.first_seen < f.last_seen


def test_spread_out_monitoring_stays_info():
    msgs = [mk(i, "them", "Send me your live location", days=i * 40) for i in range(3)]
    f = [x for x in run(msgs).flags if x.category == "monitoring"][0]
    assert f.severity == "info"


def test_single_mild_hit_is_info():
    f = run([mk(0, "them", "Let me see your phone")]).flags
    assert len(f) == 1 and f[0].severity == "info"


def test_high_toxicity_concern():
    msgs = [mk(i, "them", "whatever") for i in range(4)]
    f = run(msgs, tox=[0.9, 0.85, 0.95, 0.1]).flags
    h = [x for x in f if x.category == "hostility"]
    assert len(h) == 1 and h[0].severity == "concern" and h[0].count == 3
    assert run(msgs, tox=[0.9, 0.85, 0.1, 0.1]).flags == []


def test_tox_length_mismatch_rejected():
    with pytest.raises(ValueError):
        run([mk(0, "me", "hi")], tox=[0.1, 0.2])


def test_benign_swearing_not_urgent():
    msgs = [m for _, m in load_fixtures("benign")]
    assert not any(f.severity == "urgent" for f in run(msgs).flags)
    for cid, m in load_fixtures("benign"):
        assert run([m]).flags == [], cid


def test_resources_present_when_any_flag():
    assert run([mk(0, "me", "hi there")]).resources == []
    b = run([mk(0, "them", "I want to kill myself")])
    assert b.disclaimer == DISCLAIMER
    text = " ".join(f"{r.name} {r.phone} {r.text}" for r in b.resources)
    assert "988" in text and "799-7233" in text and "88788" in text


def test_snippet_limits():
    msgs = [mk(i, "them", "Send me your live location " + "x" * 400, days=i) for i in range(6)]
    f = run(msgs).flags[0]
    assert len(f.snippets) == 3 and all(len(s) <= 200 for s in f.snippets)


def test_interview_safety_facts_feed_flags():
    cases = [
        ("safety.threats_experienced", "he said he would hurt me", "urgent"),
        ("safety.self_harm", "I have thought about suicide", "urgent"),
        ("safety.monitoring_experienced", "very often", "concern"),
        ("safety.monitoring_done", "4", "concern"),
        ("safety.control_experienced", "always", "concern"),
        ("safety.monitoring_experienced", "once or twice", "info"),
    ]
    for key, val, sev in cases:
        flags = run([], facts=[fact(key, val)]).flags
        assert len(flags) == 1, (key, val)
        assert flags[0].severity == sev, (key, val)
        assert flags[0].speaker == "owner_report"
    assert run([], facts=[fact("safety.threats_experienced", "never")]).flags == []
    assert run([], facts=[fact("goals.x", "he said he would hurt me")]).flags == []
    assert run([], facts=[fact("safety.threats_experienced", "never")]).resources == []


def test_cdaq_questionnaire_mapping():
    assert run([], c=cdaq(monitoring_experienced=3)).flags[0].severity == "concern"
    assert run([], c=cdaq(monitoring_done=2)).flags == []
    f = run([], c=cdaq(aggression_done=3)).flags[0]
    assert (f.severity, f.speaker) == ("concern", "owner_report")
    assert run([], c=cdaq(aggression_experienced=8)).flags[0].severity == "urgent"
    assert run([], c=cdaq(monitoring_experienced=9)).flags[0].severity == "concern"


def test_cdaq_none_subscales_ignored():
    assert run([], c=cdaq()).flags == []
    assert run([], c=cdaq(monitoring_done=None, aggression_done=None)).flags == []


def test_pooled_concern_across_monitoring_control_isolation():
    msgs = [mk(0, "them", "Send me your live location", days=0),
            mk(1, "them", "You need my permission before you make plans", days=3),
            mk(2, "them", "You only need me", days=6)]
    flags = run(msgs).flags
    assert {f.category for f in flags} == {"monitoring", "control", "isolation"}
    assert all(f.severity == "concern" for f in flags)
    msgs2 = [mk(0, "them", "Send me your live location", days=0),
             mk(1, "them", "Show me your texts", days=2),
             mk(2, "them", "You need my permission before you make plans", days=4)]
    assert all(f.severity == "concern" for f in run(msgs2).flags)
    # a message matching two categories counts once
    both = [mk(0, "them", "Give me your password, you need my permission", days=0),
            mk(1, "them", "Send me your live location", days=1)]
    assert all(f.severity == "info" for f in run(both).flags)
    # pooling is per speaker and respects the window
    mixed = [mk(0, "them", "Send me your live location", days=0),
             mk(1, "me", "You need my permission before you make plans", days=1),
             mk(2, "them", "You only need me", days=2)]
    assert all(f.severity == "info" for f in run(mixed).flags)
    far = [mk(i, "them", t, days=i * 40) for i, t in
           enumerate(["Send me your live location", "You only need me", "I forbid it"])]
    assert all(f.severity == "info" for f in run(far).flags)


def test_fact_negation():
    for v in ["No, he has never hit me", "no, not abusive", "never hit me", "no, never",
              "He didn't hit me", "None"]:
        assert run([], facts=[fact("safety.threats_experienced", v)]).flags == [], v
    for v in ["no, but he threatened me", "Not really, except he hit me once",
              "he has hit me", "he never apologised, he hit me"]:
        flags = run([], facts=[fact("safety.threats_experienced", v)]).flags
        assert flags and flags[0].severity == "urgent", v


def test_911_only_for_urgent_threat():
    def names(b):
        return [r.phone for r in b.resources]
    assert "911" in names(run([mk(0, "them", "I will fucking kill you")]))
    assert "911" not in names(run([mk(0, "them", "I want to kill myself")]))
    assert "911" not in names(run([mk(0, "them", "Let me see your phone")]))
    assert "988" in names(run([mk(0, "them", "I will fucking kill you")]))
    r = [x for x in run([mk(0, "them", "I know where you live")]).resources if x.phone == "911"][0]
    assert "immediate danger" in r.description
