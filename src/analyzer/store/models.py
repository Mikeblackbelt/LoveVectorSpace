from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Role = Literal["me", "them"]
Mode = Literal["potential", "established"]
FactSource = Literal["interview", "checkin", "owner_edit"]
Confidence = Literal["owner_sure", "owner_unsure"]
AgentRole = Literal["user", "assistant", "tool", "system"]
StepStatus = Literal["open", "done", "dismissed"]
JobStatus = Literal["queued", "running", "done", "error"]
TokenKind = Literal["api", "extension"]


class Person(BaseModel):
    id: int
    pseudonym: str
    mode: Mode
    timezone: str
    created_at: datetime


class SpeakerMapping(BaseModel):
    person_id: int
    source: str
    speaker_raw: str
    role: Role


class ChatLink(BaseModel):
    person_id: int
    platform: str
    chat_key: str


class TokenInfo(BaseModel):
    id: int
    kind: TokenKind
    created_at: datetime
    revoked_at: Optional[datetime] = None


class Fact(BaseModel):
    id: int
    person_id: int
    key: str
    value: str
    source: FactSource
    confidence: Confidence
    updated_at: datetime


class InteractionFields(BaseModel):
    ts: datetime
    place: Optional[str] = None
    duration_min: Optional[int] = None
    initiated_by: Literal["me", "them", "mutual"]
    activity: Optional[str] = None
    closeness_1_7: int = Field(ge=1, le=7)
    comfort_1_7: int = Field(ge=1, le=7)
    responsiveness: list[str] = Field(default_factory=list)
    tension: Optional[str] = None
    affection: Optional[str] = None
    next_plan_proposed_by: Literal["me", "them", "none"] = "none"
    followed_through_prev: Optional[bool] = None


class Interaction(BaseModel):
    id: int
    person_id: int
    fields: InteractionFields
    notes: str


class AgentMessage(BaseModel):
    id: int
    thread_id: int
    role: AgentRole
    content: str
    tool_calls: Optional[list[dict[str, Any]]] = None
    created_at: datetime


class AgentThread(BaseModel):
    id: int
    person_id: int
    kind: str
    created_at: datetime
    messages: list[AgentMessage] = Field(default_factory=list)


class NextStep(BaseModel):
    id: int
    person_id: int
    kind: str
    title: str
    why: str
    evidence_refs: list[str]
    status: StepStatus
    created_at: datetime


class Job(BaseModel):
    id: int
    person_id: Optional[int]
    kind: str
    status: JobStatus
    error: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None


class Snapshot(BaseModel):
    id: int
    person_id: int
    created_at: datetime
    data: Any
