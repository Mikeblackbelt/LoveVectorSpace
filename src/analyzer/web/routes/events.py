"""GET /api/events: per-user live events over SSE (access JWT in header or ?access_token=)."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from ..deps import accounts
from ..errors import ApiError

router = APIRouter(prefix="/api")


def _token(request: Request) -> str | None:
    scheme, _, tok = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and tok.strip():
        return tok.strip()
    return request.query_params.get("access_token") or None   # EventSource cannot set headers; this route only


async def event_stream(request: Request, bus, user_id: str, heartbeat: float):
    sub = bus.subscribe(user_id)   # inside the generator, so a client that never starts reading leaks nothing
    try:
        yield ": connected\n\n"
        while True:
            if await request.is_disconnected():
                break
            try:
                ev = await asyncio.wait_for(sub.queue.get(), timeout=heartbeat)
            except TimeoutError:
                yield ": ping\n\n"
                continue
            ev.pop("user_id", None)
            yield "data: " + json.dumps(ev, ensure_ascii=False, separators=(",", ":")) + "\n\n"
    finally:
        bus.unsubscribe(sub)


@router.get("/events")
async def events(request: Request):
    token = _token(request)
    if not token or token.startswith(("lvsa_", "lvse_")):
        raise ApiError(401, "unauthenticated", "Not signed in.")
    p = await run_in_threadpool(accounts(request).authenticate_access, token)
    request.state.user_id = p.user.id
    bus = request.app.state.events
    return StreamingResponse(event_stream(request, bus, p.user.id, request.app.state.settings.sse_heartbeat_s),
                             media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
