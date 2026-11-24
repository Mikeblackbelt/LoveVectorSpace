from typing import Literal

from pydantic import BaseModel, field_validator, model_validator

MODE_ALIASES = {"early": "potential"}  # older defs used "early" for what people call "potential"


class ResponseFormat(BaseModel):
    min: int
    max: int


class Item(BaseModel):
    id: str
    text: str | None = None
    reverse: bool = False
    optional: bool = False
    min: int | None = None
    max: int | None = None


class Subscale(BaseModel):
    items: list[str]
    aggregate: Literal["sum", "mean"]


class Band(BaseModel):
    subscale: str
    min: float
    max: float
    label: str


class Cutoff(BaseModel):
    subscale: str
    value: float
    direction: Literal["below", "above"] = "below"
    label: str


class Source(BaseModel):
    citation: str
    url: str | None = None
    terms: str | None = None


class ScaleDef(BaseModel):
    id: str
    name: str
    mode: list[str]
    items: list[Item]
    subscales: dict[str, Subscale]
    response: ResponseFormat
    norms: list[Band] | None = None
    cutoffs: list[Cutoff] | None = None
    source: Source
    verified: bool = False
    custom: bool = False
    owner_approved: bool = False
    item_text: Literal["inline", "local_overlay"] = "inline"
    measures: str = ""
    does_not_measure: str = ""

    @field_validator("mode")
    @classmethod
    def _norm_mode(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for m in v:
            m = MODE_ALIASES.get(m, m)
            if m not in out:
                out.append(m)
        return out

    @model_validator(mode="after")
    def _check_refs(self):
        ids = [i.id for i in self.items]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate item ids")
        known = set(ids)
        for name, sub in self.subscales.items():
            unknown = [i for i in sub.items if i not in known]
            if unknown:
                raise ValueError(f"subscale {name!r} has unknown items {unknown}")
        for ref in [*(self.norms or []), *(self.cutoffs or [])]:
            if ref.subscale not in self.subscales:
                raise ValueError(f"unknown subscale {ref.subscale!r}")
        return self

    def item_range(self, item: Item) -> tuple[int, int]:
        lo = self.response.min if item.min is None else item.min
        hi = self.response.max if item.max is None else item.max
        return lo, hi


class ScaleResult(BaseModel):
    subscales: dict[str, float | None]
    bands: dict[str, str]
    cutoff_flags: dict[str, bool]
    status: Literal["ok", "draft", "unverified"]
    notes: list[str] = []


def display_text(item: Item, scale: ScaleDef) -> str:
    """Item wording, or a placeholder when the text lives in a local overlay."""
    if item.text:
        return item.text
    n = scale.items.index(item) + 1
    return f"{scale.name} item {n} (enter text from the official form)"
