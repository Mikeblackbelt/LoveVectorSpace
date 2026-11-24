from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
from tokenizers import Tokenizer, models, pre_tokenizers

from analyzer.ml.emotion import MODEL_KEY as EMO_KEY, emotion_metrics
from analyzer.ml.onnx_text import OnnxTextClassifier
from analyzer.ml.toxicity import MODEL_KEY as TOX_KEY, toxicity_metric, toxicity_scores
from analyzer.store.messages import MessageStore
from analyzer.store.scores import Scores
from analyzer.parsers.model import Message
from analyzer.store.messages import StoredMessage

T0 = datetime(2025, 1, 1, 12, 0, tzinfo=timezone.utc)


def msg(i, role, text, ts):
    return StoredMessage(id=i, person_id=1, ts=ts, role=role, speaker_raw=str(role),
                         text=text, ts_precision="second", sources=["t"])


def mk(text, minutes, role):
    return Message(ts=T0 + timedelta(minutes=minutes), role=role, speaker_raw=role, text=text,
                   ts_precision="second", platform_msg_id=None, source="whatsapp_import")

MODELS = Path(__file__).resolve().parents[2] / "models"
LABELS = ["admiration", "joy", "anger"]


class _In:
    def __init__(self, name):
        self.name = name


class FakeSession:
    """Mimics onnxruntime.InferenceSession: logit[:, k] is driven by the token ids."""

    def __init__(self, n_labels=3, hot=None):
        self.batches: list[tuple[int, int]] = []
        self.n = n_labels
        self.hot = hot or {}  # first token id -> label index to make high

    def get_inputs(self):
        return [_In("input_ids"), _In("attention_mask")]

    def run(self, _outs, feed):
        ids = feed["input_ids"]
        assert set(feed) == {"input_ids", "attention_mask"}
        self.batches.append(ids.shape)
        logits = np.full((ids.shape[0], self.n), -4.0)
        for r, row in enumerate(ids):
            logits[r, self.hot.get(int(row[0]), 0)] = 4.0
        return [logits]


@pytest.fixture
def tok_dir(tmp_path):
    vocab = {"[PAD]": 0, "[UNK]": 1, "love": 2, "hate": 3, "hi": 4}
    t = Tokenizer(models.WordLevel(vocab, unk_token="[UNK]"))
    t.pre_tokenizer = pre_tokenizers.Whitespace()
    t.save(str(tmp_path / "tokenizer.json"))
    return tmp_path


def make_clf(tok_dir, hot=None, labels=LABELS, **kw):
    sess = FakeSession(len(labels), hot)
    return OnnxTextClassifier(tok_dir, labels, session=sess, **kw), sess


def test_classifier_batches(tok_dir):
    clf, sess = make_clf(tok_dir)
    out = clf.predict(["hi"] * 150)
    assert out.shape == (150, 3)
    assert [b[0] for b in sess.batches] == [64, 64, 22]
    assert ((out > 0) & (out < 1)).all()  # sigmoid probabilities


def test_classifier_pads_per_batch_and_truncates(tok_dir):
    clf, sess = make_clf(tok_dir, batch_size=2)
    clf.predict(["hi", "hi hi hi", "hi", "hi"])
    assert [b[1] for b in sess.batches] == [3, 1]
    clf.predict(["hi " * 500])
    assert sess.batches[-1][1] == 128


def test_classifier_empty(tok_dir):
    clf, _ = make_clf(tok_dir)
    assert clf.predict([]).shape == (0, 3)


def chat(n=24):
    return [msg(i, "me" if i % 2 == 0 else "them", "love" if i % 3 == 0 else "hate",
                T0 + timedelta(minutes=i)) for i in range(n)]


def test_emotion_metric_shape(tok_dir):
    clf, _ = make_clf(tok_dir, hot={2: 1, 3: 2})  # love -> joy, hate -> anger
    ms = emotion_metrics(chat(), clf)
    assert 1 <= len(ms) <= 6
    assert {m.id for m in ms} == {"emotion_share:joy", "emotion_share:anger"}
    for m in ms:
        assert m.evidence == "descriptive" and m.status == "ok"
        assert set(m.per_speaker) == {"me", "them"}
    assert sum(m.value for m in ms) == pytest.approx(1.0)
    joy = next(m for m in ms if m.id == "emotion_share:joy")
    assert joy.value == pytest.approx(8 / 24)


def test_emotion_gate(tok_dir):
    clf, sess = make_clf(tok_dir)
    ms = emotion_metrics(chat(10), clf)
    assert ms[0].status == "insufficient_data" and not sess.batches
    with pytest.raises(ValueError):
        emotion_metrics([msg(0, None, "hi", T0)] * 30, clf)


def test_toxicity_alignment(tok_dir):
    clf, _ = make_clf(tok_dir, hot={3: 1}, labels=["x", "toxic", "y"])  # hate -> toxic
    msgs = chat()
    s = toxicity_scores(msgs, clf)
    assert len(s) == len(msgs)
    for m, v in zip(msgs, s):
        assert (v > 0.5) == (m.text == "hate")
    met = toxicity_metric(msgs, clf)
    assert met.value == pytest.approx(16 / 24)
    assert met.evidence == "heuristic" and set(met.per_speaker) == {"me", "them"}
    assert toxicity_scores([], clf) == []


def test_cached_scores_not_recomputed(conn, tok_dir):
    pid = conn.execute("INSERT INTO people(pseudonym, mode, timezone, created_at) "
                       "VALUES ('S','potential','UTC','x')").lastrowid
    conn.commit()
    ms = MessageStore(conn)
    ms.ingest(pid, [mk(f"love {i}", i, "me" if i % 2 == 0 else "them") for i in range(24)], "u1")
    clf, sess = make_clf(tok_dir)
    scores = Scores(conn)
    first = emotion_metrics(ms.messages(pid), clf, scores)
    assert sum(b[0] for b in sess.batches) == 24
    sess.batches.clear()
    ms.ingest(pid, [mk("hate new", 100 + i, "me" if i % 2 == 0 else "them") for i in range(3)], "u2")
    again = emotion_metrics(ms.messages(pid), clf, scores)
    assert sum(b[0] for b in sess.batches) == 3  # only the new messages
    assert first and again
    sess.batches.clear()
    emotion_metrics(ms.messages(pid), clf, scores)
    assert not sess.batches
    # separate model key per task
    ids = [m.id for m in ms.messages(pid)]
    assert len(scores.get(ids, EMO_KEY)) == 27 and scores.get(ids, TOX_KEY) == {}


# ---- real-model tests ------------------------------------------------------

def _real(name, labels_key=None):
    d = MODELS / name
    if not (d / "model.onnx").exists():
        pytest.skip(f"models/{name} not downloaded")
    import json
    labels = json.loads((d / "labels.json").read_text())
    return OnnxTextClassifier(d, labels)


@pytest.mark.models
def test_real_toxicity_ranks_insult_above_greeting():
    clf = _real("toxicity")
    p = clf.predict(["you are a worthless idiot and I hate you", "good morning, hope you slept well"])
    t = clf.labels.index("toxic")
    assert p[0, t] > p[1, t]
    assert p[0, t] > 0.5 > p[1, t]


@pytest.mark.models
def test_real_emotion_labels_and_gratitude():
    clf = _real("emotion")
    assert len(clf.labels) == 28
    p = clf.predict(["thank you so much, that really means a lot", "this is so annoying, stop it"])
    assert clf.labels[int(p[0].argmax())] in {"gratitude", "admiration", "love"}
    assert clf.labels[int(p[1].argmax())] in {"annoyance", "anger", "disapproval"}
