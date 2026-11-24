"""Pure-ASGI middleware: path-scoped CORS, request-body limits, id/path-only request logging."""
from __future__ import annotations

import json
import logging
import re
import time
import uuid


log = logging.getLogger("analyzer.web.access")

ALLOW_HEADERS = "Authorization, Content-Type, X-CSRF-Token, X-Client"
ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
EXPOSE_HEADERS = "Retry-After, Content-Disposition, X-Request-ID"


def is_ext_path(path: str) -> bool:
    return path == "/api/ingest" or path.startswith("/api/ext/")


def _header(scope, name: bytes) -> str | None:
    for k, v in scope.get("headers", []):
        if k == name:
            return v.decode("latin-1")
    return None


async def _send_plain(send, status: int, body: bytes = b"", headers: list | None = None,
                      content_type: bytes = b"text/plain") -> None:
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", content_type), (b"content-length", str(len(body)).encode())]
                + (headers or [])})
    await send({"type": "http.response.body", "body": body})


class PathCORS:
    """App origins on /api/* (except extension routes); only chrome-extension://$EXTENSION_ID on those."""

    def __init__(self, app, app_origins: list[str], extension_id: str | None, bearer_only_origins=()):
        self.app = app
        self.app_origins = {o.rstrip("/") for o in app_origins if o}
        self.bearer_only = {o.rstrip("/") for o in bearer_only_origins}   # native apps: no credentials
        self.ext_origin = f"chrome-extension://{extension_id}" if extension_id else None

    def _allowed(self, path: str, origin: str) -> tuple[bool, bool]:
        """(allowed, with_credentials)"""
        if is_ext_path(path):
            return (self.ext_origin is not None and origin == self.ext_origin), False
        if path.startswith("/api/") or path == "/healthz":
            if origin in self.app_origins:
                return True, origin not in self.bearer_only
            return False, False
        return False, False

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        origin = _header(scope, b"origin")
        if not origin:
            return await self.app(scope, receive, send)
        ok, creds = self._allowed(scope["path"], origin)
        if scope["method"] == "OPTIONS" and _header(scope, b"access-control-request-method"):
            if not ok:
                return await _send_plain(send, 403, b"CORS origin not allowed", [(b"vary", b"Origin")])
            h = [(b"access-control-allow-origin", origin.encode()), (b"vary", b"Origin"),
                 (b"access-control-allow-methods", ALLOW_METHODS.encode()),
                 (b"access-control-allow-headers", ALLOW_HEADERS.encode()), (b"access-control-max-age", b"600")]
            if creds:
                h.append((b"access-control-allow-credentials", b"true"))
            return await _send_plain(send, 204, b"", h)
        if not ok:
            return await self.app(scope, receive, send)

        async def send_cors(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers += [(b"access-control-allow-origin", origin.encode()), (b"vary", b"Origin"),
                            (b"access-control-expose-headers", EXPOSE_HEADERS.encode())]
                if creds:
                    headers.append((b"access-control-allow-credentials", b"true"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_cors)


TOO_LARGE = json.dumps({"error": {"code": "too_large", "message": "Request body is too large."}}).encode()


class _Overrun(Exception):
    pass


class BodyLimit:
    """Rejects bodies over the per-path limit: early by Content-Length, otherwise while streaming.

    A streaming overrun aborts the body read and the response is replaced by 413 here, before FastAPI's own
    body parsing can turn the aborted read into a 400."""

    def __init__(self, app, import_limit: int, ingest_limit: int, messages_limit: int = 2 * 1024 * 1024,
                 default_limit: int = 1024 * 1024):
        self.app = app
        self.import_limit = import_limit + 1024 * 1024   # multipart overhead
        self.ingest_limit = ingest_limit
        self.messages_limit = messages_limit
        self.default_limit = default_limit

    def _limit(self, path: str) -> int:
        if path.startswith("/api/"):
            if path.endswith("/imports/messages"):
                return self.messages_limit
            if path.endswith(("/imports", "/imports/preview")):
                return self.import_limit
            if path == "/api/ingest":
                return self.ingest_limit
        return self.default_limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = self._limit(scope["path"])
        cl = _header(scope, b"content-length")
        if cl and cl.isdigit() and int(cl) > limit:
            return await _send_plain(send, 413, TOO_LARGE, content_type=b"application/json")
        seen = 0
        overrun = False
        replaced = False
        started = finished = False

        async def limited_receive():
            nonlocal seen, overrun
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    overrun = True
                    raise _Overrun()
            return message

        async def guarded_send(message):
            nonlocal replaced, started, finished
            if overrun:
                if message["type"] == "http.response.start" and not replaced and not started:
                    replaced = True
                    await _send_plain(send, 413, TOO_LARGE, content_type=b"application/json")
                return    # drop whatever the app tried to send after the overrun
            if message["type"] == "http.response.start":
                started = True
            elif message["type"] == "http.response.body" and not message.get("more_body", False):
                finished = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _Overrun:
            pass
        if overrun and not replaced:
            if not started:
                await _send_plain(send, 413, TOO_LARGE, content_type=b"application/json")
            elif not finished:   # a response was already under way: just end it, never send a second start
                await send({"type": "http.response.body", "body": b"", "more_body": False})


class RequestLog:
    """Logs method, path (never the query string), status, duration, request id and user id."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        rid = uuid.uuid4().hex[:12]
        scope.setdefault("state", {})
        start = time.perf_counter()
        status = 500
        started = False

        async def send_wrapped(message):
            nonlocal status, started
            if message["type"] == "http.response.start":
                status, started = message["status"], True
                message = {**message, "headers": list(message.get("headers", [])) + [(b"x-request-id", rid.encode())]}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapped)
        except Exception as exc:
            # contain it here: never let the server print a traceback whose message may carry user content
            log.error("rid=%s unhandled %s", rid, type(exc).__name__)
            if not started:
                body = json.dumps({"error": {"code": "internal_error", "message": "Something went wrong."}}).encode()
                await _send_plain(send_wrapped, 500, body, content_type=b"application/json")
        finally:
            state = scope.get("state") or {}
            uid = state.get("user_id") if isinstance(state, dict) else None
            log.info("rid=%s %s %s -> %s %.0fms user=%s", rid, scope["method"], log_path(scope), status,
                     (time.perf_counter() - start) * 1000, uid or "-")


_SENSITIVE = re.compile(r"^(/api/(?:invites|tokens|auth/sessions))/[^/]+")


def log_path(scope) -> str:
    """The route template when known (no ids, codes or keys); otherwise the path with secrets redacted."""
    route = scope.get("route")
    tmpl = getattr(route, "path", None)
    if isinstance(tmpl, str) and "{" in tmpl:
        return tmpl
    return _SENSITIVE.sub(r"\1/:redacted", scope["path"])


class RedactQueryFilter(logging.Filter):
    """Strips query strings from uvicorn access-log lines (the SSE route accepts ?access_token=)."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and "?" in args[2]:
            record.args = args[:2] + (args[2].split("?", 1)[0],) + args[3:]
        return True


def install_access_log_filter() -> None:
    lg = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactQueryFilter) for f in lg.filters):
        lg.addFilter(RedactQueryFilter())
