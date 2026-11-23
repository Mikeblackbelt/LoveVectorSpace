from pathlib import Path

import yaml

from .schema import ScaleDef


def load_scales(dir: Path) -> dict[str, ScaleDef]:
    out: dict[str, ScaleDef] = {}
    for path in sorted(Path(dir).glob("*.yaml")):
        defn = ScaleDef.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
        if defn.id in out:
            raise ValueError(f"duplicate scale id {defn.id!r} in {path.name}")
        out[defn.id] = defn
    return out
