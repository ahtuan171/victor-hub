"""The Destination routes. `listDestinations` (T012) and `createDestination` (T013) land here
first (User Story 1); `getDestination` (T023), `updateDestination`/`deleteDestination` at
T024-T025 (User Story 2); FR-017's containment check at T039 (User Story 3).
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import col, select

from app.auth import CurrentCreator
from app.db import SessionDep
from app.models import Destination, DestinationStatus, Photograph, Trip
from app.schemas import (
    DestinationCreate,
    DestinationDetail,
    DestinationRead,
    DestinationUpdate,
    ErrorResponse,
    PhotographRead,
)
from app.services.object_storage import read_url

router = APIRouter(prefix="/destinations", tags=["destinations"])


def get_or_404(session: SessionDep, destination_id: int) -> Destination:
    """Fetch one Destination or raise the contract's 404 — the shared lookup every
    id-addressed route in this file uses, matching `trips.py`'s own `get_or_404`
    so "no such destination" reads identically whichever verb asked.
    """
    destination = session.get(Destination, destination_id)
    if destination is None:
        raise HTTPException(status_code=404, detail="No such destination.")
    return destination


def require_trip_or_422(session: SessionDep, trip_id: int | None) -> None:
    """Refuse a body whose `trip_id` names no Trip, before the insert reaches the foreign key.

    **Found by the Final Phase `reviewer` pass (T058, 2026-08-17), and it was reachable rather
    than theoretical.** Without this, the `ON DELETE CASCADE` foreign key raises `IntegrityError`
    at `commit()`, nothing in `app/main.py` handles it, and Starlette answers
    `500 text/plain "Internal Server Error"` — which breaks the uniform `{"detail": "<string>"}`
    body `main.py`'s own docstring names as the reason its `RequestValidationError` handler exists.
    `QuickAdd` and `TripPanel` both send a `trip_id` taken from a Trip list loaded earlier in the
    session, so deleting a Trip on one device with a stale add-flow open on another reproduces it.

    **422, not 404, and no contract amendment was needed for it.** `trip_id` arrives in the
    *body*, so this is a request that failed validation — the 422 both `createDestination` and
    `updateDestination` already declare — rather than the 404 the contract reserves for an
    id-addressed row in the *path* (`get_or_404`). Stated in `contracts/openapi.yaml` as well as
    here, because `001`'s Phase 7 finding was a contract *silence* rather than a wrong sentence,
    and a silence is the one thing grepping a claim cannot find.
    """
    if trip_id is None:
        return
    if session.get(Trip, trip_id) is None:
        raise HTTPException(status_code=422, detail="No such trip.")


def _outside_trip_range(destination: Destination, trip: Trip | None) -> bool:
    """FR-017: flagged, never rejected. Applies only when both ranges are present —
    `trip.start_date`/`end_date` are `NOT NULL` (data-model.md), so the only nullable side is
    the Destination's own dates, and a Destination with no Trip has nothing to compare against.
    """
    if trip is None or destination.start_date is None or destination.end_date is None:
        return False
    return destination.start_date < trip.start_date or destination.end_date > trip.end_date


def _to_destination_read(destination: Destination, trip: Trip | None) -> DestinationRead:
    """Build the contract's `Destination`, computing `outside_trip_range` fresh — it is never
    stored (research.md R-001-adjacent reasoning: an API-layer check, not a column), so every
    response that includes a Destination has to compute it at read time.
    """
    assert destination.id is not None, "a row loaded from the database always has an id"
    return DestinationRead(
        id=destination.id,
        trip_id=destination.trip_id,
        name=destination.name,
        latitude=destination.latitude,
        longitude=destination.longitude,
        start_date=destination.start_date,
        end_date=destination.end_date,
        status=destination.status,
        created_at=destination.created_at,
        updated_at=destination.updated_at,
        outside_trip_range=_outside_trip_range(destination, trip),
    )


def _trips_by_id(session: SessionDep, destinations: list[Destination]) -> dict[int, Trip]:
    """One bulk lookup for every distinct `trip_id` a page of Destinations references, rather
    than a query per row — the same "load once" instinct `research.md` R-007 states for the
    frontend, applied here to avoid an N+1 on `listDestinations`.
    """
    trip_ids = {d.trip_id for d in destinations if d.trip_id is not None}
    if not trip_ids:
        return {}
    trips = session.exec(select(Trip).where(col(Trip.id).in_(trip_ids))).all()
    return {trip.id: trip for trip in trips if trip.id is not None}


@router.get(
    "",
    response_model=list[DestinationRead],
    responses={401: {"model": ErrorResponse, "description": "No valid token."}},
    summary="List Destinations, optionally narrowed",
)
def list_destinations(
    session: SessionDep,
    _creator: CurrentCreator,
    trip_id: Annotated[
        int | None,
        Query(description="Narrow to one Trip's Destinations (the organising view, User Story 3)."),
    ] = None,
    status: Annotated[DestinationStatus | None, Query(description="FR-010's map filter.")] = None,
) -> list[DestinationRead]:
    """FR-001, FR-010, FR-019. With no query parameters, returns every Destination regardless of
    Trip membership — this is the map's own read, and every Destination renders on it whether or
    not it has a Trip.

    Ordered by `id` ascending — the contract states no ordering requirement for this operation
    (unlike `001`'s content-item list, whose `created_at DESC, id DESC` is contract-documented),
    so this is a determinism choice for consistent test results, not a promise the frontend
    depends on.
    """
    query = select(Destination)

    if trip_id is not None:
        query = query.where(col(Destination.trip_id) == trip_id)

    if status is not None:
        query = query.where(col(Destination.status) == status)

    query = query.order_by(col(Destination.id))

    destinations = list(session.exec(query).all())
    trips = _trips_by_id(session, destinations)
    return [
        _to_destination_read(
            destination,
            None if destination.trip_id is None else trips.get(destination.trip_id),
        )
        for destination in destinations
    ]


@router.get(
    "/{destination_id}",
    response_model=DestinationDetail,
    responses={
        401: {"model": ErrorResponse, "description": "No valid token."},
        404: {"model": ErrorResponse, "description": "No such destination."},
    },
    summary="Read one Destination, with its note and photograph URLs",
)
def get_destination(
    destination_id: int,
    session: SessionDep,
    _creator: CurrentCreator,
) -> DestinationDetail:
    """Always includes `note` and `photographs` regardless of `status` — FR-009's "no gallery on
    a non-Visited pin" is a **frontend** display rule (INV-3, data-model.md), not a reason for
    the API to withhold data that exists. Each photograph's `url` is a presigned GET, minted
    fresh on this call (FR-024) — never a stored or cached link.
    """
    destination = get_or_404(session, destination_id)
    photographs = session.exec(
        select(Photograph)
        .where(col(Photograph.destination_id) == destination_id)
        .order_by(col(Photograph.id))
    ).all()

    photograph_reads = []
    for photograph in photographs:
        assert photograph.id is not None, "a row loaded from the database always has an id"
        photograph_reads.append(
            PhotographRead(
                id=photograph.id,
                url=read_url(photograph.object_key),
                created_at=photograph.created_at,
            )
        )

    trip = None if destination.trip_id is None else session.get(Trip, destination.trip_id)
    read = _to_destination_read(destination, trip)
    return DestinationDetail(
        **read.model_dump(),
        note=destination.note,
        photographs=photograph_reads,
    )


@router.post(
    "",
    response_model=DestinationRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"model": ErrorResponse, "description": "No valid token."},
        422: {"model": ErrorResponse, "description": "Request failed validation."},
    },
    summary="Create a Destination",
)
def create_destination(
    body: DestinationCreate,
    session: SessionDep,
    _creator: CurrentCreator,
) -> DestinationRead:
    """FR-015, FR-020, FR-021. `trip_id` is optional (FR-020) — omit it for a place marked
    independent of any Trip. `latitude`/`longitude` are required on this call: this operation is
    reached **after** `GET /locations/search` has already resolved a name to coordinates
    (FR-011); it does not itself geocode a free-text name.

    **INV-1** (coordinates never null on a stored row) is enforced entirely by
    `DestinationCreate` requiring both fields with no default — there is no code path here that
    can construct a row without them, so there is nothing further to check before the insert
    (data-model.md: unlike `001`'s INV-1, this one has no `CHECK` expressible from the columns
    alone, since (0,0) is a real coordinate).

    **FR-017**'s containment flag is computed here too: a `trip_id` that survived the insert's
    foreign key names a real Trip, so fetching it after `commit()` is guaranteed to find one.
    """
    require_trip_or_422(session, body.trip_id)
    destination = Destination(**body.model_dump())
    session.add(destination)
    session.commit()
    session.refresh(destination)
    trip = None if destination.trip_id is None else session.get(Trip, destination.trip_id)
    return _to_destination_read(destination, trip)


@router.patch(
    "/{destination_id}",
    response_model=DestinationRead,
    responses={
        401: {"model": ErrorResponse, "description": "No valid token."},
        404: {"model": ErrorResponse, "description": "No such destination."},
        422: {"model": ErrorResponse, "description": "Request failed validation."},
    },
    summary="Change one or more fields of a Destination",
)
def update_destination(
    destination_id: int,
    body: DestinationUpdate,
    session: SessionDep,
    _creator: CurrentCreator,
) -> DestinationRead:
    """Partial update, `001`'s semantics — `exclude_unset=True` yields exactly the fields the
    caller sent, including an explicit `null` on `trip_id`/`start_date`/`end_date`/`note`
    (FR-020's detach path among them), and touches nothing else.

    Covers FR-016 (edit), FR-006 (note) and FR-028 (status, any direction — no validation beyond
    `DestinationUpdate` already requiring one of the three enum values). Changing `name` does
    **not** re-geocode; a coordinate only changes when the caller sends new `latitude`/`longitude`
    explicitly, matching the contract's own note that a label edit must never move a pin.

    **FR-017**'s containment flag is recomputed on every update — a date edit, a `trip_id`
    re-attach, or a `trip_id` detach can each flip it, and it is never stored, so there is no
    stale value to invalidate.
    """
    destination = get_or_404(session, destination_id)
    updates = body.model_dump(exclude_unset=True)

    # Only when the caller actually sent `trip_id`: an omitted key means "leave it" and an
    # explicit `null` is FR-020's detach path, neither of which names a Trip to check.
    if "trip_id" in updates:
        require_trip_or_422(session, updates["trip_id"])

    for field, value in updates.items():
        setattr(destination, field, value)

    session.add(destination)
    session.commit()
    session.refresh(destination)
    trip = None if destination.trip_id is None else session.get(Trip, destination.trip_id)
    return _to_destination_read(destination, trip)


@router.delete(
    "/{destination_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        401: {"model": ErrorResponse, "description": "No valid token."},
        404: {"model": ErrorResponse, "description": "No such destination."},
    },
    summary="Delete a Destination and its photographs",
)
def delete_destination(
    destination_id: int,
    session: SessionDep,
    _creator: CurrentCreator,
) -> None:
    """FR-016. Cascades to `photograph` rows via `ON DELETE CASCADE` (data-model.md) — nothing
    here has to delete them explicitly. Does **not** touch the parent Trip, if any.

    No return annotation of `Response` and no `response_model`, matching `trips.py`'s
    `delete_trip`: a 204 must carry no body.
    """
    session.delete(get_or_404(session, destination_id))
    session.commit()
