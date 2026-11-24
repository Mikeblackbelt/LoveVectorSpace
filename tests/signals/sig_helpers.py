from datetime import datetime, timedelta, timezone

from analyzer.store.messages import StoredMessage

T0 = datetime(2025, 1, 1, 12, 0, tzinfo=timezone.utc)


def msg(i, role, text, ts, prec="second"):
    return StoredMessage(id=i, person_id=1, ts=ts, role=role, speaker_raw=role,
                         text=text, ts_precision=prec, sources=["t"])


def alternating(text, n, step_min=1, prec="second", start=T0):
    return [msg(i, "me" if i % 2 == 0 else "them", text,
                start + timedelta(minutes=i * step_min), prec) for i in range(n)]


def only_speaker(role, n):
    return [msg(i, role, "hello there", T0 + timedelta(minutes=i)) for i in range(n)]


def sessions_all_started_by(role, sessions, per=4):
    other = "them" if role == "me" else "me"
    out, i = [], 0
    for s in range(sessions):
        base = T0 + timedelta(days=s)
        for k in range(per):
            out.append(msg(i, role if k % 2 == 0 else other, "hi", base + timedelta(minutes=k)))
            i += 1
    return out


def by_id(metrics, mid):
    return next(m for m in metrics if m.id == mid)
