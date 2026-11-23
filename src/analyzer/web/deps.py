"""Request dependencies: principals, scopes, CSRF, cookies, per-user facade calls."""
from __future__ import annotations

import secrets
from collections.abc import Callable
from typing import Any, TypeVar

from fastapi import Depends, Request, Response

from analyzer.accounts.crypto import consteq
from analyzer.accounts.service import REFRESH_DAYS, AccountService, Principal, Tokens
from analyzer.accounts.repos import UserRow

from .errors import ApiError

RT_COOKIE = "lvs_rt"
CSRF_COOKIE = "lvs_csrf"
RT_PATH = "/api/auth"
T = TypeVar("T")


def accounts(request: Request) -> AccountService:
    return request.app.state.accounts


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def device_label(request: Request) -> str:
    client = "native" if is_native(request) else "web"
    ua = (request.headers.get("user-agent") or "unknown")[:120]
    return f"{client}: {ua}"


def is_native(request: Request) -> bool:
    return request.headers.get("x-client", "").lower() == "native"


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() == "bearer" and token.strip():
        return token.strip()
    return None


def _unauth() -> ApiError:
    return ApiError(401, "unauthenticated", "Not signed in.")


def any_principal(request: Request) -> Principal:
    cached = getattr(request.state, "principal", None)
    if cached is not None:
        return cached
    token = _bearer(request)
    if not token:
        raise _unauth()
    p = accounts(request).authenticate_bearer(token)
    request.state.principal = p
    request.state.user_id = p.user.id
    return p


def app_principal(p: Principal = Depends(any_principal)) -> Principal:
    """Session JWT or api token; extension tokens are limited to /api/ingest and /api/ext/*."""
    if p.kind == "extension":
        raise ApiError(403, "forbidden", "Extension tokens can only use the extension routes.")
    return p


def session_principal(p: Principal = Depends(any_principal)) -> Principal:
    if p.kind != "session":
        raise ApiError(403, "forbidden", "This route needs a signed-in session.")
    return p


def admin_principal(p: Principal = Depends(app_principal)) -> Principal:
    if p.user.role != "admin":
        raise ApiError(403, "forbidden", "Admins only.")
    return p


def require_csrf(request: Request) -> None:
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get("x-csrf-token", "")
    if not cookie or not header or not consteq(cookie, header):
        raise ApiError(403, "forbidden", "Missing or invalid CSRF token.")


def set_session_cookies(request: Request, response: Response, refresh: str) -> None:
    secure = request.app.state.settings.cookie_secure
    response.set_cookie(RT_COOKIE, refresh, max_age=REFRESH_DAYS * 86400, path=RT_PATH, httponly=True,
                        secure=secure, samesite="lax")
    response.set_cookie(CSRF_COOKIE, secrets.token_urlsafe(24), max_age=REFRESH_DAYS * 86400, path="/",
                        httponly=False, secure=secure, samesite="lax")


def clear_session_cookies(request: Request, response: Response) -> None:
    secure = request.app.state.settings.cookie_secure
    response.delete_cookie(RT_COOKIE, path=RT_PATH, httponly=True, secure=secure, samesite="lax")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=secure, samesite="lax")


def auth_result(request: Request, response: Response, user: UserRow, tokens: Tokens) -> dict[str, Any]:
    out: dict[str, Any] = {"access_token": tokens.access, "expires_in": 900, "user": user.public()}
    if is_native(request):
        out["refresh_token"] = tokens.refresh
    else:
        set_session_cookies(request, response, tokens.refresh)
    return out


def with_service(request: Request, p: Principal, fn: Callable[[Any], T]) -> T:
    """Run fn(user_service) holding the user's connection pinned and locked. Call from sync routes only."""
    mgr = accounts(request).userdbs
    with mgr.use(p.user.id) as h, h.lock:
        return fn(h.service)
