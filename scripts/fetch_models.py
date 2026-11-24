"""Download / export the ONNX models into models/{emotion,toxicity}/.

  python scripts/fetch_models.py            # emotion only (needs the `fetch` extra)
  python scripts/fetch_models.py --export   # + toxicity: export unitary/toxic-bert and
                                            #   dynamically quantize to int8 (needs the `export` extra)

Each model dir gets model.onnx, tokenizer.json and labels.json. See models/PROVENANCE.md.
"""
import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"

EMOTION_REPO = "SamLowe/roberta-base-go_emotions-onnx"
EMOTION_ONNX = "onnx/model_quantized.onnx"
TOXICITY_REPO = "unitary/toxic-bert"


def _labels_from_config(config_path: Path) -> list[str]:
    id2label = json.loads(config_path.read_text(encoding="utf-8"))["id2label"]
    return [id2label[str(i)] for i in range(len(id2label))]


def fetch_emotion() -> None:
    from huggingface_hub import hf_hub_download

    out = MODELS / "emotion"
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(hf_hub_download(EMOTION_REPO, EMOTION_ONNX), out / "model.onnx")
    shutil.copyfile(hf_hub_download(EMOTION_REPO, "tokenizer.json"), out / "tokenizer.json")
    labels = _labels_from_config(Path(hf_hub_download(EMOTION_REPO, "config.json")))
    (out / "labels.json").write_text(json.dumps(labels), encoding="utf-8")
    print(f"emotion: {len(labels)} labels -> {out}")


def export_toxicity() -> None:
    from optimum.onnxruntime import ORTModelForSequenceClassification, ORTQuantizer
    from optimum.onnxruntime.configuration import AutoQuantizationConfig
    from transformers import AutoTokenizer

    out = MODELS / "toxicity"
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        fp32, quant = Path(tmp) / "fp32", Path(tmp) / "int8"
        model = ORTModelForSequenceClassification.from_pretrained(TOXICITY_REPO, export=True)
        model.save_pretrained(fp32)
        AutoTokenizer.from_pretrained(TOXICITY_REPO).save_pretrained(fp32)
        quantizer = ORTQuantizer.from_pretrained(fp32)
        # AVX2 dynamic int8 runs on any x86-64 CPU from the last decade; weights are int8
        quantizer.quantize(save_dir=quant, quantization_config=AutoQuantizationConfig.avx2(
            is_static=False, per_channel=False))
        shutil.copyfile(quant / "model_quantized.onnx", out / "model.onnx")
        shutil.copyfile(fp32 / "tokenizer.json", out / "tokenizer.json")
        labels = _labels_from_config(fp32 / "config.json")
    (out / "labels.json").write_text(json.dumps(labels), encoding="utf-8")
    print(f"toxicity: {len(labels)} labels -> {out}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", action="store_true",
                    help="also export + int8-quantize the toxicity model (needs torch and optimum)")
    args = ap.parse_args()
    fetch_emotion()
    if args.export:
        export_toxicity()
    else:
        print("toxicity model NOT fetched: it is exported locally from unitary/toxic-bert, "
              "so re-run with --export (needs `uv sync --extra export`: torch + optimum).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
