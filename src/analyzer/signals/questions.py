from .evidence import ROLES, Metric, gate, insufficient


def question_rate(msgs) -> Metric:
    why = gate(msgs)
    if why:
        return insufficient("question_rate", "heuristic", why)
    n = {r: 0 for r in ROLES}
    q = {r: 0 for r in ROLES}
    for m in msgs:
        n[m.role] += 1
        q[m.role] += "?" in m.text
    return Metric("question_rate", sum(q.values()) / sum(n.values()),
                  {r: q[r] / n[r] for r in ROLES}, "heuristic", "ok",
                  "share of messages containing a question mark; no reference band")
