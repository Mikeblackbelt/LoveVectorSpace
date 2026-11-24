"""Read-only MCP endpoint at /mcp (official `mcp` SDK 2.x, Streamable HTTP, stateless JSON).

Auth: `Authorization: Bearer <api_token>` (kind "api"), scoped to that token's user. Requests carrying an
Origin other than APP_ORIGIN are rejected (DNS-rebinding / browser protection).
"""
from __future__ import annotations

import json
from typing import Any

import anyio
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings

from analyzer.accounts.service import AccountError, AccountService

from .errors import map_exception

RULES = (
    " Rules: cite each metric's evidence tag (moderate / heuristic / descriptive / self-report heuristic); "
    "report the success estimate only with its 'uncalibrated estimate' tag and never as a prediction; "
    "relay safety categories and severities unchanged and never soften them; "
    "do not help monitor, track or diagnose the other person."
)

USER_KEY = "lvs_user_id"


def build_mcp(accounts: AccountService) -> MCPServer:
    mcp = MCPServer(name="lovevectorspace", instructions="Read-only access to the signed-in user's relationship "
                    "analyses." + RULES)

    async def run(ctx: Context, fn) -> Any:
        user_id = ctx.request_context.request.scope.get(USER_KEY)
        if not user_id:
            raise ToolError("unauthenticated")

        def call():
            with accounts.userdbs.use(user_id) as h, h.lock:
                return fn(h.service)
        try:
            return await anyio.to_thread.run_sync(call)
        except Exception as exc:
            e = map_exception(exc)
            if e is None:
                raise ToolError("internal error") from None
            raise ToolError(f"{e.code}: {e.message}") from None

    @mcp.tool(description="List the people the user tracks, with source health, headline estimate and safety level."
              + RULES)
    async def list_people(ctx: Context) -> list[dict]:
        return await run(ctx, lambda s: s.list_people())

    @mcp.tool(description="Latest analysis overview for one person: success estimate, safety block, reciprocity, "
              "metrics, scales, weekly counts, coverage and next steps." + RULES)
    async def get_person_overview(person_id: int, ctx: Context) -> dict:
        return await run(ctx, lambda s: s.overview(person_id))

    @mcp.tool(description="Time series [{ts, value}] of one metric for one person." + RULES)
    async def get_history(person_id: int, metric_id: str, ctx: Context) -> list[dict]:
        return await run(ctx, lambda s: s.history(person_id, metric_id))

    @mcp.tool(description="What a metric measures, its evidence level, caveats and citation." + RULES)
    async def explain_metric(metric_id: str, ctx: Context) -> dict:
        return await run(ctx, lambda s: s.explain_metric(metric_id))

    @mcp.tool(description="Next-step cards for one person (status: open, done or dismissed; default open)." + RULES)
    async def list_next_steps(person_id: int, ctx: Context, status: str | None = "open") -> list[dict]:
        return await run(ctx, lambda s: s.list_next_steps(person_id, status))

    @mcp.tool(description="Owner-entered context for one person: facts and logged interactions." + RULES)
    async def get_context(person_id: int, ctx: Context) -> dict:
        return await run(ctx, lambda s: {"facts": s.list_facts(person_id),
                                         "interactions": s.list_interactions(person_id)})

    mcp.streamable_http_app(
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),  # Origin checked below
    )
    return mcp


def _json(status: int, code: str, message: str) -> tuple[dict, dict]:
    body = json.dumps({"error": {"code": code, "message": message}}).encode()
    return ({"type": "http.response.start", "status": status,
             "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]},
            {"type": "http.response.body", "body": body})


class McpGate:
    """ASGI app for the /mcp route: Origin check + api-token auth, then the SDK's session manager."""

    def __init__(self, mcp: MCPServer, accounts: AccountService, app_origin: str):
        self.mcp, self.accounts, self.app_origin = mcp, accounts, app_origin.rstrip("/")

    async def _reply(self, send, status, code, message):
        start, body = _json(status, code, message)
        await send(start)
        await send(body)

    async def __call__(self, scope, receive, send):
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope.get("headers", [])}
        origin = headers.get("origin")
        if origin and origin.rstrip("/") != self.app_origin:
            return await self._reply(send, 403, "forbidden", "Origin not allowed.")
        scheme, _, token = headers.get("authorization", "").partition(" ")
        token = token.strip()
        if scheme.lower() != "bearer" or not token.startswith("lvsa_"):
            return await self._reply(send, 401, "unauthenticated", "An API token is required.")
        try:
            p = await anyio.to_thread.run_sync(self.accounts.authenticate_bearer, token)
        except AccountError:
            return await self._reply(send, 401, "unauthenticated", "An API token is required.")
        if p.kind != "api":
            return await self._reply(send, 401, "unauthenticated", "An API token is required.")
        scope[USER_KEY] = p.user.id
        state = scope.setdefault("state", {})
        if isinstance(state, dict):
            state["user_id"] = p.user.id
        await self.mcp.session_manager.handle_request(scope, receive, send)
