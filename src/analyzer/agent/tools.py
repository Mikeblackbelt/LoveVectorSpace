"""Tool registry for the agent (v2 5.2 + 5.5). Handlers take a dict and return a JSON-able dict."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from analyzer.service.facade import InvalidInput

STEP_KINDS = ("talk", "plan", "reflect", "pause")
READ_TOOLS = {"get_person_overview", "get_history", "search_messages", "explain_metric",
              "list_next_steps", "get_context", "list_interactions", "get_interview_progress"}
BACKGROUND_TOOLS = READ_TOOLS | {"propose_next_step"}


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict
    handler: Callable[[dict], dict]
    write: bool = False
    needs_text: bool = False

    def schema(self) -> dict:
        return {"type": "function", "function": {"name": self.name, "description": self.description,
                                                 "parameters": self.parameters}}


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


def build_registry(svc, settings: dict, person_id: int | None = None, thread_kind: str = "chat",
                   background: bool = False) -> list[ToolSpec]:
    """`person_id` binds the registry to one person (the agent cannot cross people)."""
    from .next_steps import propose

    def pid_of(a: dict) -> int:
        pid = person_id if person_id is not None else a.get("person_id")
        if not isinstance(pid, int):
            raise InvalidInput("person_id required", "person_id")
        svc.get_person(pid)
        return pid

    def pprop(props: dict, required=None):
        if person_id is None:
            props = {"person_id": {"type": "integer"}, **props}
            required = ["person_id", *(required or [])]
        return _obj(props, required)

    reads_text = bool(settings.get("agent_reads_text", True))

    def safety_for_model(block: dict) -> dict:
        """No message text reaches the model when the owner turned that off: drop every excerpt."""
        if reads_text:
            return block
        return {**block, "flags": [{k: v for k, v in f.items() if k != "snippets"} for f in block["flags"]]}

    def overview(a):
        o = svc.overview(pid_of(a))
        return {"person": o["person"], "mode": o["mode"], "generated_at": o["generated_at"],
                "success": o["success"], "safety": safety_for_model(o["safety"]), "reciprocity": o["reciprocity"],
                "metrics": [m for m in o["metrics"] if m["status"] == "ok"],
                "interaction_metrics": o["interaction_metrics"], "scales": o["scales"],
                "coverage_ratio": o["coverage_ratio"], "next_steps": o["next_steps"]}

    def history(a):
        return {"series": svc.history(pid_of(a), str(a.get("metric", "")))}

    def search(a):
        q = str(a.get("query", "")).strip()
        if not q:
            raise InvalidInput("query required", "query")
        return {"matches": svc.search_messages(pid_of(a), q, max(1, min(int(a.get("limit", 20) or 20), 50)))}

    def explain(a):
        return svc.explain_metric(str(a.get("metric_id", "")))

    def list_steps(a):
        return {"next_steps": svc.list_next_steps(pid_of(a), a.get("status"))}

    def propose_tool(a):
        return propose(svc, pid_of(a), a)

    def update_step(a):
        try:
            sid = int(a.get("id", 0))
        except (TypeError, ValueError) as e:
            raise InvalidInput("id must be an integer", "id") from e
        if person_id is not None and sid not in {s["id"] for s in svc.list_next_steps(person_id)}:
            raise InvalidInput("no such next step for this person", "id")
        return svc.set_next_step_status(sid, str(a.get("status", "")))

    def get_context(a):
        pid = pid_of(a)
        return {"facts": svc.list_facts(pid), "recent_interactions": svc.list_interactions(pid)[-5:],
                "note": "facts with confidence owner_unsure carry less weight"}

    def save_fact(a):
        key = str(a.get("key", "")).strip()
        if key.startswith("safety."):
            raise InvalidInput("safety facts are not collected by the agent", "key")
        source = {"interview": "interview", "checkin": "checkin"}.get(thread_kind, "owner_edit")
        return svc.add_fact(pid_of(a), key, str(a.get("value", "")),
                            a.get("confidence", "owner_sure"), source=source)

    def log_inter(a):
        return svc.add_interaction(pid_of(a), a.get("fields") or {}, str(a.get("notes", "")))

    def list_inter(a):
        return {"interactions": svc.list_interactions(pid_of(a), a.get("since"))}

    def progress(a):
        return svc.interview_progress(pid_of(a))

    metric_prop = {"metric": {"type": "string", "description": "metric id, e.g. message_share"}}
    rating = {"type": "integer", "minimum": 1, "maximum": 7}
    who = {"type": "string", "enum": ["me", "them", "mutual"]}
    interaction_fields = {
        "type": "object",
        "description": "One in-person hangout. Ask, never guess; leave out what the owner did not say.",
        "properties": {
            "ts": {"type": "string", "description": "ISO-8601 start time, e.g. 2026-11-20T19:00:00Z"},
            "place": {"type": "string"}, "duration_min": {"type": "integer", "minimum": 0},
            "initiated_by": who, "activity": {"type": "string"},
            "closeness_1_7": {**rating, "description": "how close the owner felt, 1-7"},
            "comfort_1_7": {**rating, "description": "how comfortable the owner felt, 1-7"},
            "responsiveness": {"type": "array", "items": {"type": "string"},
                               "description": "concrete signs they listened or responded"},
            "tension": {"type": "string"}, "affection": {"type": "string"},
            "next_plan_proposed_by": {"type": "string", "enum": ["me", "them", "none"]},
            "followed_through_prev": {"type": "boolean", "description": "did the last agreed plan happen"},
        },
        "required": ["ts", "initiated_by", "closeness_1_7", "comfort_1_7"],
    }
    specs = [
        ToolSpec("get_person_overview", "Latest overview: mode, headline estimate (with its tag), safety "
                 "block, reciprocity and other metrics with evidence tags, scales.", pprop({}), overview),
        ToolSpec("get_history", "Time series of one metric across analyses.", pprop(metric_prop, ["metric"]),
                 history),
        ToolSpec("search_messages", "Find message excerpts containing text (the owner allows message text "
                 "to reach you).", pprop({"query": {"type": "string"}, "limit": {"type": "integer"}},
                                         ["query"]), search, needs_text=True),
        ToolSpec("explain_metric", "What a metric measures, its evidence, caveats and citation.",
                 _obj({"metric_id": {"type": "string"}}, ["metric_id"]), explain),
        ToolSpec("list_next_steps", "Next-step cards, optionally filtered by status.",
                 pprop({"status": {"type": "string", "enum": ["open", "done", "dismissed"]}}), list_steps),
        ToolSpec("propose_next_step", "Propose a next-step card. kind is talk, plan, reflect or pause.",
                 pprop({"title": {"type": "string"}, "why": {"type": "string"},
                        "evidence_refs": {"type": "array", "items": {"type": "string"}},
                        "kind": {"type": "string", "enum": list(STEP_KINDS)}},
                       ["title", "why", "evidence_refs", "kind"]), propose_tool, write=True),
        ToolSpec("update_next_step", "Mark a card open, done or dismissed.",
                 _obj({"id": {"type": "integer"}, "status": {"type": "string",
                                                              "enum": ["open", "done", "dismissed"]}},
                      ["id", "status"]), update_step, write=True),
        ToolSpec("get_context", "All current context facts plus recent logged hangouts.", pprop({}),
                 get_context),
        ToolSpec("save_context_fact", "Record or update a context fact; key starts with an interview topic "
                 "id (e.g. met.how). Skipped topic: key '<topic>.skipped', value 'skipped'.",
                 pprop({"key": {"type": "string"}, "value": {"type": "string"},
                        "confidence": {"type": "string", "enum": ["owner_sure", "owner_unsure"]}},
                       ["key", "value"]), save_fact, write=True),
        ToolSpec("log_interaction", "Log an in-person hangout with structured fields.",
                 pprop({"fields": interaction_fields, "notes": {"type": "string"}}, ["fields"]),
                 log_inter, write=True),
        ToolSpec("list_interactions", "Logged hangouts, optionally since an ISO timestamp.",
                 pprop({"since": {"type": "string"}}), list_inter),
        ToolSpec("get_interview_progress", "Which intake topics are covered or open.", pprop({}), progress),
    ]
    if not reads_text:
        specs = [s for s in specs if not s.needs_text]
    if background:
        specs = [s for s in specs if s.name in BACKGROUND_TOOLS]
    return specs
