"""People, sources, imports, analysis, questionnaires, context, next steps (all per-user via the facade)."""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from analyzer.accounts.service import Principal
from analyzer.service.facade import InvalidInput

from ..deps import app_principal, with_service
from ..errors import ApiError

router = APIRouter(prefix="/api")
Mode = Literal["potential", "established"]


def _call(request: Request, p: Principal, fn):
    return with_service(request, p, fn)


# ---------------- people ----------------

class PersonCreate(BaseModel):
    pseudonym: str = Field(min_length=1, max_length=80)
    mode: Mode
    timezone: str | None = Field(default=None, max_length=64)


class PersonPatch(BaseModel):
    pseudonym: str | None = Field(default=None, min_length=1, max_length=80)
    mode: Mode | None = None
    timezone: str | None = Field(default=None, max_length=64)


@router.get("/people")
def list_people(request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.list_people())


@router.post("/people", status_code=201)
def create_person(body: PersonCreate, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.create_person(body.pseudonym, body.mode, body.timezone))


@router.get("/people/{pid}")
def get_person(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.get_person(pid))


@router.patch("/people/{pid}")
def update_person(pid: int, body: PersonPatch, request: Request, p: Principal = Depends(app_principal)):
    fields = body.model_dump(exclude_unset=True)
    return _call(request, p, lambda s: s.update_person(pid, **fields))


@router.delete("/people/{pid}", status_code=204)
def delete_person(pid: int, request: Request, p: Principal = Depends(app_principal)):
    _call(request, p, lambda s: s.delete_person(pid))
    return Response(status_code=204)


# ---------------- imports ----------------

def _read_upload(request: Request, upload: UploadFile) -> bytes:
    limit = request.app.state.settings.max_import_bytes
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "too_large", f"Files over {limit // (1024 * 1024)} MB are not accepted.")
    return data


@router.post("/people/{pid}/imports", status_code=201)
def import_file(pid: int, request: Request, file: UploadFile = File(...), tz: str = Form(..., max_length=64),
                me_names: list[str] = Form(default=[]), match_id: str | None = Form(default=None, max_length=256),
                source: str | None = Form(default=None), p: Principal = Depends(app_principal)):
    names = [n.strip() for n in me_names if n and n.strip()]
    raw = _read_upload(request, file)
    filename = file.filename or "upload"
    try:
        # the service knows the format: me_names is required for chat exports, match_id for dating exports
        return _call(request, p, lambda s: s.import_file(pid, filename, raw, tz, names, match_id=match_id or None))
    except InvalidInput as e:
        if e.field == "me_names":
            raise ApiError(422, "validation_error", str(e) or "Say which speaker names are you.", "me_names") from None
        raise


class ImportedMessage(BaseModel):
    ts_local: str | None = Field(default=None, max_length=64)
    ts_utc: str | None = Field(default=None, max_length=64)
    ts_precision: Literal["second", "minute", "approx"]
    role: Literal["me", "them"]
    text: str = Field(max_length=4000)

    @model_validator(mode="after")
    def _one_ts(self):
        if not (self.ts_local or self.ts_utc):
            raise ValueError("ts_local or ts_utc is required")
        return self


class MessagesImport(BaseModel):
    source: str = Field(min_length=1, max_length=64)
    tz: str = Field(min_length=1, max_length=64)
    messages: list[ImportedMessage] = Field(max_length=10_000)


@router.post("/people/{pid}/imports/messages", status_code=201)
def import_messages(pid: int, body: MessagesImport, request: Request, p: Principal = Depends(app_principal)):
    msgs = [m.model_dump(exclude_none=True) for m in body.messages]
    return _call(request, p, lambda s: s.import_messages(pid, body.source, body.tz, msgs))


@router.post("/people/{pid}/imports/preview")
def preview_import(pid: int, request: Request, file: UploadFile = File(...),
                   p: Principal = Depends(app_principal)):
    raw = _read_upload(request, file)
    filename = file.filename or "upload"

    def run(s):
        s.get_person(pid)          # 404 for unknown person
        return s.preview_import(filename, raw)
    return _call(request, p, run)


@router.get("/people/{pid}/units")
def list_units(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.list_units(pid))


@router.delete("/units/{unit_id}")
def delete_unit(unit_id: str, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.delete_unit(unit_id))


class SpeakerMapping(BaseModel):
    source: str = Field(max_length=64)
    speaker_raw: str = Field(max_length=200)
    role: Literal["me", "them"]


@router.get("/people/{pid}/speakers")
def get_speakers(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.get_speakers(pid))


@router.put("/people/{pid}/speakers")
def set_speakers(pid: int, body: list[SpeakerMapping], request: Request, p: Principal = Depends(app_principal)):
    mappings = [m.model_dump() for m in body]
    return _call(request, p, lambda s: s.set_speakers(pid, mappings))


@router.get("/people/{pid}/coverage")
def coverage(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.coverage(pid))


# ---------------- analysis ----------------

@router.get("/people/{pid}/overview")
def overview(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.overview(pid))


@router.post("/people/{pid}/analyze", status_code=202)
def analyze(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return {"job_id": _call(request, p, lambda s: s.start_analysis(pid))}


@router.get("/jobs/{job_id}")
def job(job_id: int, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.job(job_id))


@router.get("/people/{pid}/history/{metric_id}")
def history(pid: int, metric_id: str, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.history(pid, metric_id))


@router.get("/metrics/{metric_id}/explain")
def explain(metric_id: str, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.explain_metric(metric_id))


# ---------------- questionnaires ----------------

class AnswersIn(BaseModel):
    answers: dict[str, int]


@router.get("/scales")
def scales(request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.list_scales())


@router.post("/people/{pid}/questionnaires/{scale_id}")
def submit_questionnaire(pid: int, scale_id: str, body: AnswersIn, request: Request,
                         p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.submit_questionnaire(pid, scale_id, body.answers))


@router.get("/people/{pid}/questionnaires")
def questionnaires(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.questionnaire_history(pid))


# ---------------- context ----------------

Confidence = Literal["owner_sure", "owner_unsure"]


class FactIn(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=2000)
    confidence: Confidence


class FactPatch(BaseModel):
    value: str | None = Field(default=None, min_length=1, max_length=2000)
    confidence: Confidence | None = None


@router.get("/people/{pid}/facts")
def list_facts(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.list_facts(pid))


@router.post("/people/{pid}/facts", status_code=201)
def add_fact(pid: int, body: FactIn, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.add_fact(pid, body.key, body.value, body.confidence))


@router.patch("/facts/{fact_id}")
def update_fact(fact_id: int, body: FactPatch, request: Request, p: Principal = Depends(app_principal)):
    fields = body.model_dump(exclude_unset=True)
    return _call(request, p, lambda s: s.update_fact(fact_id, **fields))


@router.delete("/facts/{fact_id}", status_code=204)
def delete_fact(fact_id: int, request: Request, p: Principal = Depends(app_principal)):
    _call(request, p, lambda s: s.delete_fact(fact_id))
    return Response(status_code=204)


def _bounded_fields(v: dict[str, Any] | None) -> dict[str, Any] | None:
    if v is not None and (len(v) > 40 or len(json.dumps(v, default=str)) > 10_000):
        raise ValueError("interaction fields are too large")
    return v


class InteractionIn(BaseModel):
    fields: dict[str, Any]
    notes: str = Field(default="", max_length=5000)

    @field_validator("fields")
    @classmethod
    def _check(cls, v):
        return _bounded_fields(v)


class InteractionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")   # whitelist: only these keys reach the service
    fields: dict[str, Any] | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("fields")
    @classmethod
    def _check(cls, v):
        return _bounded_fields(v)


@router.get("/people/{pid}/interactions")
def list_interactions(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.list_interactions(pid))


@router.post("/people/{pid}/interactions", status_code=201)
def add_interaction(pid: int, body: InteractionIn, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.add_interaction(pid, body.fields, body.notes))


@router.patch("/interactions/{interaction_id}")
def update_interaction(interaction_id: int, body: InteractionPatch, request: Request,
                       p: Principal = Depends(app_principal)):
    fields = body.model_dump(exclude_unset=True)
    return _call(request, p, lambda s: s.update_interaction(interaction_id, **fields))


@router.delete("/interactions/{interaction_id}", status_code=204)
def delete_interaction(interaction_id: int, request: Request, p: Principal = Depends(app_principal)):
    _call(request, p, lambda s: s.delete_interaction(interaction_id))
    return Response(status_code=204)


# ---------------- next steps ----------------

class StepPatch(BaseModel):
    status: Literal["open", "done", "dismissed"]


@router.get("/people/{pid}/next-steps")
def list_next_steps(pid: int, request: Request, status: Literal["open", "done", "dismissed"] | None = None,
                    p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.list_next_steps(pid, status))


@router.post("/people/{pid}/next-steps/generate", status_code=202)
def generate_next_steps(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return {"job_id": _call(request, p, lambda s: s.generate_next_steps(pid))}


@router.patch("/next-steps/{step_id}")
def set_step(step_id: int, body: StepPatch, request: Request, p: Principal = Depends(app_principal)):
    return _call(request, p, lambda s: s.set_next_step_status(step_id, body.status))
