from pathlib import Path

import pytest
import yaml

from analyzer.scales.loader import load_scales
from analyzer.scales.schema import display_text
from analyzer.scales.scorer import score

DEFS = Path(__file__).parent.parent.parent / "src" / "analyzer" / "scales" / "defs"
ALL = load_scales(DEFS)


def test_all_defs_load_and_validate():
    assert ALL
    assert "ims_commitment" not in ALL and "prqc" not in ALL


def test_verified_defs_have_source_url():
    assert all(d.source.url for d in ALL.values() if d.verified)


def test_published_scales_have_no_inline_text():
    for d in ALL.values():
        if not d.custom:
            assert d.item_text == "local_overlay", d.id
            assert all(i.text is None for i in d.items), d.id


def test_overlay_merges_and_rejects_unknown_ids(tmp_path):
    first = ALL["csi16"].items[0].id
    (tmp_path / "csi16.yaml").write_text(yaml.safe_dump({first: "placeholder text A"}))
    d = load_scales(DEFS, overlay_dir=tmp_path)["csi16"]
    assert d.items[0].text == "placeholder text A"
    assert d.items[1].text is None
    (tmp_path / "csi16.yaml").write_text(yaml.safe_dump({"nope_99": "placeholder text B"}))
    with pytest.raises(ValueError):
        load_scales(DEFS, overlay_dir=tmp_path)


def test_display_text_placeholder():
    d = ALL["csi16"]
    assert display_text(d.items[2], d) == f"{d.name} item 3 (enter text from the official form)"
    c = ALL["reciprocity"]
    assert display_text(c.items[0], c) == c.items[0].text


def _csi_answers(total):
    d = ALL["csi16"]
    out, left = {}, total
    for item in d.items:
        lo, hi = d.item_range(item)
        out[item.id] = lo
    for item in d.items:
        lo, hi = d.item_range(item)
        add = min(hi - lo, left)
        out[item.id] += add
        left -= add
    assert left == 0
    return out


@pytest.mark.skipif("csi16" not in ALL, reason="CSI-16 not present")
def test_csi16_cutoff():
    d = ALL["csi16"]
    assert d.cutoffs[0].value == 51.5
    assert sum(d.item_range(i)[1] for i in d.items) == 81
    assert score(d, _csi_answers(51)).cutoff_flags["total"] is True
    assert score(d, _csi_answers(52)).cutoff_flags["total"] is False


@pytest.mark.skipif("ecr_r" not in ALL, reason="ECR-R not present")
def test_ecr_r_has_two_subscales_of_18_with_reverse_keys():
    d = ALL["ecr_r"]
    assert set(d.subscales) == {"anxiety", "avoidance"}
    assert all(len(s.items) == 18 for s in d.subscales.values())
    rev = {i.id for i in d.items if i.reverse}
    assert len(rev) == 14
    answers = {i.id: 7 for i in d.items}
    r = score(d, answers)
    assert r.subscales["anxiety"] == (16 * 7 + 2 * 1) / 18
    assert r.subscales["avoidance"] == (6 * 7 + 12 * 1) / 18


def test_custom_scales_are_unverified_drafts():
    custom = [d for d in ALL.values() if d.custom]
    assert {d.id for d in custom} >= {
        "joel_predictors", "reciprocity", "disclosure_balance", "breadcrumbing", "cdaq_items"
    }
    for d in custom:
        assert not d.owner_approved and d.item_text == "inline" and not d.cutoffs and not d.norms
        answers = {i.id: d.item_range(i)[1] for i in d.items}
        assert score(d, answers).status == "unverified"
    cd = ALL["cdaq_items"]
    assert {"monitoring_experienced", "monitoring_done", "aggression_experienced",
            "aggression_done", "sum"} == set(cd.subscales)


def test_joel_predictors_scores_without_optional_item():
    d = ALL["joel_predictors"]
    assert [i.id for i in d.items if i.optional] == ["joel_predictors_03"]
    answers = {i.id: 4 for i in d.items if not i.optional}
    r = score(d, answers)
    assert r.subscales["total"] == 4 and r.notes


def test_modes_use_person_modes_and_early_is_an_alias():
    for d in ALL.values():
        assert set(d.mode) <= {"potential", "established"}, d.id
    assert {"reciprocity", "breadcrumbing", "disclosure_balance"} <= {
        d.id for d in ALL.values() if "potential" in d.mode}
    from analyzer.scales.schema import ScaleDef
    base = dict(id="x", name="x", items=[{"id": "a"}], subscales={"t": {"items": ["a"], "aggregate": "sum"}},
                response={"min": 0, "max": 1}, source={"citation": "c"})
    assert ScaleDef.model_validate({**base, "mode": ["early", "potential", "established"]}).mode == \
        ["potential", "established"]


def test_custom_scales_are_unverified():
    for d in ALL.values():
        if d.custom:
            assert d.verified is False, d.id
