"""ASGI entry point: `uvicorn analyzer.web.main:app --proxy-headers`.

The app is built lazily on first access of `app`, wiring create_app to the service layer's
`analyzer.service.impl.ServiceFactoryImpl`.
"""
from __future__ import annotations

from typing import Any

from .app import create_app
from .settings import AppSettings


def build_app() -> Any:
    settings = AppSettings()   # raises if MASTER_KEY / JWT_SECRET are missing (fail closed)
    try:
        from analyzer.service.impl import ServiceFactoryImpl
    except ImportError as e:
        raise RuntimeError(
            "Cannot start: analyzer.service.impl.ServiceFactoryImpl is not available "
            f"({e}). The service layer must provide it."
        ) from e
    factory = ServiceFactoryImpl.from_settings(settings)   # create_app wires conn_opener (create=False)
    return create_app(settings, factory)


_app = None


def __getattr__(name: str) -> Any:
    global _app
    if name == "app":
        if _app is None:
            _app = build_app()
        return _app
    raise AttributeError(name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(build_app(), host="0.0.0.0", port=8000, proxy_headers=True)
