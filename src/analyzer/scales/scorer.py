from .schema import ScaleDef, ScaleResult

NO_BAND = "no reference band"


class AnswerError(ValueError):
    def __init__(self, item_id: str, reason: str = "missing or out of range"):
        super().__init__(f"item {item_id!r}: {reason}")
        self.item_id = item_id


def score(defn: ScaleDef, answers: dict[str, int]) -> ScaleResult:
    values: dict[str, float] = {}
    for item in defn.items:
        lo, hi = defn.item_range(item)
        x = answers.get(item.id)
        if x is None or isinstance(x, bool) or not lo <= x <= hi:
            raise AnswerError(item.id)
        values[item.id] = lo + hi - x if item.reverse else x

    subs: dict[str, float] = {}
    for name, sub in defn.subscales.items():
        vals = [values[i] for i in sub.items]
        total = float(sum(vals))
        subs[name] = total / len(vals) if sub.aggregate == "mean" and vals else total

    bands = {}
    for name, val in subs.items():
        label = NO_BAND
        for b in defn.norms or []:
            if b.subscale == name and b.min <= val <= b.max:
                label = b.label
                break
        bands[name] = label

    flags: dict[str, bool] = {}
    for c in defn.cutoffs or []:
        val = subs[c.subscale]
        hit = val < c.value if c.direction == "below" else val > c.value
        flags[c.subscale] = flags.get(c.subscale, False) or hit

    if not defn.verified:
        status = "unverified"
    elif defn.custom and not defn.owner_approved:
        status = "draft"
    else:
        status = "ok"
    return ScaleResult(subscales=subs, bands=bands, cutoff_flags=flags, status=status)
