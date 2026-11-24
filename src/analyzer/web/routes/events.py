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
SESSION_ENDED = 'event: end\ndata: {"type":"session_ended"}\n\n'


def _token(request: Request) -> str | None:
    scheme, _, tok = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and tok.strip():
        return tok.strip()
    return request.query_params.get("access_token") or None   # EventSource cannot set headers; this route only


async def event_stream(request: Request, bus, user_id: str, heartbeat: float, still_valid=None,
                       check_every: float = 15.0):
    """Yields the user's events. `still_valid()` (sync) is re-checked every `check_every` seconds and the
    stream ends after logout, session revocation or account deletion."""
    sub = bus.subscribe(user_id)   # inside the generator, so a client that never starts reading leaks nothing
    loop = asyncio.get_running_loop()
    next_check = loop.time() + check_every
    try:
        yield ": connected\n\n"
        while True:
            if await request.is_disconnected():
                break
            if still_valid is not None and loop.time() >= next_check:
                next_check = loop.time() + check_every
                if not await run_in_threadpool(still_valid):
                    yield SESSION_ENDED
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
    acc = accounts(request)
    p = await run_in_threadpool(acc.authenticate_access, token)
    request.state.user_id = p.user.id
    settings = request.app.state.settings
    uid, sid = p.user.id, p.sid
    stream = event_stream(request, request.app.state.events, uid,
                          heartbeat=min(settings.sse_heartbeat_s, settings.sse_session_check_s),
                          still_valid=lambda: acc.session_valid(uid, sid),
                          check_every=settings.sse_session_check_s)
    return StreamingResponse(stream, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
