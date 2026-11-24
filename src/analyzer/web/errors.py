"""Uniform error envelope: {"error": {"code", "message", "field"?}}."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from analyzer.accounts.service import AccountError
from analyzer.accounts.userdb import UserGone
from analyzer.service.facade import AgentUnavailable, ChatNotLinked, InvalidInput, NotFound

try:   # the service layer's "service/factory closed" signal (eviction, deletion or shutdown in progress)
    from analyzer.service.impl import ServiceClosed
except ImportError:  # pragma: no cover - service layer absent
    class ServiceClosed(RuntimeError):
        pass

log = logging.getLogger("analyzer.web")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, field: str | None = None,
                 headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.field, self.headers = status, code, message, field, headers


def error_response(status: int, code: str, message: str, field: str | None = None,
                   headers: dict[str, str] | None = None) -> JSONResponse:
    body = {"code": code, "message": message}
    if field:
        body["field"] = field
    return JSONResponse({"error": body}, status_code=status, headers=headers)


_STATUS_CODES = {400: "invalid_input", 401: "unauthenticated", 403: "forbidden", 404: "not_found",
                 405: "method_not_allowed", 409: "conflict", 413: "too_large", 422: "validation_error",
                 429: "rate_limited", 503: "agent_unavailable"}


def map_exception(exc: Exception) -> ApiError | None:
    """Facade / account exceptions → ApiError (None if not a known client error)."""
    if isinstance(exc, ApiError):
        return exc
    if isinstance(exc, AccountError):
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        return ApiError(exc.status, exc.code, exc.message, exc.field, headers)
    if isinstance(exc, UserGone):
        return ApiError(401, "unauthenticated", "Not signed in.")
    if isinstance(exc, NotFound):
        return ApiError(404, "not_found", str(exc) or "Not found.")
    if isinstance(exc, InvalidInput):
        return ApiError(400, "invalid_input", str(exc) or "Invalid input.", exc.field)
    if isinstance(exc, ChatNotLinked):
        return ApiError(409, "chat_not_linked", "This chat is not linked to a person.")
    if isinstance(exc, AgentUnavailable):
        return ApiError(503, "agent_unavailable", "The agent is not available.")
    if isinstance(exc, ServiceClosed):
        return ApiError(503, "unavailable", "Temporarily unavailable; retry.", headers={"Retry-After": "1"})
    return None


def install_error_handlers(app: FastAPI) -> None:
    async def known(request: Request, exc: Exception):
        e = map_exception(exc)
        return error_response(e.status, e.code, e.message, e.field, e.headers)

    for cls in (ApiError, AccountError, NotFound, InvalidInput, ChatNotLinked, AgentUnavailable, ServiceClosed,
                UserGone):
        app.add_exception_handler(cls, known)

    @app.exception_handler(StarletteHTTPException)
    async def http_exc(request: Request, exc: StarletteHTTPException):
        code = _STATUS_CODES.get(exc.status_code, "error")
        msg = exc.detail if isinstance(exc.detail, str) else code
        return error_response(exc.status_code, code, msg, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation(request: Request, exc: RequestValidationError):
        errs = exc.errors()
        field = None
        message = "Invalid request."
        if errs:
            loc = [str(p) for p in errs[0].get("loc", ()) if p not in ("body", "query", "path", "header", "form")]
            field = ".".join(loc) or None
            message = errs[0].get("msg", message)
        return error_response(422, "validation_error", message, field)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.error("unhandled error on %s %s: %s", request.method, request.url.path, type(exc).__name__)
        return error_response(500, "internal_error", "Something went wrong.")
