"""/api/settings, /api/tokens, /api/invites, /api/account"""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, Request, Response
from pydantic import BaseModel, Field

from analyzer.accounts.repos import now_iso
from analyzer.accounts.service import Principal

from ..deps import accounts, admin_principal, app_principal, clear_session_cookies, session_principal, with_service
from ..errors import ApiError

router = APIRouter(prefix="/api")


@router.get("/settings")
def get_settings(request: Request, p: Principal = Depends(app_principal)):
    return with_service(request, p, lambda s: s.get_settings())


@router.put("/settings")
def put_settings(request: Request, patch: dict[str, Any] = Body(...), p: Principal = Depends(app_principal)):
    return with_service(request, p, lambda s: s.update_settings(patch))


class TokenCreate(BaseModel):
    kind: Literal["api", "extension"]
    label: str | None = Field(default=None, max_length=80)


@router.get("/tokens")
def list_tokens(request: Request, p: Principal = Depends(app_principal)):
    return accounts(request).api_tokens.list(p.user.id)


@router.post("/tokens", status_code=201)
def create_token(body: TokenCreate, request: Request, p: Principal = Depends(session_principal)):
    raw, info = accounts(request).create_api_token(p.user, body.kind, body.label)
    return {"token": raw, "info": info}


@router.delete("/tokens/{token_id}", status_code=204)
def delete_token(token_id: str, request: Request, p: Principal = Depends(session_principal)):
    accounts(request).revoke_api_token(p.user, token_id)
    return Response(status_code=204)


class InviteCreate(BaseModel):
    email: str | None = Field(default=None, max_length=254)
    expires_days: int = Field(default=14, ge=1, le=365)


def _invite_out(inv: dict) -> dict:
    return {k: inv[k] for k in ("code", "email", "created_at", "expires_at", "used_by")}


@router.get("/invites")
def list_invites(request: Request, p: Principal = Depends(admin_principal)):
    return [_invite_out(i) for i in accounts(request).invites.list()]


@router.post("/invites", status_code=201)
def create_invite(request: Request, body: InviteCreate | None = Body(default=None),
                  p: Principal = Depends(admin_principal)):
    body = body or InviteCreate()
    return _invite_out(accounts(request).create_invite(p.user, body.email, body.expires_days))


@router.delete("/invites/{code}", status_code=204)
def delete_invite(code: str, request: Request, p: Principal = Depends(admin_principal)):
    if not accounts(request).invites.delete(code):
        raise ApiError(404, "not_found", "Invite not found.")
    return Response(status_code=204)


class ExportIn(BaseModel):
    include_messages: bool = False


@router.post("/account/export")
def export(body: ExportIn, request: Request, p: Principal = Depends(session_principal)):
    data = with_service(request, p, lambda s: s.export(body.include_messages))
    accounts(request).audit.log(p.user.id, "account_exported")
    payload = {"exported_at": now_iso(), "user": p.user.public(), "data": data}
    return Response(json.dumps(payload, ensure_ascii=False), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="lovevectorspace-export.json"'})


class DeleteIn(BaseModel):
    confirm: str = Field(max_length=64)
    password: str | None = Field(default=None, max_length=256)


@router.delete("/account", status_code=204)
def delete_account(body: DeleteIn, request: Request, p: Principal = Depends(session_principal)):
    accounts(request).delete_account(p.user, body.confirm, body.password)
    r = Response(status_code=204)
    clear_session_cookies(request, r)
    return r
