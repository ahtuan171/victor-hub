"""What the schema must *not* contain — INV-4 and constitution principle VII.

Every other test in this suite asserts that something works. This one asserts that something was
never built, which is a different job: the failure mode it guards against is not a bug but a
well-intentioned addition, made by someone who did not read `data-model.md` and had no reason to
suspect that an ordinary-looking foreign key was forbidden.

The constitution names principle VII as a recurring offender, and `data-model.md` says the guard is
"a test rather than a review note" for exactly that reason — a review note is advice, and advice is
what gets skipped at the end of a long branch.

**Content Calendar (`content_item`) was removed 2026-08-22** (owner's instruction — see
`backend/alembic/versions/20260822_b2e53f7a1c94_drop_content_calendar.py`), so the pattern check
below runs against `trip` instead: it was never *about* `content_item` specifically, only about
whichever table this project would plausibly grow a forbidden column on next. `trip`'s own exact
column allowlist and foreign-key check live in `test_destinations.py`'s `ALLOWED_COLUMNS`
parametrisation, which already covers every 003/Module-02 table — not duplicated here.
"""

import pytest
from sqlalchemy import inspect
from sqlmodel import Session

EXPECTED_TABLES = {
    "creator",
    "trip",
    "destination",
    "photograph",
    "travel_event",
    "alembic_version",
}
"""The whole schema. `alembic_version` is Alembic's bookkeeping, not ours.

Constitution VII forbids "organization entities" as well as owner columns, and a new *table* is how
that arrives — `organization`, `workspace`, `team`, `role`. A column allowlist would not see it.

`trip`, `destination` and `photograph` joined this set at 003-travel-map T008: the 2.0.0
constitution amendment ratified the travel map as this product's actual next module, and
`specs/003-travel-map/data-model.md` is those three tables' own answer key — this test does not
duplicate that review, it only keeps the schema from growing a *fourth*, unratified table
(`growth_metric`, `deal` — the modules the same amendment cancelled) without this test noticing.

`travel_event` joined this set for Module 02 (Travel Schedule), built from
`Module_02_Travel_Schedule_Spec.md` rather than a ratified `spec.md` — the owner's explicit
instruction to bypass the speckit workflow for this module.
"""


def _columns(session: Session, table: str) -> set[str]:
    return {column["name"] for column in inspect(session.get_bind()).get_columns(table)}


@pytest.mark.parametrize(
    ("pattern", "requirement"),
    [
        ("user", "INV-4, FR-003, constitution VII"),
        ("owner", "INV-4, FR-003, constitution VII"),
        ("tenant", "INV-4, FR-003, constitution VII"),
        ("creator", "INV-4, FR-003, constitution VII"),
        ("version", "FR-023a - last write wins, with no detection"),
        ("etag", "FR-023a - last write wins, with no detection"),
        ("lock", "FR-023a - last write wins, with no detection"),
        ("deleted", "FR-004 - delete is delete; nothing in the spec asks for recovery"),
        ("order", "Assumptions - backlog order is created_at DESC, not manual"),
    ],
)
def test_trip_has_no_column_matching_a_forbidden_pattern(
    session: Session, pattern: str, requirement: str
) -> None:
    """The `Columns deliberately absent` table `data-model.md` files carry, made mechanical.

    Each row exists because something plausible was considered and rejected for a stated reason,
    and none of those reasons are self-evident from reading the model. The pattern is matched as a
    substring, so `creator_id`, `owner_id`, and `lock_version` all fail against the row that
    forbids them. `trip` is the representative table — see the module docstring for why it, not
    `content_item`, carries this check now.
    """
    offenders = sorted(name for name in _columns(session, "trip") if pattern in name)

    assert not offenders, (
        f"trip.{offenders} matches the forbidden pattern %{pattern}%. "
        f"Forbidden by {requirement}. If this column is genuinely needed, amend the relevant "
        f"spec.md and data-model.md first - a new field is a product decision, not an "
        f"implementation detail."
    )


def test_the_schema_holds_no_table_beyond_the_ones_the_spec_describes(session: Session) -> None:
    """Constitution VII forbids organization entities, and those arrive as tables, not columns.

    Also a scope check with a wider reach than it looks: this product ships the Travel Map and
    Travel Schedule, and nothing else — so a `growth_metric` or `deal` table appearing here would
    mean one of the 2.0.0 amendment's *cancelled* modules had started leaking back in, the
    specific failure this project is structured to avoid.
    """
    assert set(inspect(session.get_bind()).get_table_names()) == EXPECTED_TABLES


def test_creator_carries_no_role_or_organization_column(session: Session) -> None:
    """The other half of principle VII, which names roles alongside multi-tenancy.

    `creator` is the table an ownership model would grow from, so the same rule applies to it: one
    account, no `role`, no `is_admin`, no `organization_id`. Asserted as an allowlist for the same
    reason as above.

    `theme` and `sound_enabled` joined the allowlist at T013 (002-pixel-arcade-skin,
    `data-model.md`): two columns on this same row, not a new table and not an owner column.
    """
    assert _columns(session, "creator") == {
        "id",
        "email",
        "password_hash",
        "created_at",
        "theme",
        "sound_enabled",
    }


def test_the_pattern_check_matches_when_a_column_really_does_match(session: Session) -> None:
    """A test for the tests above. Nine green "nothing matched" results are worth exactly as much
    as the matching is, and a substring check that *cannot* match looks identical to one that
    simply found nothing.

    So the same filter is run with a pattern that must hit — "date" — and asserted to hit. If
    `_columns` ever starts returning an empty set, or the comprehension above is refactored into
    something that no longer compares what it claims to, this fails and the nine silent passes
    stop being silent.

    `updated_at` is in the expected result because it contains "date" inside "updated". Not a
    curiosity: it is the reminder that these are substring matches with no word boundaries, so a
    forbidden pattern short enough to appear inside an innocent name would fail a schema that is
    entirely correct.
    """
    matched = sorted(name for name in _columns(session, "trip") if "date" in name)

    assert matched == ["end_date", "start_date", "updated_at"]
