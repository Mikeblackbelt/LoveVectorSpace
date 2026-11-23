"""Coordination contract between the backend streams (v3).

Stream "backend-core" IMPLEMENTS these protocols (service layer + Groq agent).
Stream "backend-api" CONSUMES them from FastAPI routes and serialises the returned
dicts as JSON exactly as documented in docs/api.md (the dict shapes below ARE the
api.md shapes). Neither stream may change a signature without updating this file
and docs/api.md together.

All methods are synchronous and scoped to ONE user: a `UserService` is built from
that user's already-opened SQLCipher connection (see `ServiceFactory.for_user`).
Datetimes in returned dicts are ISO-8601 UTC strings ending in "Z".
"""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any, Literal, Protocol

Json = dict[str, Any]
Mode = Literal["potential", "established"]
ThreadKind = Literal["chat", "interview", "checkin"]


class NotFound(Exception):
    """Raised for an unknown person/unit/fact/interaction/thread/job id (→ HTTP 404)."""


class InvalidInput(Exception):
    """Raised for bad input (→ HTTP 400/422). `field` names the offending field."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


class ChatNotLinked(Exception):
    """Raised by ingest_capture when (platform, chat_key) is not linked (→ HTTP 409 chat_not_linked)."""


class AgentUnavailable(Exception):
    """Raised by agent methods when no GROQ_API_KEY or the agent is disabled (→ HTTP 503)."""


class EventSink(Protocol):
    def publish(self, user_id: str, event: Json) -> None: ...


class UserService(Protocol):
    # --- people & sources ---
    def list_people(self) -> list[Json]: ...                       # [PersonSummary]
    def create_person(self, pseudonym: str, mode: Mode, timezone: str | None) -> Json: ...  # Person
    def get_person(self, pid: int) -> Json: ...                    # Person
    def update_person(self, pid: int, **fields: Any) -> Json: ...  # Person
    def delete_person(self, pid: int) -> None: ...
    def preview_import(self, filename: str, raw: bytes) -> Json: ...   # {format, speakers, lines, one_sided}
    def import_file(self, pid: int, filename: str, raw: bytes, tz: str, me_names: list[str]) -> Json: ...  # ImportResult
    def list_units(self, pid: int) -> list[Json]: ...              # [Unit]
    def delete_unit(self, unit_id: str) -> Json: ...               # {removed_messages}
    def get_speakers(self, pid: int) -> list[Json]: ...
    def set_speakers(self, pid: int, mappings: list[Json]) -> list[Json]: ...
    def coverage(self, pid: int) -> list[Json]: ...

    # --- analysis ---
    def overview(self, pid: int) -> Json: ...                      # PersonOverview (NotFound if no snapshot yet)
    def start_analysis(self, pid: int) -> int: ...                 # job id
    def job(self, job_id: int) -> Json: ...                        # Job
    def history(self, pid: int, metric_id: str) -> list[Json]: ... # [{ts, value}]
    def explain_metric(self, metric_id: str) -> Json: ...          # MetricInfo

    # --- questionnaires ---
    def list_scales(self) -> list[Json]: ...
    def submit_questionnaire(self, pid: int, scale_id: str, answers: dict[str, int]) -> Json: ...
    def questionnaire_history(self, pid: int) -> list[Json]: ...

    # --- context ---
    def list_facts(self, pid: int) -> list[Json]: ...
    def add_fact(self, pid: int, key: str, value: str, confidence: str) -> Json: ...
    def update_fact(self, fact_id: int, **fields: Any) -> Json: ...
    def delete_fact(self, fact_id: int) -> None: ...
    def list_interactions(self, pid: int) -> list[Json]: ...
    def add_interaction(self, pid: int, fields: Json, notes: str) -> Json: ...
    def update_interaction(self, interaction_id: int, **fields: Any) -> Json: ...
    def delete_interaction(self, interaction_id: int) -> None: ...

    # --- next steps ---
    def list_next_steps(self, pid: int, status: str | None = None) -> list[Json]: ...
    def generate_next_steps(self, pid: int) -> int: ...            # job id (on demand)
    def set_next_step_status(self, step_id: int, status: str) -> Json: ...

    # --- agent (raise AgentUnavailable when disabled) ---
    def list_threads(self, pid: int) -> list[Json]: ...
    def create_thread(self, pid: int, kind: ThreadKind) -> Json: ...
    def get_thread(self, tid: int) -> Json: ...                    # {thread, messages}
    def send_message(self, tid: int, text: str) -> Iterator[Json]: ...  # yields AgentEvent dicts
    def interview_progress(self, pid: int) -> Json: ...

    # --- settings (per-user, stored in the user's DB) ---
    def get_settings(self) -> Json: ...
    def update_settings(self, patch: Json) -> Json: ...

    # --- extension ---
    def ext_people(self) -> list[Json]: ...
    def ext_link(self, person_id: int, platform: str, chat_key: str) -> None: ...
    def ext_unlink(self, platform: str, chat_key: str) -> None: ...
    def ext_summary(self, platform: str, chat_key: str) -> Json: ...
    def ingest_capture(self, batch: Json) -> Json: ...             # {added, merged, skipped}; raises ChatNotLinked

    # --- account export (deletion of the DB file is done by the API layer) ---
    def export(self, include_messages: bool) -> Json: ...


class ServiceFactory(Protocol):
    def for_user(self, user_id: str, conn: Any, events: EventSink) -> UserService: ...
    def seed_demo(self, user_id: str, conn: Any) -> None: ...      # synthetic Yu Cheng / Sam / Jordan data
