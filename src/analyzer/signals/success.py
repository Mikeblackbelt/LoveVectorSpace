"""Uncalibrated "chance of success" estimate (v2 design 7c).

Hand-set logistic combination of reciprocity signals. NOT fitted to outcomes and always
returned with its tag and a wide range. The calibrated slot is an empty phase-2 placeholder.
"""
import math
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel

TAG = "uncalibrated estimate: hand-set weights, not fitted to outcomes"
DEFINITIONS = {
    "potential": "interest is mutual and moves toward dating",
    "established": "still together and satisfied in 3 months",
}
CORE = ("lsm", "initiation_share", "message_share", "question_rate", "meetup_initiation_share")
MIN_CORE = 3
BASE_RANGE = 15.0
PER_MISSING = 5.0
CALIBRATION_NEEDED = 20
_YAML = Path(__file__).with_name("success_weights.yaml")


class CalibratedSlot(BaseModel):
    status: Literal["not_available", "ok"] = "not_available"
    percent: float | None = None
    low: float | None = None
    high: float | None = None
    n_outcomes: int = 0
    needed: int = CALIBRATION_NEEDED


class SuccessEstimate(BaseModel):
    mode: str
    status: Literal["ok", "insufficient_data"]
    percent: float | None
    low: float | None
    high: float | None
    tag: str = TAG
    top_contributors: list[tuple[str, float]]
    definition: str
    calibrated: CalibratedSlot


def _clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


def _them_share(m):
    ps = m.per_speaker or {}
    return ps.get("them") if "them" in ps else None


def _them_ratio(m):
    ps = m.per_speaker or {}
    if "me" not in ps or "them" not in ps or ps["me"] + ps["them"] <= 0:
        return None
    return ps["them"] / (ps["me"] + ps["them"])


def _balance(share):
    return None if share is None else _clamp((share - 0.5) / 0.5)


_STANDARDISE = {
    "lsm": lambda m: _clamp((m.value - 0.6) / 0.3),
    "initiation_share": lambda m: _balance(_them_share(m)),
    "message_share": lambda m: _balance(_them_share(m)),
    "question_rate": lambda m: _balance(_them_ratio(m)),
    "disclosure_rate": lambda m: _balance(_them_ratio(m)),
    "meetup_initiation_share": lambda m: _balance(_them_share(m)),
    "plan_follow_through_rate": lambda m: _clamp((m.value - 0.5) / 0.5),
    "closeness_trend": lambda m: _clamp(m.value / 1.0),
    "tension_rate": lambda m: -_clamp((m.value - 0.2) / 0.3, 0.0, 1.0),
}


def _config() -> dict:
    return yaml.safe_load(_YAML.read_text(encoding="utf-8"))


def uncalibrated_success(mode, chat_metrics, interaction_metrics, facts=None) -> SuccessEstimate:
    """`facts` is accepted for future use (owner interview context); v1 ignores it."""
    if mode not in DEFINITIONS:
        raise ValueError(f"unknown mode: {mode!r}")
    cfg = _config()
    usable = {}
    for m in [*chat_metrics, *interaction_metrics]:
        if m.status == "ok" and m.value is not None and m.id in _STANDARDISE:
            usable[m.id] = m
    s = {}
    for mid, m in usable.items():
        v = _STANDARDISE[mid](m)
        if v is not None:
            s[mid] = v
    core_ok = sum(c in s for c in CORE)
    slot = CalibratedSlot()
    definition = DEFINITIONS[mode]
    if core_ok < MIN_CORE:
        return SuccessEstimate(mode=mode, status="insufficient_data", percent=None, low=None,
                               high=None, top_contributors=[], definition=definition, calibrated=slot)
    contrib = {}
    for mid, v in s.items():
        w = cfg["weights"][mid]
        contrib[mid] = (w["w_neg"] if v < 0 else w["w_pos"]) * v
    z = cfg["intercepts"][mode] + sum(contrib.values())
    p = 1 / (1 + math.exp(-z))
    pct = 100 * p
    half = BASE_RANGE + PER_MISSING * (len(CORE) - core_ok)
    marginal = p * (1 - p) * 100  # percentage points per unit of logit
    top = sorted(contrib.items(), key=lambda kv: abs(kv[1]), reverse=True)[:3]
    return SuccessEstimate(
        mode=mode, status="ok",
        percent=float(round(pct)),
        low=float(round(_clamp(pct - half, 0, 100))),
        high=float(round(_clamp(pct + half, 0, 100))),
        top_contributors=[(mid, round(c * marginal, 1)) for mid, c in top],
        definition=definition, calibrated=slot)
