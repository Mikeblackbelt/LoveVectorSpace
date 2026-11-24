import json
import time
from pathlib import Path

import pytest

from analyzer.ml.onnx_text import OnnxTextClassifier

MODELS = Path(__file__).resolve().parents[2] / "models"
N = 512
SAMPLES = [
    "good morning, hope you slept well",
    "I can't believe you did that, honestly so annoying",
    "lol that is hilarious, thank you for sending it",
    "are we still on for dinner on friday? I booked the table for seven",
    "I'm feeling kind of anxious about the interview tomorrow but I'll be fine",
    "you never listen to me and I am tired of it",
]


@pytest.mark.slow
@pytest.mark.models
@pytest.mark.parametrize("name", ["emotion", "toxicity"])
def test_benchmark_messages_per_second(name):
    d = MODELS / name
    if not (d / "model.onnx").exists():
        pytest.skip(f"models/{name} not downloaded")
    clf = OnnxTextClassifier(d, json.loads((d / "labels.json").read_text()))
    texts = (SAMPLES * (N // len(SAMPLES) + 1))[:N]
    clf.predict(texts[:64])  # warm-up
    t0 = time.perf_counter()
    out = clf.predict(texts)
    rate = N / (time.perf_counter() - t0)
    print(f"\nBENCH {name}: {rate:.1f} msgs/s ({N} short messages, batch 64, this CPU)")
    assert out.shape == (N, len(clf.labels))
    assert rate > 0
