"""Compute a PersonOverview dict from one user's DB.

Threading: every function that takes `conn` must be called with the per-user lock held. Model scoring is
split out so callers can run it WITHOUT the lock: `scoring_plan` (lock held: read the texts still to
score), `run_scoring` (no lock, no DB: run the classifiers), `store_scores` (lock held: write the
results for messages that still exist), then `compute_overview(..., score_missing=False)` (lock held:
metrics from cached scores only, so it never calls a model).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone

from analyzer.ml.emotion import MODEL_KEY as EMOTION_KEY, emotion_metrics
from analyzer.ml.toxicity import MODEL_KEY as TOXICITY_KEY, toxicity_metric, toxicity_scores
from analyzer.safety.check import safety_check
from analyzer.scales.schema import ScaleResult
from analyzer.signals.evidence import insufficient
from analyzer.signals.interactions import interaction_metrics
from analyzer.signals.report import core_report, coverage_ratio
from analyzer.signals.success import uncalibrated_success
from analyzer.signals.trends import _covered, change_points, weekly_trends
from analyzer.store.facts import Facts
from analyzer.store.interactions import Interactions
from analyzer.store.messages import MessageStore
from analyzer.store.people import People
from analyzer.store.scores import Scores
from analyzer.store.settings import Settings
from analyzer.store.snapshots import Snapshots

from . import labels

WINDOW_DAYS = 90
MAX_SCORED = 5000
MAX_SYNC_SCORED = 1000  # at most this many not-yet-scored messages go through a model per analysis run
SCORING_NOTE = (f"model-scored on the most recent {WINDOW_DAYS} days or last {MAX_SCORED:,} messages, "
                "whichever is smaller")
MODELS = (("emotion", EMOTION_KEY), ("toxicity", TOXICITY_KEY))
SEV_RANK = {"none": 0, "info": 1, "concern": 2, "urgent": 3}


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _day_iso(d) -> str:
    """A calendar date as an ISO datetime (midnight UTC, trailing Z), like every other timestamp."""
    return iso(datetime(d.year, d.month, d.day, tzinfo=timezone.utc))


def person_dict(p) -> dict:
    return {"id": p.id, "pseudonym": p.pseudonym, "mode": p.mode, "timezone": p.timezone,
            "created_at": iso(p.created_at)}


def metric_dict(m, extra_note: str = "") -> dict:
    note = m.note if not extra_note else (m.note + "; " + extra_note if m.note else extra_note)
    return {"id": m.id, "label": labels.label(m.id), "plain_label": labels.plain_label(m.id),
            "value": m.value, "per_speaker": m.per_speaker, "evidence": m.evidence,
            "status": m.status, "note": note, "band": labels.NO_BAND}


def scale_snapshots(conn, pid: int) -> list[dict]:
    """Questionnaire submissions (newest first)."""
    out = []
    for s in Snapshots(conn).list(pid):
        if isinstance(s.data, dict) and s.data.get("kind") == "scale":
            out.append({"scale_id": s.data["scale_id"], "submitted_at": iso(s.created_at),
                        "result": s.data["result"]})
    return out


def overview_snapshots(conn, pid: int):
    return [s for s in Snapshots(conn).list(pid)
            if isinstance(s.data, dict) and s.data.get("kind") == "overview"]


def _scoring_window(msgs):
    if not msgs:
        return []
    end = msgs[-1].ts
    recent = [m for m in msgs if m.ts >= end - timedelta(days=WINDOW_DAYS)]
    return recent[-MAX_SCORED:]


@dataclass
class ScoringPlan:
    """What one analysis run sends through the models."""
    todo: dict[str, list[tuple[int, str]]] = field(default_factory=dict)   # classifier name -> [(id, text)]
    remaining: int = 0   # unscored window messages left for a later run (max over classifiers)

    @property
    def count(self) -> int:
        return sum(len(v) for v in self.todo.values())


def scoring_plan(conn, pid: int, classifiers, cap: int | None = None) -> ScoringPlan:
    """Lock held. Per loaded classifier, the most recent `cap` (default MAX_SYNC_SCORED) messages of the
    scoring window that have no cached score yet."""
    cap = MAX_SYNC_SCORED if cap is None else cap
    window = _scoring_window(MessageStore(conn).messages(pid))
    scores, plan = Scores(conn), ScoringPlan()
    ids = [m.id for m in window]
    for name, key in MODELS:
        if getattr(classifiers, name, None) is None:
            continue
        have = scores.ids(ids, key)
        unscored = [m for m in window if m.id not in have]
        take = unscored[-cap:] if cap > 0 else []
        plan.todo[name] = [(m.id, m.text) for m in take]
        plan.remaining = max(plan.remaining, len(unscored) - len(take))
    return plan


def run_scoring(plan: ScoringPlan, classifiers) -> dict[str, dict[int, list[float]]]:
    """No lock, no DB access: run each classifier over its planned texts -> {model key: {id: vector}}."""
    out: dict[str, dict[int, list[float]]] = {}
    for name, key in MODELS:
        items = plan.todo.get(name)
        clf = getattr(classifiers, name, None)
        if not items or clf is None:
            continue
        probs = clf.predict([t for _, t in items])
        out[key] = {mid: [float(x) for x in row] for (mid, _), row in zip(items, probs)}
    return out


def store_scores(conn, fresh: dict[str, dict[int, list[float]]]) -> int:
    """Lock held. Cache fresh scores, dropping messages deleted while the model ran. Returns rows written."""
    all_ids = sorted({mid for m in fresh.values() for mid in m})
    alive: set[int] = set()
    for i in range(0, len(all_ids), 500):
        part = all_ids[i:i + 500]
        q = ",".join("?" * len(part))
        alive |= {r[0] for r in conn.execute(f"SELECT id FROM messages WHERE id IN ({q})", part)}
    scores, n = Scores(conn), 0
    for key, mapping in fresh.items():
        keep = {mid: v for mid, v in mapping.items() if mid in alive}
        if keep:
            scores.put(key, keep)
            n += len(keep)
    return n


def weekly(msgs, coverage) -> list[dict]:
    if not msgs:
        return []
    tr = weekly_trends(msgs, {"me": lambda ms: sum(m.role == "me" for m in ms),
                              "them": lambda ms: sum(m.role == "them" for m in ms)})
    out = []
    for (w, me), (_, them) in zip(tr["me"], tr["them"]):
        cov = bool(coverage) and _covered(w, coverage)
        out.append({"week": w.isoformat(),
                    "me": (int(me) if me is not None else 0) if cov else None,
                    "them": (int(them) if them is not None else 0) if cov else None,
                    "covered": cov})
    return out


def _partial_note(n_scored: int, n_window: int) -> str:
    if n_scored >= n_window:
        return SCORING_NOTE
    return f"{SCORING_NOTE}; {n_scored:,} of {n_window:,} scored so far, the rest are queued"


def compute_overview(conn, pid: int, scales: dict, classifiers, now: datetime | None = None,
                     score_missing: bool = True) -> dict:
    """classifiers: object with .emotion and .toxicity attributes (either may be None).

    score_missing=False: model metrics use only messages that already have cached scores, so no model
    runs here (see `scoring_plan` / `run_scoring` / `store_scores`)."""
    person = People(conn).get(pid)
    store = MessageStore(conn)
    msgs = store.messages(pid)
    coverage = store.coverage(pid)
    facts = Facts(conn).list(pid)
    inter = Interactions(conn).list(pid)
    now = now or datetime.now(timezone.utc)
    end = msgs[-1].ts if msgs else now
    window = (end - timedelta(days=WINDOW_DAYS), end)
    cov_ratio = coverage_ratio(coverage, window) if coverage else 0.0

    chat = core_report(msgs, coverage or None, window)
    metrics = [metric_dict(m) for m in chat]
    scored = _scoring_window(msgs)
    scores = Scores(conn)
    emo, tox = getattr(classifiers, "emotion", None), getattr(classifiers, "toxicity", None)

    def cached(key):
        if score_missing:
            return scored
        have = scores.ids([m.id for m in scored], key)
        return [m for m in scored if m.id in have]
    tox_by_id: dict[int, float] = {}
    if emo is not None:
        sub = cached(EMOTION_KEY)
        note = _partial_note(len(sub), len(scored))
        metrics += [metric_dict(m, note) for m in emotion_metrics(sub, emo, scores)]
    else:
        metrics.append(metric_dict(insufficient("emotion_share", "descriptive",
                                                "emotion model not installed; metric skipped")))
    if tox is not None:
        sub = cached(TOXICITY_KEY)
        metrics.append(metric_dict(toxicity_metric(sub, tox, scores), _partial_note(len(sub), len(scored))))
        tox_by_id = {m.id: s for m, s in zip(sub, toxicity_scores(sub, tox, scores))}
    else:
        metrics.append(metric_dict(insufficient("toxicity_rate", "heuristic",
                                                "toxicity model not installed; metric skipped")))
    tox_list = [tox_by_id.get(m.id, 0.0) for m in msgs] if tox is not None else None

    imetrics = interaction_metrics(inter, WINDOW_DAYS, now)
    imetric_dicts = [metric_dict(m) for m in imetrics]

    latest: dict[str, dict] = {}
    for s in scale_snapshots(conn, pid):
        latest.setdefault(s["scale_id"], s)
    scale_rows = []
    for sid, s in latest.items():
        r = s["result"]
        scale_rows.append({"scale_id": sid, "name": scales[sid].name if sid in scales else sid,
                           "status": r["status"], "subscales": r["subscales"], "bands": r["bands"],
                           "cutoff_flags": r["cutoff_flags"], "notes": r.get("notes", [])})
    cdaq = ScaleResult.model_validate(latest["cdaq_items"]["result"]) if "cdaq_items" in latest else None

    block = safety_check(msgs, tox_list, cdaq, facts)
    safety = {"flags": [{"category": f.category, "severity": f.severity, "speaker": f.speaker,
                         "count": f.count, "first_seen": _day_iso(f.first_seen),
                         "last_seen": _day_iso(f.last_seen), "snippets": f.snippets}
                        for f in block.flags],
              "resources": [{k: v for k, v in asdict(r).items() if k != "urgent_threat_only"}
                            for r in block.resources],
              "disclaimer": block.disclaimer}

    est = uncalibrated_success(person.mode, chat, imetrics, facts)
    success = est.model_dump(mode="json")
    success["top_contributors"] = [[a, b] for a, b in success["top_contributors"]]

    by_id = {m["id"]: m for m in metrics + imetric_dicts}
    recip = [by_id[i] for i in labels.RECIPROCITY if i in by_id]

    bands = {}
    for m in chat + imetrics:
        b = labels.balance_band(m.id, m.value, m.per_speaker)
        if b and m.status == "ok":
            bands[m.id] = b
    cps = []
    if msgs:
        tr = weekly_trends(msgs, {"message_share": lambda ms: sum(m.role == "me" for m in ms) / len(ms)},
                           coverage or None)["message_share"]
        last_week = max((w for w, v in tr if v is not None), default=None)
        if last_week is not None and last_week in change_points(tr):
            cps.append(f"message_share@{last_week.isoformat()}")  # keyed by week: only a new one is material
    return {
        "kind": "overview", "person": person_dict(person), "mode": person.mode, "generated_at": iso(now),
        "success": success, "safety": safety, "reciprocity": recip, "metrics": metrics,
        "interaction_metrics": imetric_dicts, "scales": scale_rows,
        "weekly": weekly(msgs, coverage), "coverage_ratio": round(cov_ratio, 3),
        "skipped_non_english": Settings(conn).get(f"skipped_non_english:{pid}", 0) or 0,
        "_internal": {"bands": bands, "change_points": cps},
    }


def public(data: dict, next_steps: list[dict]) -> dict:
    out = {k: v for k, v in data.items() if k not in ("kind", "_internal")}
    out["next_steps"] = next_steps
    return out


def max_severity(data: dict) -> str:
    sev = "none"
    for f in data.get("safety", {}).get("flags", []):
        if SEV_RANK[f["severity"]] > SEV_RANK[sev]:
            sev = f["severity"]
    return sev
