from .evidence import ROLES, Metric, gate, insufficient
from .text import load_wordlist, tokens

MIN_CATEGORIES = 5
CATEGORIES = ("personal_pronouns", "impersonal_pronouns", "articles", "conjunctions",
              "prepositions", "auxiliary_verbs", "adverbs", "negations", "quantifiers")


def lsm(msgs) -> Metric:
    why = gate(msgs)
    if why:
        return insufficient("lsm", "moderate", why)
    lists = {c: set(w) for c, w in load_wordlist("function_words").items()}
    counts = {r: {c: 0 for c in CATEGORIES} for r in ROLES}
    total = {r: 0 for r in ROLES}
    for m in msgs:
        for t in tokens(m.text):
            total[m.role] += 1
            for c in CATEGORIES:
                if t in lists[c]:
                    counts[m.role][c] += 1
    if min(total.values()) == 0:
        return insufficient("lsm", "moderate", "one speaker has no words")
    scores = []
    for c in CATEGORIES:
        a = 100 * counts["me"][c] / total["me"]
        b = 100 * counts["them"][c] / total["them"]
        if a + b > 0:
            scores.append(1 - abs(a - b) / (a + b + 0.0001))
    k = len(scores)
    if k < MIN_CATEGORIES:
        return insufficient("lsm", "moderate",
                            f"only {k} of 9 function-word categories used by either speaker")
    return Metric("lsm", sum(scores) / k, None, "moderate", "ok",
                  f"language style matching over {k} of 9 function-word categories "
                  "(own open word lists); no reference band")
