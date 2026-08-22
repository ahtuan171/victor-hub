"""The pytest harness: a real Postgres, one transaction per test, and two clients.

Everything HTTP-level in this suite runs against the real database, not SQLite and not a mock. Three
of the things this project has already got wrong would have passed an in-memory suite: a SQLAlchemy
enum storing `IDEA` instead of `idea`, a partial index that existed only in a migration, and the
`CHECK` constraints that make INV-1 and INV-2 true for every stored row. A harness that cannot
see those is a harness that tests the ORM rather than the app.

Three rules this file exists to enforce:

* **`TEST_DATABASE_URL`, never `DATABASE_URL`.** `app/config.py` deliberately does not know the test
  database exists, so nothing outside this harness can reach it. The variable is read here, through
  its own settings model, and `_assert_is_a_test_database` refuses anything that does not look
  like a throwaway.
* **`app.db.get_session` is the only seam.** Nothing in `app/` opens a connection any other way, so
  overriding that one dependency puts the whole application inside a transaction this file rolls
  back. Adding a second way to get a session would silently take endpoints out of that transaction.
* **A test leaves no rows behind.** The rollback is the cleanup — there is no truncate step and no
  ordering dependency between tests. Endpoints still call `session.commit()`, which is why the
  session joins the outer transaction as a savepoint rather than owning it.

The schema is created by **running the migration**, once per session, and not by
`SQLModel.metadata.create_all`. Both halves of that matter:

* *By the harness*, because `.gitlab-ci.yml`'s `test:backend` job starts an empty
  `postgres:17-alpine` service and runs `uv run pytest` with no migration step before it. A harness
  that assumed a migrated database would pass on a developer's machine — where `creatorhub_test` was
  migrated by hand at T011 — and fail on the first pipeline with a missing-table error that reads
  like a fixture bug. `uv run pytest` has to work against an empty database.
* *The migration, not the metadata*, because `create_all` builds the enum types, the `CHECK`
  constraints, and the partial index from model metadata rather than from the revision that runs in
  production. That would leave the artifact deployments actually apply untested, and it is precisely
  where the `values_callable` defect and the migration-only index defect were found.
"""

from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Engine, create_engine, delete, inspect
from sqlalchemy.engine import make_url
from sqlmodel import Session

from alembic import command
from app.auth import create_access_token, hash_password
from app.config import get_settings
from app.db import get_engine, get_session
from app.main import app as fastapi_app
from app.models import Creator

BACKEND_ROOT = Path(__file__).resolve().parent.parent
"""`backend/`. Resolved from this file so the suite runs from any working directory — CI does
`cd backend` first, but `uv run pytest backend/tests` from the repository root must not behave
differently."""

CREATOR_EMAIL = "creator@example.com"
"""The seeded account every authenticated test signs in as. Already normalised — lowercase, no
surrounding whitespace — because that is what `normalise_email` stores."""

CREATOR_PASSWORD = "correct horse battery staple"

JWT_SECRET = "harness-secret-" + "x" * 32
"""A known signing secret for the whole suite.

Fixed rather than taken from the developer's `.env`, so a test that forges a token — expired, or
past half-life — signs it with the same key the app verifies against. `get_settings().jwt_secret`
returns this inside any test, which is how T018 mints one; the `harness_secret` fixture exposes it
without importing this module, which mypy treats as two modules of the same name.
"""

TOKEN_TTL_DAYS = 30
"""FR-002a's real lifetime. Left at 30 so half-life arithmetic is exercised at its true scale;
expiry is tested by forging an `exp` in the past, not by shortening the window."""


class HarnessSettings(BaseSettings):
    """The one variable this harness reads.

    A settings model rather than `os.environ` for the same reason `SeedSettings` is one: the value
    lives in the repository's `.env`, and a bare environ read would not see it unless it had also
    been exported — a confusing failure to debug on a machine where everything else works.

    Deliberately not a field on `app.config.Settings`. The application must have no way to name the
    test database, or "the suite wiped my dev data" becomes a possible sentence.
    """

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    test_database_url: str = Field(
        min_length=1,
        description=(
            "SQLAlchemy URL for creatorhub_test, created at initdb time by "
            "scripts/init-test-db.sql. The database name must end in _test."
        ),
    )


def _assert_is_a_test_database(url: str) -> None:
    """Refuse a URL that does not name a throwaway database.

    Cheap insurance against the one mistake in this file that is unrecoverable: a copy-paste that
    points `TEST_DATABASE_URL` at `creatorhub`, against a suite that writes on every test. The
    suffix check is arbitrary, but it is a convention `scripts/init-test-db.sql` already follows.
    """
    name = make_url(url).database
    if name is None or not name.endswith("_test"):
        pytest.exit(
            f"TEST_DATABASE_URL names the database {name!r}, which does not end in '_test'. "
            "Refusing to run: this suite writes and rolls back, and it must not be able to do that "
            "to a database anyone cares about.",
            returncode=4,
        )


def _upgrade_to_head(url: str) -> None:
    """Run `alembic upgrade head` against the test database, in-process.

    `alembic/env.py` deliberately ignores `alembic.ini`'s `sqlalchemy.url` and takes the URL from
    `app.config` instead, so setting it on this `Config` would have no effect. What actually points
    the migration at the test database is `DATABASE_URL`, which `_harness_environment` has already
    set — hence the assertion, which turns a silent "migrated the wrong database" into a failure at
    the only moment it is still harmless.

    Idempotent: `upgrade head` on an already-current database is a no-op, so this costs one query on
    every run after the first.
    """
    assert get_settings().database_url == url, (
        "alembic/env.py resolves its target from app.config, so DATABASE_URL must already point at "
        "the test database before the migration runs"
    )

    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    # alembic.ini resolves script_location relative to itself, which holds when alembic is invoked
    # from `backend/`. pytest can be invoked from anywhere, so it is pinned here.
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    command.upgrade(config, "head")


@pytest.fixture(scope="session")
def engine(_harness_environment: None) -> Iterator[Engine]:
    """One engine for the whole session, pointed at `creatorhub_test` and migrated to head.

    Separate from `app.db.get_engine` on purpose: the harness owns the connection the test
    transaction lives on, and the application's engine is never used because `get_session` is
    overridden before any request runs.
    """
    url = HarnessSettings().test_database_url
    _assert_is_a_test_database(url)

    _upgrade_to_head(url)

    engine = create_engine(url, pool_pre_ping=True)

    # The migration ran, so this can only fail if it ran somewhere else. Cheap, and the alternative
    # is every test failing with "relation does not exist".
    missing = {"creator"} - set(inspect(engine).get_table_names())
    if missing:
        engine.dispose()
        pytest.exit(
            f"{make_url(url).database} is still missing {sorted(missing)} after "
            "`alembic upgrade head`. Check that TEST_DATABASE_URL and DATABASE_URL name the same "
            "database inside the harness.",
            returncode=4,
        )

    _empty_the_test_database(engine)

    yield engine
    engine.dispose()


def _empty_the_test_database(engine: Engine) -> None:
    """Delete every row before the first test runs.

    Each test rolls back, so the suite leaves nothing behind — but locally the database itself is
    long-lived: `creatorhub_test` is created once at initdb time and outlives every run, so anything
    that ever committed to it from *outside* the suite stays forever. The T016 verification script
    left a `creator` row exactly that way, and the symptom was a test asserting "no creators"
    failing as though the transactional rollback were broken. Wiping once here removes that class of
    misleading failure. In CI the service container is disposable and this is a no-op.

    Safe because `_assert_is_a_test_database` has already refused any database not named `*_test`.
    Deliberately not per-test: the rollback does that job, and a truncate per test would triple the
    suite's runtime for nothing.
    """
    with engine.begin() as connection:
        connection.execute(delete(Creator))


@pytest.fixture(scope="session", autouse=True)
def _harness_environment() -> Iterator[None]:
    """Point the application's own settings at the test database, with a known secret.

    Session-scoped and autouse because two separate things depend on it. `alembic/env.py` resolves
    its target from `app.config`, so `DATABASE_URL` must name the test database before the migration
    runs — and `app.db.get_engine` must never be able to reach the developer's own database, even
    though `get_session` is overridden and nothing should call it. One env var closes both.

    `pytest.MonkeyPatch()` constructed by hand rather than the `monkeypatch` fixture, which is
    function-scoped and cannot be requested from here.
    """
    url = HarnessSettings().test_database_url
    _assert_is_a_test_database(url)

    patch = pytest.MonkeyPatch()
    patch.setenv("DATABASE_URL", url)
    patch.setenv("JWT_SECRET", JWT_SECRET)
    patch.setenv("TOKEN_TTL_DAYS", str(TOKEN_TTL_DAYS))
    get_settings.cache_clear()
    get_engine.cache_clear()

    yield

    patch.undo()
    get_settings.cache_clear()
    get_engine.cache_clear()


@pytest.fixture(autouse=True)
def _isolate_settings_cache() -> Iterator[None]:
    """Clear the settings and engine caches around every test.

    `test_config.py` and `test_auth_core.py` reconfigure the environment for their own purposes. The
    caches are `lru_cache`d, so without this a value one test set would survive into the next one —
    and the tests that fail are the ones that came after, which is the hardest kind to read.
    """
    get_settings.cache_clear()
    get_engine.cache_clear()
    yield
    get_settings.cache_clear()
    get_engine.cache_clear()


@pytest.fixture
def harness_secret() -> str:
    """`JWT_SECRET` as a fixture, so no test file has to import this module.

    `tests/` is not a package, so `from tests.conftest import JWT_SECRET` gives mypy the same file
    under two module names (`conftest` and `tests.conftest`) and it refuses to check either. A
    fixture is also how pytest expects shared values to travel.
    """
    return JWT_SECRET


@pytest.fixture
def creator_password() -> str:
    """The seeded account's plaintext password, for tests that log in through the API (T018)."""
    return CREATOR_PASSWORD


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    """A session inside a transaction that is always rolled back.

    `join_transaction_mode="create_savepoint"` is set explicitly, and it is not cosmetic. Measured
    against this database: with the mode set, an endpoint that hits a constraint, catches the
    `IntegrityError`, and calls `session.rollback()` unwinds only to its savepoint, so rows written
    earlier in the same test survive — exactly what happens in production. Under SQLAlchemy's
    default (`conditional_savepoint`) and under `rollback_only`, that same inner rollback discards
    everything back to the transaction this fixture opened: the `creator` fixture's row disappears
    mid-test, and the endpoint appears to behave differently than it does when deployed.

    That is the case T030 and T046 are about — the 409 responses that exist so an invariant
    violation is not a 500 — so the mode has to be right before those tests are written, rather than
    after they start failing for a reason that looks like application logic.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def app(session: Session) -> Iterator[FastAPI]:
    """The real application, with its session dependency replaced by the test's transaction.

    The same `Session` instance is handed to every request in a test, so a row created by a fixture
    is visible to the endpoint and a row created by the endpoint is visible to the assertions.
    """
    fastapi_app.dependency_overrides[get_session] = lambda: session
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """An anonymous client. Sends no `Authorization` header, ever — that is what it is for."""
    with TestClient(app) as client:
        yield client


@lru_cache
def _creator_password_hash() -> str:
    """Hash `CREATOR_PASSWORD` once per session.

    bcrypt costs a few hundred milliseconds by design. Per-test that is the difference between a
    suite that runs on every save and one that does not.
    """
    return hash_password(CREATOR_PASSWORD)


@pytest.fixture
def creator(session: Session) -> Creator:
    """The single v0.1 account, inserted into the test's transaction.

    Committed rather than flushed so the row is visible on the connection the way a seeded account
    would be. The commit lands in a savepoint, so the outer rollback still removes it.
    """
    creator = Creator(email=CREATOR_EMAIL, password_hash=_creator_password_hash())
    session.add(creator)
    session.commit()
    session.refresh(creator)
    return creator


@pytest.fixture
def token(creator: Creator) -> str:
    """A fresh, valid token for the seeded creator.

    Fresh matters: a token issued now is *not* past half-life, so any response to a request carrying
    this token must contain no `X-Access-Token` header. That is half of the sliding-reissue contract
    (research.md R-002) and it is the half that is easy to break by accident.
    """
    assert creator.id is not None, "a committed row always has an id"
    access_token, _ = create_access_token(creator.id)
    return access_token


@pytest.fixture
def auth_client(app: FastAPI, token: str) -> Iterator[TestClient]:
    """A client authenticated as the seeded creator, the way the Next.js proxy authenticates.

    A bearer header, never a cookie: research.md R-001 puts all cookie handling in the proxy, so a
    test that authenticated with a cookie would be testing something this API does not do.
    """
    with TestClient(app, headers={"Authorization": f"Bearer {token}"}) as client:
        yield client
