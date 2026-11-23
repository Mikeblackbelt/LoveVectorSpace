# Model provenance

Model files are not committed (`models/*/` is gitignored). Recreate them with
`scripts/fetch_models.py` (emotion) and `scripts/fetch_models.py --export` (adds toxicity).
Each model directory holds `model.onnx`, `tokenizer.json` and `labels.json`.
Inference is CPU-only through onnxruntime; torch and optimum are build-time only (the `export` extra).

| Dir | Source | Licence | What we ship |
|---|---|---|---|
| `emotion/` | `SamLowe/roberta-base-go_emotions-onnx`, file `onnx/model_quantized.onnx` | MIT | Downloaded as-is: roberta-base fine-tuned on GoEmotions, int8 ONNX, 28 labels (from the repo's `config.json`) |
| `toxicity/` | `unitary/toxic-bert` (Detoxify "original", bert-base-uncased on Jigsaw 2018) | Apache-2.0 | Exported to ONNX with optimum, then dynamically quantized to int8 (AVX2 config, per-tensor) by `scripts/fetch_models.py --export`; 6 labels (toxic, severe_toxic, obscene, threat, insult, identity_hate) |

Cache keys: `emotion:go_emotions_onnx`, `toxicity:toxic_bert_int8`.

Caveats: both models are trained on public web text (Reddit, Wikipedia comments), not 1:1 chat, so domain
shift is expected. Swearing and banter score as toxic. Emotion labels with low reliability (e.g. relief,
pride) must not be presented as findings.

## Benchmark

`pytest -m slow -s tests/perf` (512 short messages, batch 64, 128-token truncation, one warm-up batch).

Measured 2026-11-23 on the development Windows laptop (CPU only, onnxruntime):

| Model | File size | msgs/s |
|---|---|---|
| emotion (roberta-base int8) | 125 MB | 12.0 |
| toxicity (bert-base int8) | 110 MB | 11.3 |

Roughly 85 ms per message per model at this setting; Task 8's job design should budget about
1 minute per 700 messages per model (two models: about 1 minute per 350 messages), with the per-message
cache making re-runs incremental.
