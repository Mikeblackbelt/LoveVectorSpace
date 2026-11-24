"""Extension routes: /api/ext/* and /api/ingest (extension, api or session tokens)."""
from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Body, Depends, Request, Response
from pydantic import BaseModel, Field, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool

from analyzer.accounts.service import Principal

from ..deps import any_principal, with_service
from ..errors import ApiError

router = APIRouter(prefix="/api")
Platform = Literal["whatsapp", "discord", "instagram", "tinder", "grindr", "bumble"]


class LinkIn(BaseModel):
    person_id: int
    platform: Platform
    chat_key: str = Field(min_length=1, max_length=512)


class UnlinkIn(BaseModel):
    platform: Platform
    chat_key: str = Field(min_length=1, max_length=512)


class CaptureMessage(BaseModel):
    platform_msg_id: str | None = Field(default=None, max_length=256)
    ts_local: str | None = Field(default=None, max_length=64)
    ts_utc: str | None = Field(default=None, max_length=64)
    ts_precision: Literal["second", "minute", "approx"]
    direction: Literal["outgoing", "incoming"]
    speaker_raw: str = Field(max_length=200)
    text: str

    @model_validator(mode="after")
    def _one_ts(self):
        if not (self.ts_local or self.ts_utc):
            raise ValueError("ts_local or ts_utc is required")
        return self


class CaptureBatch(BaseModel):
    platform: Platform
    chat_key: str = Field(min_length=1, max_length=512)
    tz: str = Field(min_length=1, max_length=64)
    unit_id: str | None = Field(default=None, max_length=600)
    direction_uncertain: bool | None = None
    messages: list[CaptureMessage]


@router.get("/ext/people")
def ext_people(request: Request, p: Principal = Depends(any_principal)):
    return with_service(request, p, lambda s: s.ext_people())


@router.post("/ext/link", status_code=204)
def ext_link(body: LinkIn, request: Request, p: Principal = Depends(any_principal)):
    with_service(request, p, lambda s: s.ext_link(body.person_id, body.platform, body.chat_key))
    return Response(status_code=204)


@router.delete("/ext/link", status_code=204)
def ext_unlink(request: Request, body: UnlinkIn = Body(...), p: Principal = Depends(any_principal)):
    with_service(request, p, lambda s: s.ext_unlink(body.platform, body.chat_key))
    return Response(status_code=204)


@router.get("/ext/summary")
def ext_summary(platform: Platform, chat_key: str, request: Request, p: Principal = Depends(any_principal)):
    return with_service(request, p, lambda s: s.ext_summary(platform, chat_key))


@router.post("/ingest")
async def ingest(request: Request, p: Principal = Depends(any_principal)):
    settings = request.app.state.settings
    limit = settings.max_ingest_bytes
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise ApiError(413, "too_large", "Capture batches are limited to 2 MB.")
        chunks.append(chunk)
    try:
        batch = CaptureBatch.model_validate(json.loads(b"".join(chunks) or b"null"))
    except (ValueError, ValidationError) as e:
        field = None
        if isinstance(e, ValidationError) and e.errors():
            field = ".".join(str(x) for x in e.errors()[0]["loc"]) or None
        raise ApiError(422, "validation_error", "Invalid capture batch.", field) from None
    limiter = request.app.state.ingest_limiter
    wait = limiter.retry_after(p.user.id, cost=len(batch.messages))
    if wait:
        raise ApiError(429, "rate_limited", "Too many captured messages; slow down.",
                       headers={"Retry-After": str(wait)})
    limiter.hit(p.user.id, len(batch.messages))
    payload = batch.model_dump(exclude_none=True)
    return await run_in_threadpool(with_service, request, p, lambda s: s.ingest_capture(payload))

