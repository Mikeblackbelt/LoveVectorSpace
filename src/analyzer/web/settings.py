"""Server settings from the environment (v3 multi-user). Fails closed without MASTER_KEY / JWT_SECRET."""
from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _split(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # required secrets (no defaults: missing → ValidationError at startup)
    master_key: str = Field(min_length=16)
    jwt_secret: str = Field(min_length=32)

    data_dir: str = "data"
    app_origin: str = "http://localhost:5173"
    public_url: str | None = None          # externally visible base URL of this API (Google redirect); defaults to APP_ORIGIN
    extension_id: str | None = None
    frontend_dist: str = "frontend/dist"
    cookie_secure: bool = True

    groq_api_key: str | None = None
    groq_model: str | None = None

    resend_api_key: str | None = None
    mail_from: str | None = None

    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_client_ids: str | None = None   # comma-separated audiences for native ID tokens
    apple_client_ids: str | None = None    # comma-separated
    apple_team_id: str | None = None
    apple_key_id: str | None = None
    apple_private_key: str | None = None

    admin_email: str | None = None
    seed_demo: bool = False
    demo_password: str | None = None

    # limits (injectable for tests)
    max_import_bytes: int = 50 * 1024 * 1024
    max_ingest_bytes: int = 2 * 1024 * 1024
    ingest_msgs_per_min: int = 10_000
    user_db_cache_size: int = 32
    sse_heartbeat_s: float = 15.0

    @field_validator("master_key", "jwt_secret")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v

    @property
    def public_base_url(self) -> str:
        return self.public_url or self.app_origin

    @property
    def google_audiences(self) -> list[str]:
        out = _split(self.google_client_ids)
        if self.google_client_id and self.google_client_id not in out:
            out.append(self.google_client_id)
        return out

    @property
    def apple_audiences(self) -> list[str]:
        return _split(self.apple_client_ids)
