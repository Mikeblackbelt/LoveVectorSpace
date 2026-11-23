"""Serve the built SPA (frontend/dist) with an index.html fallback that never shadows /api or /mcp."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse

from .errors import ApiError

RESERVED = ("/api", "/mcp", "/healthz")


def install_spa(app: FastAPI, dist: Path) -> None:
    dist = dist.resolve()

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
                return FileResponse(candidate, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
