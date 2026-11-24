import numpy as np

from analyzer.ml.scoring import score_messages
from analyzer.signals.evidence import ROLES, Metric, gate, insufficient

MODEL_KEY = "emotion:go_emotions_onnx"
TOP_K = 6
NOTE = ("go_emotions model trained on Reddit, domain shift expected; "
        "share of each speaker's messages whose top-scoring label is this emotion")


def emotion_metrics(msgs, clf, scores=None) -> list[Metric]:
    """Top-6 emotion share per speaker (descriptive): one Metric per emotion in the overall top 6."""
    reason = gate(msgs)
    if reason:
        return [insufficient("emotion_share", "descriptive", reason)]
    probs = score_messages(msgs, clf, MODEL_KEY, scores)
    top = probs.argmax(axis=1)
    roles = np.array([m.role for m in msgs])
    n = len(clf.labels)
    share = {r: np.bincount(top[roles == r], minlength=n) / (roles == r).sum() for r in ROLES}
    overall = np.bincount(top, minlength=n) / len(top)
    order = [int(i) for i in np.argsort(-overall, kind="stable")[:TOP_K] if overall[i] > 0]
    return [Metric(f"emotion_share:{clf.labels[i]}", float(overall[i]),
                   {r: float(share[r][i]) for r in ROLES}, "descriptive", "ok", NOTE)
            for i in order]
