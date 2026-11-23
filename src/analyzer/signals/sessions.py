from datetime import timedelta


def split_sessions(msgs, gap_hours: float = 6.0):
    out, cur, last = [], [], None
    for m in sorted(msgs, key=lambda x: (x.ts, x.id)):
        if last is not None and m.ts - last > timedelta(hours=gap_hours):
            out.append(cur)
            cur = []
        cur.append(m)
        last = m.ts
    if cur:
        out.append(cur)
    return out
