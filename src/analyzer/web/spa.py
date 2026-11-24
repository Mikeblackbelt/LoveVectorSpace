"""Serve the built SPA (frontend/dist) with an index.html fallback that never shadows /api or /mcp."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse

from .errors import ApiError

RESERVED = ("/api", "/mcp", "/healthz")


def security_headers(app_origin: str) -> dict[str, str]:
    """CSP and friends for the SPA's HTML and static assets."""
    origin = app_origin.rstrip("/")
    csp = "; ".join([
        "default-src 'self'",
        f"connect-src 'self' {origin}",
        "script-src 'self' https://appleid.cdn-apple.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self' https://appleid.apple.com https://accounts.google.com",
    ])
    return {"Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}


def install_spa(app: FastAPI, dist: Path, app_origin: str) -> None:
    dist = dist.resolve()
    sec = security_headers(app_origin)

    @app.api_route("/api/{rest:path}", methods=["POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def api_not_found(rest: str):
        raise ApiError(404, "not_found", "Not found.")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str, request: Request):
        path = "/" + full_path
        if any(path == r or path.startswith(r + "/") for r in RESERVED):
            raise ApiError(404, "not_found", "Not found.")
        index = dist / "index.html"
        if not index.is_file():
            raise ApiError(404, "not_found", "Not found.")
        if full_path:
            candidate = (dist / full_path).resolve()
            if candidate.is_file() and candidate.is_relative_to(dist):
                cache = "public, max-age=31536000, immutable" if "/assets/" in path else "no-cache"
                return FileResponse(candidate, headers={"Cache-Control": cache, **sec})
        return FileResponse(index, headers={"Cache-Control": "no-cache", **sec})
