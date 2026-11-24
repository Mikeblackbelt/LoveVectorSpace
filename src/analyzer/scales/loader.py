from pathlib import Path

import yaml

from .schema import ScaleDef


def load_scales(dir: Path, overlay_dir: Path | None = None) -> dict[str, ScaleDef]:
    """Load scale definitions; optionally merge local item-text overlays.

    An overlay file `<overlay_dir>/<scale_id>.yaml` maps item id -> text.
    """
    out: dict[str, ScaleDef] = {}
    for path in sorted(Path(dir).glob("*.yaml")):
        defn = ScaleDef.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
        if defn.id in out:
            raise ValueError(f"duplicate scale id {defn.id!r} in {path.name}")
        if overlay_dir is not None:
            ov_path = Path(overlay_dir) / f"{defn.id}.yaml"
            if ov_path.exists():
                _apply_overlay(defn, yaml.safe_load(ov_path.read_text(encoding="utf-8")))
        out[defn.id] = defn
    return out


def _apply_overlay(defn: ScaleDef, overlay: object) -> None:
    if not isinstance(overlay, dict):
        raise ValueError(f"overlay for {defn.id!r} must be a mapping of item id to text")
    by_id = {i.id: i for i in defn.items}
    unknown = [k for k in overlay if k not in by_id]
    if unknown:
        raise ValueError(f"overlay for {defn.id!r} has unknown item ids {unknown}")
    for k, v in overlay.items():
        by_id[k].text = str(v)
