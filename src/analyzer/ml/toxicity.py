import numpy as np

from analyzer.ml.scoring import score_messages
from analyzer.signals.evidence import ROLES, Metric, gate, insufficient

MODEL_KEY = "toxicity:toxic_bert_int8"
THRESHOLD = 0.5
NOTE = ("Detoxify original (Jigsaw); swearing and banter score as toxic; "
        "share of messages with toxicity probability above 0.5")


def toxicity_scores(msgs, clf, scores=None) -> list[float]:
    """Per-message toxicity probability (label 'toxic'), aligned with msgs."""
    if not msgs:
        return []
    probs = score_messages(msgs, clf, MODEL_KEY, scores)
    return [float(x) for x in probs[:, clf.labels.index("toxic")]]


def toxicity_metric(msgs, clf, scores=None) -> Metric:
    reason = gate(msgs)
    if reason:
        return insufficient("toxicity_rate", "heuristic", reason)
    s = np.array(toxicity_scores(msgs, clf, scores))
    roles = np.array([m.role for m in msgs])
    return Metric("toxicity_rate", float((s > THRESHOLD).mean()),
                  {r: float((s[roles == r] > THRESHOLD).mean()) for r in ROLES},
                  "heuristic", "ok", NOTE)
