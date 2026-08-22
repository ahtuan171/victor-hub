"""Tests for the harness itself, not for the application.

`conftest.py` makes three promises, and each one fails silently when it breaks: a test that leaves
rows behind makes an unrelated test fail later, an override that is not installed sends requests at
the developer's own database, and a client that carries a stale header authenticates when it should
not. None of that surfaces as an error in the fixture — it surfaces as a flaky suite two tasks from
now.

`test_rows_do_not_survive_the_previous_test` is the important one, and it depends on running after
the test above it. That is why the two are ordered and named as a pair rather than merged: the point
is precisely that state does *not* cross the boundary between them.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, select

from app.config import get_settings
from app.db import get_session
from app.models import Creator


def test_the_harness_talks_to_a_real_postgres(session: Session) -> None:
    """SQLite would accept a schema Postgres refuses, and vice versa."""
    assert session.get_bind().dialect.name == "postgresql"


def test_the_schema_under_test_is_the_migrated_one(session: Session) -> None:
    """The schema exists because Alembic ran, not because metadata created it.

    `SQLModel.metadata.create_all` never creates an `alembic_version` table — that bookkeeping
    table belongs to Alembic alone, and nothing in `app/models.py` declares it. Its presence is
    therefore direct evidence the harness ran `alembic upgrade head` rather than building the
    schema from model metadata, which is what `backend/AGENTS.md` requires (a `create_all` suite
    would pass against a schema production never has: no CHECK constraints, no partial indexes,
    whatever `alembic upgrade head` and model metadata happen to agree on that day).
    """
    assert "alembic_version" in inspect(session.get_bind()).get_table_names()


def test_a_committed_row_is_visible_within_the_test(session: Session, creator: Creator) -> None:
    """The `creator` fixture commits. Inside the test that commit must be real."""
    assert creator.id is not None
    assert session.get(Creator, creator.id) is not None


def test_rows_do_not_survive_the_previous_test(session: Session) -> None:
    """The rollback is the only cleanup there is, and every counting test depends on it.

    The test above commits a creator. This one runs after it and must see none. It also covers the
    other way this can break, which is not the fixture at all: `creatorhub_test` is long-lived, so
    a row committed into it by anything outside this suite — an ad-hoc script, a stray `alembic`
    session — would sit there permanently. `_empty_the_test_database` is what keeps that from
    reading as a rollback failure.
    """
    assert session.exec(select(func.count()).select_from(Creator)).one() == 0


def test_an_inner_rollback_does_not_discard_the_whole_test(
    session: Session, creator: Creator
) -> None:
    """An endpoint that refuses a write must not take the test's own data with it.

    This is `join_transaction_mode="create_savepoint"` in action, and the reason it is set
    explicitly: an endpoint catching an `IntegrityError` and rolling back is exactly what T030's 409
    path does. Under the default mode this assertion fails, because the inner rollback unwinds past
    the `creator` fixture as well.
    """
    session.add(Creator(email=creator.email, password_hash="x"))  # unique violation
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()

    assert session.exec(select(func.count()).select_from(Creator)).one() == 1


def test_the_application_uses_the_test_transaction(app: object, session: Session) -> None:
    """The override is the seam. Without it, requests reach the developer's own database."""
    assert getattr(app, "dependency_overrides")[get_session]() is session  # noqa: B009


def test_the_suite_signs_tokens_with_the_harness_secret(harness_secret: str) -> None:
    """T018 forges tokens through `get_settings()`. It has to be the key the app verifies with.

    Also the check that the developer's own `.env` secret is not in play: a suite whose expectations
    depend on a value that differs per machine passes here and fails in CI.
    """
    assert get_settings().jwt_secret == harness_secret


def test_the_anonymous_client_sends_no_credential(client: TestClient) -> None:
    assert "authorization" not in client.headers


def test_the_authenticated_client_sends_a_bearer_token(auth_client: TestClient) -> None:
    """A bearer header, not a cookie — cookies belong to the proxy (research.md R-001)."""
    assert auth_client.headers["authorization"].startswith("Bearer ")


def test_health_is_reachable_through_the_client(client: TestClient) -> None:
    """The first HTTP-level assertion in the project. Everything from T018 on rests on it."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
