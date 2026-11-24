"""FastAPI application factory (v3 multi-user API, docs/api.md)."""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from starlette.routing import Route

from analyzer.accounts.ratelimit import SlidingWindow
from analyzer.accounts.service import AccountService
from analyzer.service.facade import ServiceFactory

from .errors import install_error_handlers
from .events import EventBus
from .mcp import McpGate, build_mcp
from .middleware import BodyLimit, PathCORS, RequestLog, install_access_log_filter
from .routes import account, agent, auth, data, events, ext
from .settings import AppSettings
from .spa import install_spa

log = logging.getLogger("analyzer.web")
NATIVE_ORIGINS = ["capacitor://localhost", "https://localhost"]
SEED_JOIN_S = 20.0


def _version() -> str:
    try:
        return version("analyzer")
    except PackageNotFoundError:
        return "0.0.0"


def create_app(settings: AppSettings, factory: ServiceFactory, *, mailer: Any = None, fetch: Any = None,
               google_transport: Any = None, passwords: Any = None) -> FastAPI:
    """Build the app. `mailer`, `fetch` (JWKS), `google_transport` and `passwords` are injection points for tests."""
    if not settings.master_key or not settings.jwt_secret:
        raise RuntimeError("MASTER_KEY and JWT_SECRET must be set")
    install_access_log_filter()
    bus = EventBus()
    accounts = AccountService(settings, factory, bus, mailer=mailer, fetch=fetch,
                              google_transport=google_transport, passwords=passwords)
    mcp = build_mcp(accounts)
    seed_done = threading.Event()   # set once demo seeding finished (or was never requested)
    if not settings.seed_demo:
        seed_done.set()

    def run_seed() -> None:
        try:
            accounts.seed_demo()
        except Exception as e:
            log.warning("demo seeding failed: %s", type(e).__name__)
        finally:
            seed_done.set()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Demo seeding (model scoring included) can take minutes: run it in the background so the port
        # opens and /healthz answers at once. It is resumable, so a restart mid-seed completes it.
        seeder = None
        if not seed_done.is_set():
            seeder = threading.Thread(target=run_seed, name="demo-seed", daemon=True)
            seeder.start()
        try:
            async with mcp.session_manager.run():
                yield
        finally:
            accounts.request_stop()
            shutdown = getattr(factory, "shutdown", None)
            if callable(shutdown):
                try:
                    shutdown()          # stop background work before closing user connections
                except Exception:
                    log.exception("factory shutdown failed")
            if seeder is not None:
                seeder.join(SEED_JOIN_S)    # its next locked step raises ServiceClosed after shutdown()
            accounts.close()

    app = FastAPI(title="LoveVectorSpace API", version=_version(), lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.accounts = accounts
    app.state.events = bus
    app.state.seed_done = seed_done
    app.state.ingest_limiter = SlidingWindow(settings.ingest_msgs_per_min, 60)
    install_error_handlers(app)

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "version": _version(), "seeding": not seed_done.is_set()}

    for r in (auth.router, account.router, data.router, agent.router, ext.router, events.router):
        app.include_router(r)
    app.router.routes.append(Route("/mcp", McpGate(mcp, accounts, settings.app_origin),
                                   methods=["GET", "POST", "DELETE"]))
    install_spa(app, Path(settings.frontend_dist), settings.app_origin)   # must be last: catch-all GET

    app.add_middleware(BodyLimit, import_limit=settings.max_import_bytes, ingest_limit=settings.max_ingest_bytes,
                       messages_limit=settings.max_messages_import_bytes)
    app.add_middleware(RequestLog)
    app.add_middleware(PathCORS, app_origins=[settings.app_origin, *NATIVE_ORIGINS],
                       extension_id=settings.extension_id,
                       bearer_only_origins=[o for o in NATIVE_ORIGINS if o != settings.app_origin.rstrip("/")])   # outermost, so error responses carry CORS headers

    return app
