"""Agent threads and streamed messages (SSE)."""
from __future__ import annotations

import json
import logging
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from analyzer.accounts.service import Principal

from ..deps import accounts, app_principal, with_service
from ..errors import map_exception

router = APIRouter(prefix="/api")
log = logging.getLogger("analyzer.web")


class ThreadIn(BaseModel):
    kind: Literal["chat", "interview", "checkin"]


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


@router.get("/people/{pid}/agent/threads")
def list_threads(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return with_service(request, p, lambda s: s.list_threads(pid))


@router.post("/people/{pid}/agent/threads", status_code=201)
def create_thread(pid: int, body: ThreadIn, request: Request, p: Principal = Depends(app_principal)):
    return with_service(request, p, lambda s: s.create_thread(pid, body.kind))


@router.get("/agent/threads/{tid}")
def get_thread(tid: int, request: Request, p: Principal = Depends(app_principal)):
    return with_service(request, p, lambda s: s.get_thread(tid))


@router.get("/people/{pid}/interview/progress")
def interview_progress(pid: int, request: Request, p: Principal = Depends(app_principal)):
    return with_service(request, p, lambda s: s.interview_progress(pid))


def sse_data(event: dict) -> str:
    return "data: " + json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n\n"


def _error_event(exc: Exception) -> dict:
    e = map_exception(exc)
    if e is None:
        log.error("agent stream failed: %s", type(exc).__name__)
        return {"type": "error", "code": "internal_error", "message": "The agent failed."}
    return {"type": "error", "code": e.code, "message": e.message}


@router.post("/agent/threads/{tid}/messages")
def send_message(tid: int, body: MessageIn, request: Request, p: Principal = Depends(app_principal)):
    mgr = accounts(request).userdbs
    h = mgr.acquire(p.user.id)
    try:
        with h.lock:
            it = iter(h.service.send_message(tid, body.text))
            first = next(it, None)    # surfaces AgentUnavailable / NotFound before the 200 is committed
    except BaseException:
        mgr.release(h)
        raise

    def stream():
        try:
            if first is not None:
                yield sse_data(first)
            while True:
                with h.lock:
                    try:
                        ev = next(it)
                    except StopIteration:
                        break
                    except Exception as exc:  # noqa: BLE001 - reported to the client as an event
                        ev = _error_event(exc)
                        yield sse_data(ev)
                        break
                yield sse_data(ev)
        finally:
            close = getattr(it, "close", None)
            if callable(close):
                with h.lock:
                    try:
                        close()
                    except Exception:
                        pass
            mgr.release(h)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
