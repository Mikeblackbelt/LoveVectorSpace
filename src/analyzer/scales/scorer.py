from .schema import ScaleDef, ScaleResult

NO_BAND = "no reference band"


class AnswerError(ValueError):
    def __init__(self, item_id: str, reason: str = "missing or out of range"):
        super().__init__(f"item {item_id!r}: {reason}")
        self.item_id = item_id


def score(defn: ScaleDef, answers: dict[str, int]) -> ScaleResult:
    values: dict[str, float] = {}
    notes: list[str] = []
    for item in defn.items:
        lo, hi = defn.item_range(item)
        x = answers.get(item.id)
        if x is None and item.optional:
            continue
        if x is None or isinstance(x, bool) or not lo <= x <= hi:
            raise AnswerError(item.id)
        values[item.id] = lo + hi - x if item.reverse else x

    subs: dict[str, float | None] = {}
    for name, sub in defn.subscales.items():
        vals = [values[i] for i in sub.items if i in values]
        skipped = [i for i in sub.items if i not in values]
        if not vals:
            subs[name] = None
            notes.append(f"subscale {name!r}: all items skipped, no score")
            continue
        mean = sum(vals) / len(vals)
        if sub.aggregate == "mean":
            subs[name] = mean
        elif skipped:
            subs[name] = mean * len(sub.items)
            notes.append(f"subscale {name!r}: prorated sum, skipped optional items {skipped}")
        else:
            subs[name] = float(sum(vals))
        if skipped and sub.aggregate == "mean":
            notes.append(f"subscale {name!r}: mean of answered items, skipped {skipped}")

    bands = {}
    for name, val in subs.items():
        label = NO_BAND
        for b in defn.norms or []:
            if val is not None and b.subscale == name and b.min <= val <= b.max:
                label = b.label
                break
        bands[name] = label

    flags: dict[str, bool] = {}
    for c in defn.cutoffs or []:
        val = subs[c.subscale]
        if val is None:
            continue
        hit = val < c.value if c.direction == "below" else val > c.value
        flags[c.subscale] = flags.get(c.subscale, False) or hit

    if not defn.verified:
        status = "unverified"
    elif defn.custom and not defn.owner_approved:
        status = "draft"
    else:
        status = "ok"
    return ScaleResult(subscales=subs, bands=bands, cutoff_flags=flags, status=status, notes=notes)
