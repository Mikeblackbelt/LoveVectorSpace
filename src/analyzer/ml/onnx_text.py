"""Batched ONNX text classifier (multi-label, sigmoid outputs). No torch at runtime."""
from pathlib import Path

import numpy as np

MAX_TOKENS = 128


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


class OnnxTextClassifier:
    def __init__(self, model_dir: Path, labels: list[str], batch_size: int = 64, session=None):
        from tokenizers import Tokenizer

        model_dir = Path(model_dir)
        self.labels = list(labels)
        self.batch_size = batch_size
        self.tok = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tok.enable_truncation(max_length=MAX_TOKENS)
        pad = self.tok.padding or {}
        pad_token = pad.get("pad_token") or next(
            (t for t in ("<pad>", "[PAD]") if self.tok.token_to_id(t) is not None), None)
        if pad_token is None:
            raise ValueError("tokenizer has no pad token")
        # padding is per batch (longest in the batch), never to a fixed length
        self.tok.enable_padding(pad_id=self.tok.token_to_id(pad_token), pad_token=pad_token)
        if session is None:
            import onnxruntime as ort

            session = ort.InferenceSession(str(model_dir / "model.onnx"),
                                           providers=["CPUExecutionProvider"])
        self.session = session
        self._inputs = {i.name for i in session.get_inputs()}

    def predict(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), len(self.labels)), dtype=np.float32)
        for i in range(0, len(texts), self.batch_size):
            enc = self.tok.encode_batch(texts[i:i + self.batch_size])
            feed = {
                "input_ids": np.array([e.ids for e in enc], dtype=np.int64),
                "attention_mask": np.array([e.attention_mask for e in enc], dtype=np.int64),
                "token_type_ids": np.array([e.type_ids for e in enc], dtype=np.int64),
            }
            feed = {k: v for k, v in feed.items() if k in self._inputs}
            logits = self.session.run(None, feed)[0]
            out[i:i + len(enc)] = sigmoid(np.asarray(logits, dtype=np.float32))
        return out
