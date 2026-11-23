from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml

from analyzer.scales.schema import ScaleResult
from analyzer.store.messages import StoredMessage
from analyzer.store.models import Fact

from .rules import FACT_URGENT, URGENT_CATEGORIES, normalize, scan

Category = Literal["monitoring", "control", "isolation", "threat", "hostility", "self_harm"]
Severity = Literal["info", "concern", "urgent"]

DISCLAIMER = (
    "These flags come from pattern matching and questionnaire answers. They can be wrong in "
    "both directions. They are not a judgement about you or the other person."
)
_HERE = Path(__file__).parent
_RANK = {"info": 0, "concern": 1, "urgent": 2}
_FACT_CATEGORY_KEYS = [
    ("monitor", "monitoring"), ("control", "control"), ("isolat", "isolation"),
    ("threat", "threat"), ("self_harm", "self_harm"), ("selfharm", "self_harm"),
    ("suicid", "self_harm"), ("violen", "threat"), ("aggress", "hostility"), ("hostil", "hostility"),
]


@dataclass
class SafetyFlag:
    category: Category
    severity: Severity
    speaker: str  # "me" / "them" for messages, "owner_report" for questionnaire/facts
    count: int
    first_seen: date
    last_seen: date
    snippets: list[str] = field(default_factory=list)


@dataclass
class Resource:
    name: str
    phone: str
    text: str
    url: str
    description: str


@dataclass
class SafetyBlock:
    flags: list[SafetyFlag]
    resources: list[Resource]
    disclaimer: str = DISCLAIMER


@lru_cache(maxsize=1)
def _config() -> dict:
    return yaml.safe_load((_HERE / "config.yaml").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _resources() -> tuple[Resource, ...]:
    rows = yaml.safe_load((_HERE / "resources" / "us.yaml").read_text(encoding="utf-8"))
    return tuple(Resource(**r) for r in rows)


def _utc_date(ts: datetime) -> date:
    return (ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).date()


def _repeated(times: list[datetime], hits: int, window: timedelta) -> bool:
    ts = sorted(times)
    return any(ts[i + hits - 1] - ts[i] <= window for i in range(len(ts) - hits + 1))


def _make(cat: str, sev: str, speaker: str, ms: list[StoredMessage]) -> SafetyFlag:
    ms = sorted(ms, key=lambda m: m.ts)
    sn = _config()["snippets"]
    return SafetyFlag(cat, sev, speaker, len(ms), _utc_date(ms[0].ts), _utc_date(ms[-1].ts),
                      [m.text.strip()[: sn["max_chars"]] for m in ms[: sn["max_per_flag"]]])


def _message_flags(msgs: list[StoredMessage], tox: list[float] | None) -> list[SafetyFlag]:
    cfg = _config()
    window = timedelta(days=cfg["window_days"])
    need = cfg["concern_hits"]
    hits: dict[tuple[str, str], list[StoredMessage]] = {}
    for m in msgs:
        for cat in sorted(scan(m.text)):
            hits.setdefault((m.role or "unknown", cat), []).append(m)
    flags: list[SafetyFlag] = []
    for (speaker, cat), ms in hits.items():
        if cat in URGENT_CATEGORIES:
            sev = "urgent"
        elif _repeated([m.ts for m in ms], need, window):
            sev = "concern"
        else:
            sev = "info"
        flags.append(_make(cat, sev, speaker, ms))
    if tox is not None:
        t_cfg = cfg["toxicity"]
        high: dict[str, list[StoredMessage]] = {}
        for m, s in zip(msgs, tox):
            if s >= t_cfg["threshold"]:
                high.setdefault(m.role or "unknown", []).append(m)
        for speaker, ms in high.items():
            if len(ms) < t_cfg["min_messages"]:
                continue
            existing = next((f for f in flags if f.category == "hostility" and f.speaker == speaker), None)
            if existing:  # a pattern flag exists for this speaker: raise it, keep its snippets
                if existing.severity == "info":
                    existing.severity = "concern"
                existing.count = max(existing.count, len(ms))
            else:
                flags.append(_make("hostility", "concern", speaker, ms))
    return flags


def _owner_flag(cat: str, sev: str, d: date) -> SafetyFlag:
    return SafetyFlag(cat, sev, "owner_report", 1, d, d, [])


def _cdaq_flags(cdaq: ScaleResult, d: date) -> list[SafetyFlag]:
    q = _config()["questionnaire"]
    worst: dict[str, str] = {}
    for name, val in cdaq.subscales.items():
        if val is None or not name.endswith(("_experienced", "_done")):
            continue
        if name.startswith("monitoring"):
            cat = "monitoring"
        elif name.startswith("aggression"):
            cat = "hostility"
        else:
            continue
        sev = None
        if cat == "hostility" and val >= q["aggression_urgent_at"]:
            sev = "urgent"
        elif val >= q["concern_at"]:
            sev = "concern"
        if sev and _RANK[sev] > _RANK.get(worst.get(cat, "info"), -1):
            worst[cat] = sev
    return [_owner_flag(cat, sev, d) for cat, sev in worst.items()]


def _fact_category(key: str, value: str) -> str:
    k = key.lower()
    for frag, cat in _FACT_CATEGORY_KEYS:
        if frag in k:
            return cat
    cats = scan(value)
    for cat in ("self_harm", "threat", "hostility"):
        if cat in cats:
            return cat
    return "control"


def _fact_severity(value: str) -> str | None:
    f = _config()["facts"]
    v = normalize(value).strip(".! ")
    if not v or v in f["negative_words"]:
        return None  # "never", "no", "0": nothing to flag
    if v.startswith(("no ", "never ", "not ")) and not scan(v):
        return None
    if any(p.search(v) for p in FACT_URGENT):
        return "urgent"
    try:
        num = float(v)
        return "concern" if num >= f["numeric_concern_at"] else "info"
    except ValueError:
        pass
    if any(w in v for w in f["concern_words"]):
        return "concern"
    return "info"


def _fact_flags(facts: list[Fact]) -> list[SafetyFlag]:
    out = []
    for fa in facts:
        if not fa.key.startswith("safety."):
            continue
        sev = _fact_severity(fa.value)
        if sev:
            out.append(_owner_flag(_fact_category(fa.key, fa.value), sev, _utc_date(fa.updated_at)))
    return out


def safety_check(msgs: list[StoredMessage], tox: list[float] | None,
                 cdaq: ScaleResult | None, facts: list[Fact] | None) -> SafetyBlock:
    if tox is not None and len(tox) != len(msgs):
        raise ValueError("tox must align with msgs")
    flags = _message_flags(msgs, tox)
    today = _utc_date(max(m.ts for m in msgs)) if msgs else datetime.now(timezone.utc).date()
    if cdaq is not None:
        flags += _cdaq_flags(cdaq, today)
    if facts:
        flags += _fact_flags(facts)
    flags.sort(key=lambda f: -_RANK[f.severity])
    return SafetyBlock(flags=flags, resources=list(_resources()) if flags else [])
