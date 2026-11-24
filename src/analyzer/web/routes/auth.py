"""/api/auth/*"""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from analyzer.accounts.crypto import consteq
from analyzer.accounts.service import AccountError, Principal

from ..deps import (RT_COOKIE, accounts, app_principal, session_principal, auth_result, clear_session_cookies,
                    client_ip, device_label, is_native, require_csrf, set_session_cookies)

router = APIRouter(prefix="/api/auth")


class SignupIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)
    invite_code: str | None = Field(default=None, max_length=128)
    display_name: str | None = Field(default=None, max_length=80)


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class RefreshIn(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=256)


class TokenIn(BaseModel):
    token: str = Field(max_length=256)


class EmailIn(BaseModel):
    email: str = Field(max_length=254)


class ResetIn(BaseModel):
    token: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class ChangeIn(BaseModel):
    current_password: str | None = Field(default=None, max_length=256)
    new_password: str = Field(max_length=256)


class SocialIn(BaseModel):
    id_token: str = Field(max_length=8192)
    invite_code: str | None = Field(default=None, max_length=128)
    name: str | None = Field(default=None, max_length=80)
    nonce: str | None = Field(default=None, max_length=256)


@router.post("/signup", status_code=201)
def signup(body: SignupIn, request: Request, response: Response):
    user, tokens = accounts(request).signup(body.email, body.password, body.invite_code, body.display_name,
                                            client_ip(request), device_label(request))
    return auth_result(request, response, user, tokens)


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response):
    user, tokens = accounts(request).login(body.email, body.password, client_ip(request), device_label(request))
    return auth_result(request, response, user, tokens)


@router.post("/refresh")
def refresh(request: Request, response: Response, body: RefreshIn | None = Body(default=None)):
    if is_native(request):
        raw = body.refresh_token if body else None
    else:
        raw = request.cookies.get(RT_COOKIE)
        if raw:
            require_csrf(request)   # cookie-authenticated write
    try:
        user, tokens = accounts(request).refresh(raw, device_label(request))
    except AccountError:
        if not is_native(request):
            # make the client drop the dead cookie
            r = Response(status_code=401, media_type="application/json",
                         content=b'{"error":{"code":"unauthenticated","message":"Not signed in."}}')
            clear_session_cookies(request, r)
            return r
        raise
    return auth_result(request, response, user, tokens)


@router.post("/logout", status_code=204)
def logout(request: Request, p: Principal = Depends(app_principal), body: RefreshIn | None = Body(default=None)):
    raw = (body.refresh_token if body else None) if is_native(request) else request.cookies.get(RT_COOKIE)
    accounts(request).logout(p, raw)
    r = Response(status_code=204)
    clear_session_cookies(request, r)
    return r


@router.get("/me")
def me(p: Principal = Depends(app_principal)):
    return p.user.public()


@router.post("/verify-email", status_code=204)
def verify_email(body: TokenIn, request: Request):
    accounts(request).verify_email(body.token)
    return Response(status_code=204)


@router.post("/verify-email/resend", status_code=204)
def resend(request: Request, p: Principal = Depends(app_principal)):
    accounts(request).resend_verification(p.user)
    return Response(status_code=204)


@router.post("/password/forgot", status_code=204)
def forgot(body: EmailIn, request: Request):
    accounts(request).forgot_password(body.email, client_ip(request))
    return Response(status_code=204)


@router.post("/password/reset", status_code=204)
def reset(body: ResetIn, request: Request):
    accounts(request).reset_password(body.token, body.new_password)
    return Response(status_code=204)


@router.post("/password/change", status_code=204)
def change(body: ChangeIn, request: Request, p: Principal = Depends(session_principal)):
    accounts(request).change_password(p, body.current_password, body.new_password)
    return Response(status_code=204)


# ---- Google ----

OAUTH_COOKIE = "lvs_oauth"


def _safe_redirect(path: str | None) -> str:
    if (not path or not path.startswith("/") or path.startswith("//") or "\\" in path
            or any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in path) or len(path) > 512):
        return "/people"
    return path


@router.get("/google/start")
def google_start(request: Request, redirect: str | None = None, invite: str | None = None):
    url, state = accounts(request).google_start(_safe_redirect(redirect), invite)
    r = RedirectResponse(url, status_code=302)
    r.set_cookie(OAUTH_COOKIE, state, max_age=600, path="/api/auth/google", httponly=True,
                 secure=request.app.state.settings.cookie_secure, samesite="lax")
    return r


@router.get("/google/callback")
def google_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    origin = request.app.state.settings.app_origin.rstrip("/")
    cookie_state = request.cookies.get(OAUTH_COOKIE, "")
    try:
        if error or not state or not cookie_state or not consteq(state, cookie_state):
            raise AccountError(400, "invalid_state", "Sign-in expired. Try again.")
        user, tokens, redirect = accounts(request).google_callback(code or "", state, client_ip(request),
                                                                   device_label(request))
    except AccountError as e:
        r = RedirectResponse(f"{origin}/auth/complete#error={quote(e.code)}", status_code=302)
        r.delete_cookie(OAUTH_COOKIE, path="/api/auth/google")
        return r
    r = RedirectResponse(f"{origin}/auth/complete?redirect={quote(redirect, safe='')}#ok", status_code=302)
    set_session_cookies(request, r, tokens.refresh)
    r.delete_cookie(OAUTH_COOKIE, path="/api/auth/google")
    return r


@router.post("/google/token")
def google_token(body: SocialIn, request: Request, response: Response):
    acc = accounts(request)
    ident = acc.verify_google(body.id_token, body.nonce)
    user, tokens = acc.social_login(ident, body.invite_code, None, client_ip(request), device_label(request))
    return auth_result(request, response, user, tokens)


@router.post("/apple/token")
def apple_token(body: SocialIn, request: Request, response: Response):
    acc = accounts(request)
    ident = acc.verify_apple(body.id_token, body.nonce)
    user, tokens = acc.social_login(ident, body.invite_code, body.name, client_ip(request), device_label(request))
    return auth_result(request, response, user, tokens)


# ---- sessions ----

@router.get("/sessions")
def sessions(request: Request, p: Principal = Depends(session_principal)):
    return accounts(request).sessions(p)


@router.delete("/sessions/{sid}", status_code=204)
def revoke_session(sid: str, request: Request, p: Principal = Depends(session_principal)):
    accounts(request).revoke_session(p, sid)
    return Response(status_code=204)

