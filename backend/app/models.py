"""All tables.

`creator` is [001](../../specs/001-content-calendar/data-model.md)'s (Content Calendar itself —
`content_item` — was removed 2026-08-22, owner's instruction; see
`backend/alembic/versions/20260822_b2e53f7a1c94_drop_content_calendar.py`). `trip`, `destination`
and `photograph` are [003](../../specs/003-travel-map/data-model.md)'s. `travel_event` is Module 02
(Travel Schedule), built outside the speckit workflow — see
`specs/travel-schedule/contracts/openapi.yaml`'s own header comment. If this file and a
`data-model.md` disagree, one of them is wrong and the answer is not "adjust the code quietly" —
see the non-negotiables in CLAUDE.md.

**No owner column anywhere.** Not `user_id`, not `owner_id`, not `tenant_id`. Constitution VII:
there is one creator, and a foreign key to a single row taxes every query and migration in
exchange for nothing.
"""

from datetime import date, datetime, time
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    Time,
    func,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel


class Theme(StrEnum):
    """FR-010, FR-011, FR-012 (iteration 002). Exactly two values.

    `dark` is what an account has before anyone chooses (FR-012) — the column default, not a null.
    `data-model.md` explains why the column is `NOT NULL` with a default rather than nullable:
    nothing in the product ever needs to distinguish "never chosen" from "chosen, and happens to be
    the default".
    """

    DARK = "dark"
    LIGHT = "light"


class DestinationStatus(StrEnum):
    """FR-002, FR-026 (003-travel-map). Drives a map pin's fill.

    Unconstrained in the direction it may change (FR-028) — no ordering table, because there is no
    sequence to preserve: any of the three is reachable from either other at any time
    (data-model.md's State transitions).
    """

    VISITED = "visited"
    PLANNED = "planned"
    WISHLIST = "wishlist"


class TripStatus(StrEnum):
    """FR-014 (003-travel-map). Descriptive only — drives no pin, and no requirement in that spec
    depends on its exact values beyond "a status exists" (data-model.md).
    """

    WISHLIST = "wishlist"
    PLANNED = "planned"
    BOOKED = "booked"
    UPCOMING = "upcoming"
    TRAVELING = "traveling"
    COMPLETED = "completed"


class TravelEventType(StrEnum):
    """Module 02 (Travel Schedule). The five kinds of dated entry a Trip carries, per
    Module_02_Travel_Schedule_Spec.md §8/§15.

    Deliberately **not** including a `TRIP` member: a Trip is already its own table with its own
    date range, and the calendar's `◆` trip marker is drawn from that range directly (`Trip.name`/
    `Trip.destination`), not from a `TravelEvent` row. §13's "NEW TRAVEL ENTRY" picker offers
    creating a Trip as a distinct first choice, alongside these five — never as a sixth member here.
    """

    TRANSPORT = "transport"
    STAY = "stay"
    ACTIVITY = "activity"
    FOOD = "food"
    NOTE = "note"


def _identity_pk() -> Column[int]:
    """An identity primary key, which is what data-model.md specifies.

    SQLAlchemy's default for an integer primary key is `SERIAL`. Identity columns are the standard
    replacement and avoid `SERIAL`'s separate-sequence ownership quirks — notably a sequence left
    behind, or left un-advanced, by a bulk insert that supplied explicit ids.
    """
    return Column(Integer, Identity(), primary_key=True)


def _pg_enum(enum_type: type[StrEnum], name: str) -> SAEnum:
    """A Postgres enum that stores the member *values*, not their Python names.

    SQLAlchemy's default is to store `IDEA`, while the contract, the frontend, and every fixture use
    `idea`. The mismatch does not surface until the first round trip against a real database.
    """
    return SAEnum(
        enum_type,
        name=name,
        values_callable=lambda e: [member.value for member in e],
    )


class Creator(SQLModel, table=True):
    """The single v0.1 account. Exists only so a password hash has somewhere to live.

    No owner relationship to any other table — constitution VII: there is one creator, and a
    foreign key to a single row taxes every query and migration in exchange for nothing. Rows are
    created by `app.scripts.seed_user` and nowhere else — there is no registration endpoint, no
    password reset, and no email verification.
    """

    __tablename__ = "creator"

    id: int | None = Field(default=None, sa_column=_identity_pk())
    email: str = Field(sa_column=Column(String(320), nullable=False, unique=True))
    password_hash: str = Field(sa_column=Column(String(255), nullable=False))
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    )

    # 002-pixel-arcade-skin, data-model.md: the account's presentation and sound choices. Both
    # `NOT NULL` with a default rather than nullable — see that file for why a third "never chosen"
    # state would add a value no requirement ever reads.
    theme: Theme = Field(
        default=Theme.DARK,
        sa_column=Column(
            _pg_enum(Theme, "theme"),
            nullable=False,
            server_default=Theme.DARK.value,
        ),
    )
    sound_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )


class Trip(SQLModel, table=True):
    """A named span of travel a Destination may optionally belong to (003-travel-map FR-014)."""

    __tablename__ = "trip"

    id: int | None = Field(default=None, sa_column=_identity_pk())
    name: str = Field(sa_column=Column(String(200), nullable=False))

    # Module 02 (Travel Schedule) §14.1. Both nullable and both additive to the 003 table — a Trip
    # created before this iteration reads back with `destination` and `notes` as null, not an error.
    # `destination` is free text ("Tokyo, Japan"), separate from `name` ("Summer Getaway"), because
    # the spec's own form asks for both; the Trip Timeline (§10) falls back to `name` when
    # `destination` is unset, so nothing upstream of this iteration has to backfill it.
    destination: str | None = Field(default=None, sa_column=Column(String(200), nullable=True))
    notes: str | None = Field(default=None, sa_column=Column(Text, nullable=True))

    start_date: date = Field(sa_column=Column(Date, nullable=False))
    end_date: date = Field(sa_column=Column(Date, nullable=False))

    status: TripStatus = Field(
        default=TripStatus.WISHLIST,
        sa_column=Column(
            _pg_enum(TripStatus, "tripstatus"),
            nullable=False,
            server_default=TripStatus.WISHLIST.value,
        ),
    )

    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    )
    updated_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )
    )


class Destination(SQLModel, table=True):
    """One marked place: a map pin, and the note/photographs a Visited one opens to.

    `trip_id` is nullable (FR-020 — a Destination MAY exist unattached to any Trip) and cascades
    on delete. `latitude`/`longitude` are `NOT NULL` with no default — INV-1: there is no code path
    that inserts a row before geocoding has already resolved both, so the guarantee lives in the
    API layer's control flow rather than in a `CHECK` (data-model.md explains why 0,0 rules out a
    constraint expressed from these columns alone).
    """

    __tablename__ = "destination"

    id: int | None = Field(default=None, sa_column=_identity_pk())

    trip_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("trip.id", ondelete="CASCADE"), nullable=True, index=True
        ),
    )

    name: str = Field(sa_column=Column(String(200), nullable=False))
    latitude: float = Field(sa_column=Column(Float, nullable=False))
    longitude: float = Field(sa_column=Column(Float, nullable=False))

    # Nullable against §12's own "required" listing — the Quick Add flow's "No date yet" choice
    # only makes sense if a Destination can be saved with no dates at all (data-model.md).
    start_date: date | None = Field(default=None, sa_column=Column(Date, nullable=True))
    end_date: date | None = Field(default=None, sa_column=Column(Date, nullable=True))

    status: DestinationStatus = Field(
        default=DestinationStatus.WISHLIST,
        sa_column=Column(
            _pg_enum(DestinationStatus, "destinationstatus"),
            nullable=False,
            server_default=DestinationStatus.WISHLIST.value,
            index=True,
        ),
    )

    note: str | None = Field(default=None, sa_column=Column(Text, nullable=True))

    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    )
    updated_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )
    )


class Photograph(SQLModel, table=True):
    """One R2 object key attached to a Destination — never image bytes (FR-024, FR-025)."""

    __tablename__ = "photograph"

    id: int | None = Field(default=None, sa_column=_identity_pk())

    destination_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("destination.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )

    object_key: str = Field(sa_column=Column(String(512), nullable=False))

    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    )


class TravelEvent(SQLModel, table=True):
    """One dated entry inside a Trip's daily timeline — Module 02 (Travel Schedule) §15.

    `trip_id` is nullable (an event can exist before it is attached to a Trip, the same shape
    `destination.trip_id` already uses) and cascades on delete, matching `delete_trip`'s existing
    "cascades to everything under it, nothing deleted by hand" rule in `api/trips.py`.

    The type-specific fields below are a fixed set of nullable columns rather than a JSON blob —
    consistent with how `destination.note` is a plain typed column elsewhere in this file, and it
    keeps a future `get_events_by_date_range()` filter (§17) a plain column read instead of a
    JSON-path query. Which columns a given `event_type` actually uses is a form-layer concern
    (§14); the table does not enforce it.
    """

    __tablename__ = "travel_event"

    id: int | None = Field(default=None, sa_column=_identity_pk())

    trip_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("trip.id", ondelete="CASCADE"), nullable=True, index=True
        ),
    )

    # Named `event_type`, not `type`: a SQLModel/Pydantic field literally named `type` collides
    # with the builtin during annotation resolution (`PydanticUserError:
    # unevaluable-type-annotation`) — found the hard way running this migration.
    event_type: TravelEventType = Field(
        sa_column=Column(_pg_enum(TravelEventType, "traveleventtype"), nullable=False, index=True)
    )
    title: str = Field(sa_column=Column(String(200), nullable=False))

    # Named `event_date`, not `date`, for the same reason as `event_type` above: a field literally
    # named `date` collides with the `date` type it is annotated with.
    #
    # Calendar day only, no timezone — the same FR-012a precedent every other date column in this
    # project follows. `start_time` is advisory display only (§14's "Time (optional)" fields);
    # nothing derives overdue-ness or ordering-with-DST from it.
    event_date: date = Field(sa_column=Column(Date, nullable=False, index=True))
    start_time: time | None = Field(default=None, sa_column=Column(Time, nullable=True))

    # §14's per-type fields, all optional and all plain text — see the class docstring for why
    # this is flat columns rather than a JSON column.
    location: str | None = Field(default=None, sa_column=Column(String(200), nullable=True))
    from_location: str | None = Field(default=None, sa_column=Column(String(120), nullable=True))
    to_location: str | None = Field(default=None, sa_column=Column(String(120), nullable=True))
    booking_reference: str | None = Field(
        default=None, sa_column=Column(String(120), nullable=True)
    )
    category: str | None = Field(default=None, sa_column=Column(String(60), nullable=True))
    notes: str | None = Field(default=None, sa_column=Column(Text, nullable=True))

    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    )
    updated_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )
    )
