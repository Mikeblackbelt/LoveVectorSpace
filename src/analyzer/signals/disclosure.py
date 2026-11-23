import re

from .evidence import ROLES, Metric, gate, insufficient
from .text import load_wordlist, norm_apostrophes, tokens


def _compile(entries):
    return [re.compile(r"\b" + re.escape(e.lower()).replace(r"\ ", r"\s+") + r"\b") for e in entries]


def disclosure_rate(msgs) -> Metric:
    why = gate(msgs)
    if why:
        return insufficient("disclosure_rate", "moderate", why)
    pats = _compile(load_wordlist("disclosure")["terms"])
    hits = {r: 0 for r in ROLES}
    words = {r: 0 for r in ROLES}
    for m in msgs:
        words[m.role] += len(tokens(m.text))
        low = norm_apostrophes(m.text).lower()
        hits[m.role] += sum(len(p.findall(low)) for p in pats)
    if min(words.values()) == 0:
        return insufficient("disclosure_rate", "moderate", "one speaker has no words")
    per = {r: 100 * hits[r] / words[r] for r in ROLES}
    return Metric("disclosure_rate", 100 * sum(hits.values()) / sum(words.values()), per,
                  "moderate", "ok",
                  "self-disclosure lexicon hits per 100 words (own open list); no reference band")
