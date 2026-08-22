"""The preferences routes — `GET` and `PATCH /preferences` (002-pixel-arcade-skin).

Two operations, both scoped to the authenticated account's own row and taking no identifier from the
request (INV-1 in `specs/002-pixel-arcade-skin/data-model.md`): there is one creator, and the token
names it.

There is no invariant to check at this boundary — neither `theme` nor `sound_enabled` interacts
with the other, and both are `NOT NULL` with a default, so there is no state the database can be
asked to reach that is not already valid. `PreferencesUpdate`'s own validation (`minProperties: 1`,
`additionalProperties: false`) does the whole job.
"""

from fastapi import APIRouter

from app.auth import CurrentCreator
from app.db import SessionDep
from app.models import Creator
from app.schemas import ErrorResponse, PreferencesRead, PreferencesUpdate

router = APIRouter(prefix="/preferences", tags=["preferences"])


@router.get(
    "",
    response_model=PreferencesRead,
    responses={401: {"model": ErrorResponse, "description": "No valid token."}},
    summary="Read the account's presentation and sound choices",
)
def get_preferences(creator: CurrentCreator) -> Creator:
    """Returns the authenticated account's own preferences.

    `creator` is the row `CurrentCreator` already resolved to check the token, so this handler reads
    no second time — the columns are already on the object FastAPI is about to serialise through
    `PreferencesRead`.
    """
    return creator


@router.patch(
    "",
    response_model=PreferencesRead,
    responses={
        401: {"model": ErrorResponse, "description": "No valid token."},
        422: {"model": ErrorResponse, "description": "Request failed validation."},
    },
    summary="Change one or both choices",
)
def update_preferences(
    body: PreferencesUpdate,
    session: SessionDep,
    creator: CurrentCreator,
) -> Creator:
    """Partial update: an omitted key means "leave it" (contract: same semantics as
    `PATCH /trips/{trip_id}` — neither field here is nullable).

    `exclude_unset=True` is what makes this partial rather than a full replacement: it yields only
    the fields the caller actually sent, so a request naming just `theme` cannot silently reset
    `sound_enabled` to whatever the model default happens to be.

    Last write wins, with no version marker (FR-023a's answer in 001, restated for this row in
    data-model.md) — the only person who can overwrite this owner is the same owner on another
    device.

    Returns the full object, not the diff, so a caller never has to reconstruct the new state from
    what it sent.
    """
    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(creator, field, value)

    session.add(creator)
    session.commit()
    session.refresh(creator)
    return creator


__all__ = ["router"]
