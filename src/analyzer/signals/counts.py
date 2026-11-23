from .evidence import ROLES, Metric, gate, insufficient, skipped_note
from .sessions import split_sessions

IDS = ("message_share", "initiation_share", "ending_share", "double_text_rate")


def _share(counter: dict[str, int]) -> dict[str, float]:
    t = sum(counter.values()) or 1
    return {r: counter[r] / t for r in ROLES}


def count_metrics(msgs) -> list[Metric]:
    why = gate(msgs)
    if why:
        return [insufficient(i, "heuristic", why) for i in IDS]
    sessions = split_sessions(msgs)
    n = {r: sum(m.role == r for m in msgs) for r in ROLES}
    start = {r: sum(s[0].role == r for s in sessions) for r in ROLES}
    end = {r: sum(s[-1].role == r for s in sessions) for r in ROLES}
    out = [
        Metric("message_share", n["me"] / sum(n.values()), _share(n), "heuristic", "ok",
               "share of all messages sent; descriptive of volume, no reference band"),
        Metric("initiation_share", start["me"] / len(sessions), _share(start), "heuristic", "ok",
               f"share of {len(sessions)} sessions (6h gap) opened by each; no reference band"),
        Metric("ending_share", end["me"] / len(sessions), _share(end), "heuristic", "ok",
               f"share of {len(sessions)} sessions (6h gap) closed by each; no reference band"),
    ]
    # double text: a message following one's own previous message within a session
    precise = [m for m in msgs if m.ts_precision != "approx"]
    skipped = len(msgs) - len(precise)
    dbl = {r: 0 for r in ROLES}
    tot = {r: 0 for r in ROLES}
    for s in split_sessions(precise):
        for prev, cur in zip(s, s[1:]):
            tot[cur.role] += 1
            if prev.role == cur.role:
                dbl[cur.role] += 1
    note = "share of messages that follow own previous message unanswered; no reference band"
    if skipped:
        note += "; " + skipped_note(skipped)
    if min(tot.values()) == 0:
        out.append(insufficient("double_text_rate", "heuristic",
                                "too few timestamped messages; " + skipped_note(skipped)))
    else:
        per = {r: dbl[r] / tot[r] for r in ROLES}
        out.append(Metric("double_text_rate", sum(dbl.values()) / sum(tot.values()), per,
                          "heuristic", "ok", note))
    return out
