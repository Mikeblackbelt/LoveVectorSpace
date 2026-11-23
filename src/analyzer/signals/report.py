from dataclasses import replace
from datetime import datetime

from .counts import count_metrics
from .disclosure import disclosure_rate
from .latency import latency_metrics
from .lsm import lsm
from .questions import question_rate

COVERAGE_MIN = 0.8


def coverage_ratio(coverage: list[tuple[datetime, datetime, str]],
                   window: tuple[datetime, datetime]) -> float:
    ws, we = window
    total = (we - ws).total_seconds()
    if total <= 0:
        return 0.0
    ivs = sorted((max(s, ws), min(e, we)) for s, e, _ in coverage if min(e, we) > max(s, ws))
    covered, cur_s, cur_e = 0.0, None, None
    for s, e in ivs:
        if cur_e is None or s > cur_e:
            if cur_e is not None:
                covered += (cur_e - cur_s).total_seconds()
            cur_s, cur_e = s, e
        else:
            cur_e = max(cur_e, e)
    if cur_e is not None:
        covered += (cur_e - cur_s).total_seconds()
    return min(1.0, covered / total)


def core_report(msgs, coverage=None, window=None):
    out = [*count_metrics(msgs), *latency_metrics(msgs), lsm(msgs),
           question_rate(msgs), disclosure_rate(msgs)]
    if coverage is not None and window is not None and coverage_ratio(coverage, window) < COVERAGE_MIN:
        out = [replace(m, note="partial coverage: " + m.note) for m in out]
    return out
