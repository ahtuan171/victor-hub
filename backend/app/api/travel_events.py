"""Module 02 (Travel Schedule) — the TravelEvent routes: CRUD plus a date-range/type/trip filter.

Built from `Module_02_Travel_Schedule_Spec.md` rather than a ratified `spec.md` — see the owner's
explicit instruction recorded in this iteration's history to bypass the speckit workflow for this
module. Shaped after `trips.py` and `destinations.py`'s own routes (shared `get_or_404`, partial
`PATCH` via `exclude_unset=True`, a 422 — not 404 — when a body's `trip_id` names no Trip) so this
resource does not invent a second convention for the same problems those two already solved.

§17's service-function list (`create_travel_event`, `get_events_by_date_range`, …) is answered by
these routes plus the query filters below, not by a separate service layer — the existing
`trips.py`/`destinations.py` routes are themselves the "clean application/service functions" that
section asks for, and a Module 03 AI layer (not built here) would call these same endpoints.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import col, select

from app.auth import CurrentCreator
from app.db import SessionDep
from app.models import TravelEvent, TravelEventType, Trip
from app.schemas import ErrorResponse, TravelEventCreate, TravelEventRead, TravelEventUpdate

router = APIRouter(prefix="/travel-events", tags=["travel-events"])


def get_or_404(session: SessionDep, event_id: int) -> TravelEvent:
    """Fetch one TravelEvent or raise the contract's 404 — matching `trips.py`/`destinations.py`'s
    own helper of the same name.
    """
    event = session.get(TravelEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="No such travel event.")
    return event


def require_trip_or_422(session: SessionDep, trip_id: int | None) -> None:
    """Refuse a body whose `trip_id` names no Trip, before the insert reaches the foreign key.

    Verbatim the same guard `destinations.py` carries, and for the same reason: without it, the
    `ON DELETE CASCADE` foreign key raises `IntegrityError` at `commit()`, which `app/main.py` has
    no handler for, so it would otherwise surface as an uncaught `500` rather than the uniform
    `{"detail": "<string>"}` body every other 4xx in this API returns.
    """
    if trip_id is None:
        return
    if session.get(Trip, trip_id) is None:
        raise HTTPException(status_code=422, detail="No such trip.")


@router.get(
    "",
    response_model=list[TravelEventRead],
    responses={401: {"model": ErrorResponse, "description": "No valid token."}},
    summary="List TravelEvents, optionally narrowed by trip, type, or date range",
)
def list_travel_events(
    session: SessionDep,
    _creator: CurrentCreator,
    trip_id: Annotated[int | None, Query(description="Narrow to one Trip's events.")] = None,
    event_type: Annotated[
        TravelEventType | None, Query(description="Narrow to one event type.")
    ] = None,
    date_from: Annotated[
        date | None, Query(description="Inclusive lower bound on `event_date`.")
    ] = None,
    date_to: Annotated[
        date | None, Query(description="Inclusive upper bound on `event_date`.")
    ] = None,
) -> list[TravelEvent]:
    """No pagination — constitution VII's single-owner scope makes a personal number of travel
    events the only volume this has to handle, the same reasoning `list_trips` already states.
    """
    query = select(TravelEvent)
    if trip_id is not None:
        query = query.where(col(TravelEvent.trip_id) == trip_id)
    if event_type is not None:
        query = query.where(col(TravelEvent.event_type) == event_type)
    if date_from is not None:
        query = query.where(col(TravelEvent.event_date) >= date_from)
    if date_to is not None:
        query = query.where(col(TravelEvent.event_date) <= date_to)
    query = query.order_by(col(TravelEvent.event_date), col(TravelEvent.id))
    return list(session.exec(query).all())


@router.post(
    "",
    response_model=TravelEventRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"model": ErrorResponse, "description": "No valid token."},
        422: {
            "model": ErrorResponse,
            "description": "Request failed validation, or `trip_id` names no Trip.",
        },
    },
    summary="Create a TravelEvent",
)
def create_travel_event(
    body: TravelEventCreate,
    session: SessionDep,
    _creator: CurrentCreator,
) -> TravelEvent:
    require_trip_or_422(session, body.trip_id)
    event = TravelEvent(**body.model_dump())
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


@router.get(
    "/{event_id}",
    response_model=TravelEventRead,
    responses={
        401: {"model": ErrorResponse, "description": "No valid token."},
        404: {"model": ErrorResponse, "description": "No such travel event."},
    },
    summary="Read one TravelEvent",
)
def get_travel_event(event_id: int, session: SessionDep, _creator: CurrentCreator) -> TravelEvent:
    return get_or_404(session, event_id)


@router.patch(
    "/{event_id}",
    response_model=TravelEventRead,
    responses={
        401: {"model": ErrorResponse, "description": "No valid token."},
        404: {"model": ErrorResponse, "description": "No such travel event."},
        422: {
            "model": ErrorResponse,
            "description": "Request failed validation, or `trip_id` names no Trip.",
        },
    },
    summary="Change one or more fields of a TravelEvent",
)
def update_travel_event(
    event_id: int,
    body: TravelEventUpdate,
    session: SessionDep,
    _creator: CurrentCreator,
) -> TravelEvent:
    event = get_or_404(session, event_id)
    updates = body.model_dump(exclude_unset=True)

    if "trip_id" in updates:
        require_trip_or_422(session, updates["trip_id"])

    for field, value in updates.items():
        setattr(event, field, value)

    session.add(event)
    session.commit()
    session.refresh(event)
    return event


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        401: {"model": ErrorResponse, "description": "No valid token."},
        404: {"model": ErrorResponse, "description": "No such travel event."},
    },
    summary="Delete a TravelEvent",
)
def delete_travel_event(event_id: int, session: SessionDep, _creator: CurrentCreator) -> None:
    session.delete(get_or_404(session, event_id))
    session.commit()
