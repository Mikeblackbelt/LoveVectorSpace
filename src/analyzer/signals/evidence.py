from dataclasses import dataclass
from typing import Literal

Evidence = Literal["moderate", "heuristic", "descriptive"]
Status = Literal["ok", "insufficient_data"]

MIN_MESSAGES = 20
ROLES = ("me", "them")


@dataclass
class Metric:
    id: str
    value: float | None
    per_speaker: dict[str, float] | None
    evidence: Evidence
    status: Status
    note: str


def insufficient(mid: str, evidence: Evidence, note: str) -> Metric:
    return Metric(mid, None, None, evidence, "insufficient_data", note)


def gate(msgs) -> str | None:
    """Reason string if the chat is too thin for any metric, else None."""
    if len(msgs) < MIN_MESSAGES:
        return f"fewer than {MIN_MESSAGES} messages"
    if {m.role for m in msgs} < set(ROLES):
        return "only one speaker present"
    return None


def skipped_note(n: int) -> str:
    return f"skipped {n} approx-timestamp messages" if n else ""
