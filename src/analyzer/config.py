from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven settings. Later tasks add validation and defaults."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_key: str | None = None
    api_token: str | None = None
    owner_password_hash: str | None = None
    totp_secret: str | None = None
    session_secret: str | None = None
    groq_api_key: str | None = None
    groq_model: str | None = None
    app_origin: str | None = None
    extension_id: str | None = None
    db_path: str | None = None
