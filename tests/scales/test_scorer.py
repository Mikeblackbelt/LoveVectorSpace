from pathlib import Path

import pytest
from pydantic import ValidationError

from analyzer.scales.loader import load_scales
from analyzer.scales.schema import ScaleDef
from analyzer.scales.scorer import AnswerError, score

FIX = Path(__file__).parent.parent / "fixtures" / "scales"


def toy(**over) -> ScaleDef:
    d = load_scales(FIX)["toy"].model_dump()
    d.update(over)
    return ScaleDef.model_validate(d)


def test_reverse_key_and_sum():
    r = score(toy(), {"a": 3, "b": 1, "c": 2})
    assert r.subscales["total"] == 3 + (5 - 1) + (6 - 2)


def test_item_level_range_overrides_scale_range():
    r = score(toy(), {"a": 0, "b": 0, "c": 6})
    assert r.subscales["total"] == 0 + 5 + 0
    with pytest.raises(AnswerError):
        score(toy(), {"a": 0, "b": 6, "c": 0})


def test_mean_aggregate():
    d = toy()
    d.subscales["total"].aggregate = "mean"
    r = score(d, {"a": 3, "b": 1, "c": 2})
    assert r.subscales["total"] == pytest.approx(11 / 3)


def test_cutoff_flag_at_boundary():
    d = toy(cutoffs=[{"subscale": "total", "value": 11, "label": "distress"}])
    assert score(d, {"a": 3, "b": 1, "c": 2}).cutoff_flags["total"] is False  # == 11
    assert score(d, {"a": 2, "b": 1, "c": 2}).cutoff_flags["total"] is True  # 10
    d = toy(cutoffs=[{"subscale": "total", "value": 11, "direction": "above", "label": "x"}])
    assert score(d, {"a": 3, "b": 1, "c": 2}).cutoff_flags["total"] is False
    assert score(d, {"a": 4, "b": 1, "c": 2}).cutoff_flags["total"] is True


def test_bands():
    r = score(toy(), {"a": 3, "b": 1, "c": 2})
    assert r.bands["total"] == "high"
    assert score(toy(), {"a": 0, "b": 5, "c": 6}).bands["total"] == "low"


def test_missing_answer_raises():
    with pytest.raises(AnswerError) as e:
        score(toy(), {"a": 1, "b": 1})
    assert "c" in str(e.value)


def test_out_of_range_raises():
    with pytest.raises(AnswerError):
        score(toy(), {"a": 6, "b": 1, "c": 1})
    with pytest.raises(AnswerError):
        score(toy(), {"a": -1, "b": 1, "c": 1})


def test_no_norms_band_text():
    r = score(toy(norms=None), {"a": 3, "b": 1, "c": 2})
    assert r.bands["total"] == "no reference band"


def test_custom_unapproved_is_draft():
    ans = {"a": 3, "b": 1, "c": 2}
    assert score(toy(custom=True, owner_approved=False), ans).status == "draft"
    assert score(toy(custom=True, owner_approved=True), ans).status == "ok"
    assert score(toy(), ans).status == "ok"
    assert score(toy(verified=False), ans).status == "unverified"


def test_unknown_subscale_item_fails_validation():
    with pytest.raises(ValidationError):
        toy(subscales={"total": {"items": ["a", "zzz"], "aggregate": "sum"}})


def test_load_duplicate_ids_raise(tmp_path):
    src = (FIX / "toy.yaml").read_text()
    (tmp_path / "one.yaml").write_text(src)
    (tmp_path / "two.yaml").write_text(src)
    with pytest.raises(ValueError):
        load_scales(tmp_path)
