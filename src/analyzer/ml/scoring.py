"""Score messages through a classifier using the per-message cache."""
import numpy as np


def score_messages(msgs, clf, model: str, scores=None) -> np.ndarray:
    """(len(msgs), n_labels) probabilities; only uncached message ids reach the model."""
    n_labels = len(clf.labels)
    if not msgs:
        return np.zeros((0, n_labels), dtype=np.float32)
    cached = scores.get([m.id for m in msgs], model) if scores is not None else {}
    todo = {}
    for m in msgs:
        if m.id not in cached:
            todo.setdefault(m.id, m.text)
    if todo:
        probs = clf.predict(list(todo.values()))
        fresh = {mid: [float(x) for x in row] for mid, row in zip(todo, probs)}
        if scores is not None:
            scores.put(model, fresh)
        cached = {**cached, **fresh}
    return np.array([cached[m.id] for m in msgs], dtype=np.float32)
