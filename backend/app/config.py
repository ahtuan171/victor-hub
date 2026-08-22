"""Environment-backed settings.

Every value the app reads from outside itself lands here, so there is one place to look when a
deployment misbehaves and no `os.environ` calls scattered through the codebase.

The names match `.env.example` at the repository root; that file is the documentation for this one.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration read from the environment, or from a `.env` file in local development."""

    model_config = SettingsConfigDict(
        # `../.env` first because the repository keeps one .env at the root shared by both apps, and
        # backend commands run from `backend/`. A `backend/.env` still wins if someone wants to
        # override locally.
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        # Both apps read the same file, so it contains frontend variables this model knows nothing
        # about. Rejecting them would make the backend refuse to boot over a Next.js setting.
        extra="ignore",
        case_sensitive=False,
    )

    database_url: str = Field(
        min_length=1,
        description="SQLAlchemy URL, e.g. postgresql+psycopg://user:pass@host:5432/creatorhub",
    )

    jwt_secret: str = Field(
        # No default, anywhere. An app that boots with a guessable signing secret is worse than one
        # that refuses to boot: the failure is silent and the consequence is forged sessions.
        #
        # The length floor is what makes that real. `.env.example` ships `JWT_SECRET=` empty, so
        # without it an unedited copy would satisfy `str` and start happily.
        min_length=32,
        description="Signs the session JWT. Generate with: python -c "
        '"import secrets; print(secrets.token_urlsafe(48))"',
    )

    token_ttl_days: int = Field(
        default=30,
        gt=0,
        description=(
            "Session lifetime in days (FR-002a). Tokens slide on use — research.md R-002 — so this "
            "is also how long a leaked token stays valid: v0.1 has no denylist and no revocation."
        ),
    )

    frontend_origin: str = Field(
        default="http://localhost:3000",
        min_length=1,
        description=(
            "CORS allowlist. Defence in depth only. research.md R-008 makes the Next.js proxy "
            "allowlist the actual boundary, because no browser ever contacts this origin directly."
        ),
    )

    r2_account_id: str = Field(
        default="",
        description="Cloudflare account id for the R2 bucket holding trip photographs "
        "(003-travel-map).",
    )

    r2_access_key_id: str = Field(
        default="",
        description="R2 S3-compatible access key id. No code reads these yet — added at T001 so "
        "the names exist before T007's presigned-URL service reads them.",
    )

    r2_secret_access_key: str = Field(
        default="",
        description="R2 S3-compatible secret access key.",
    )

    r2_bucket_name: str = Field(
        default="",
        description="R2 bucket name. Photographs only, per tech-defaults.md's Object storage "
        "section.",
    )

    hf_token: str = Field(
        default="",
        description="Hugging Face access token for Travel Intelligence inference. Empty means the "
        "AI module answers with a message naming this variable rather than failing obscurely.",
    )

    hf_model: str = Field(
        default="Qwen/Qwen2.5-7B-Instruct",
        description="Model id sent to the Hugging Face router. Must be served by at least one "
        "inference provider; a model with none answers 404.",
    )


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, constructed once.

    A function rather than a module-level instance: importing `app.config` must not be able to fail,
    or a missing variable surfaces as an import error from whichever module happened to be loaded
    first rather than as a startup error naming the variable. Cached because it is a FastAPI
    dependency and re-reading the environment per request buys nothing.
    """
    return Settings()
