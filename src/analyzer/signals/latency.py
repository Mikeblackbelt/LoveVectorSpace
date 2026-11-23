from statistics import median

from .evidence import ROLES, Metric, gate, insufficient, skipped_note
from .sessions import split_sessions

ID = "reply_latency_median_s"


def latency_metrics(msgs) -> list[Metric]:
    why = gate(msgs)
    if why:
        return [insufficient(ID, "heuristic", why)]
    precise = [m for m in msgs if m.ts_precision != "approx"]
    skipped = len(msgs) - len(precise)
    lat = {r: [] for r in ROLES}
    for s in split_sessions(precise):  # replies across a session break are excluded
        for prev, cur in zip(s, s[1:]):
            if prev.role != cur.role:
                lat[cur.role].append((cur.ts - prev.ts).total_seconds())
    if not all(lat.values()):
        return [insufficient(ID, "heuristic",
                             "no replies measurable for one speaker; " + skipped_note(skipped))]
    per = {r: float(median(v)) for r, v in lat.items()}
    note = "median seconds to reply within a session; no reference band"
    if skipped:
        note += "; " + skipped_note(skipped)
    return [Metric(ID, float(median(lat["me"] + lat["them"])), per, "heuristic", "ok", note)]
