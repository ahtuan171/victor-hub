"""Response models shared across routers.

Only what more than one module needs. Request and response models specific to a single resource stay
with that resource's router — `LoginRequest` and `TokenResponse` belong in `app/api/auth.py`.

This module exists because `ErrorResponse` acquired a second caller: `app/main.py` declares it as
the global 422 model, and every router declares it on its own 4xx responses. Defining it in
`main.py` would make the routers import the application they are mounted on.

`PreferencesRead` and `PreferencesUpdate` (002-pixel-arcade-skin) live here for the same reason, not
despite it: `app/api/preferences.py` is their first caller, and `app/api/auth.py`'s login response
is their second (T012 — the amended login response optionally carries a `Preferences` body).
Putting them in `preferences.py` would make `auth.py` import a sibling router module for a response
model, the same shape of mistake `ErrorResponse` living in `main.py` would have been.

**003-travel-map's Trip/Destination/Photograph/LocationCandidate models live here too** —
`tasks.md`'s T005 places them in this shared module rather than with their own routers because
`Photograph` and `DestinationDetail` are each read by more than one router file (`destinations.py`
and `photographs.py`), the same multi-caller reason `ErrorResponse` and the Preferences pair are
here.
"""

from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import DestinationStatus, Theme, TravelEventType, TripStatus


class ErrorResponse(BaseModel):
    """The contract's `Error`. One shape for every 4xx in this API, without exception.

    `contracts/openapi.yaml` promises `{"detail": "<string>"}` everywhere, and the typed client
    generated from it at T023 types `detail` as a string. Two separate things have to hold for that
    promise to be true, and they fail independently:

    * the **runtime body** — FastAPI's `RequestValidationError` returns `detail` as an array of
      objects, which the handler in `app/main.py` flattens;
    * the **generated document** — a route that declares a 4xx without a model advertises no body at
      all, so a generated client is left guessing at the one response it most needs to render.

    Declaring this model on every 4xx is what closes the second half. `tests/test_errors.py` asserts
    both, because the handler fixes only one of them and reading the code cannot tell you which.
    """

    detail: str




class PreferencesRead(BaseModel):
    """The contract's `Preferences`. Both fields always present, never null.

    `theme` and `sound_enabled` are `NOT NULL` with defaults on `creator` (data-model.md,
    002-pixel-arcade-skin), so "never chosen" and "chosen, and it is the default" are the same value
    on the wire — there is no third state to represent.
    """

    theme: Theme
    sound_enabled: bool


class PreferencesUpdate(BaseModel):
    """The contract's `PreferencesUpdate`: at least one key, and no unknown ones.

    Neither field is nullable — an explicit `null` is a validation
    failure rather than a third meaning, because neither column can be cleared (data-model.md: "no
    third state that no requirement reads"). `extra="forbid"` is the contract's
    `additionalProperties: false`: without it, a client that misspells `sound_enabled` would get a
    200 describing a change that never happened, because FastAPI ignores unknown body keys by
    default.

    The generated request schema is looser than the contract, deliberately and safely - the same
    shape as `PublishedUrl`'s date-string looseness in `backend/AGENTS.md`. The contract types both
    properties as their bare, non-nullable schema (`$ref: Theme`, `type: boolean`); this model's
    Python annotations are `Theme | None` / `bool | None` so the generated schema advertises `null`
    as an accepted value where the contract does not. What matters is that no `null` is ever
    accepted at runtime: `at_least_one_field` below refuses one with a 422, the same status the
    contract's tighter schema would produce. Loosening the document rather than the behaviour is
    accepted here, not a reason to amend the contract.
    """

    model_config = ConfigDict(extra="forbid")

    theme: Theme | None = None
    sound_enabled: bool | None = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "PreferencesUpdate":
        """The contract's `minProperties: 1` and its "no null spelling" rule, in one place.

        An empty body is refused rather than treated as a no-op 200: a `PATCH` that changed nothing
        and answered 200 is indistinguishable from one that worked.

        Both fields are typed `Theme | None` / `bool | None` only so the omitted case can be told
        apart from the sent case via `model_fields_set` — not because either may hold `null` on the
        wire. A field present in `model_fields_set` with a value of `None` was sent as an explicit
        `null`, which the contract refuses: neither column can be cleared, so there is no "unset"
        meaning for `null` to carry.
        """
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        nulled = [field for field in self.model_fields_set if getattr(self, field) is None]
        if nulled:
            raise ValueError(f"{', '.join(sorted(nulled))} may not be set to null.")
        return self


# --- 003-travel-map -------------------------------------------------------------------------


class TripCreate(BaseModel):
    """The contract's `TripCreate`. `name`/`start_date`/`end_date` are required (FR-014);
    `status` defaults to `wishlist`, matching `trip.status`'s own column default.

    `destination` and `notes` (Module 02, §14.1) are both optional — additive fields on top of
    003's own required set, not a new requirement on every Trip.
    """

    name: str = Field(max_length=200)
    destination: str | None = Field(default=None, max_length=200)
    start_date: date
    end_date: date
    status: TripStatus = TripStatus.WISHLIST
    notes: str | None = None


class TripUpdate(BaseModel):
    """The contract's `TripUpdate`: at least one key, no unknown ones, and — unlike
    `DestinationUpdate` — **no field here may be sent as an explicit null**. None of `trip`'s
    columns are nullable (data-model.md), so every field in this model has the same "no null
    spelling" rule `PreferencesUpdate` states for both of its own fields.

    `destination` and `notes` are the one exception: both are genuinely nullable columns (Module
    02), so — like `DestinationUpdate`'s own nullable fields below — they are exempted from the
    "no null" validator rather than forced to always carry a value.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=200)
    destination: str | None = Field(default=None, max_length=200)
    start_date: date | None = None
    end_date: date | None = None
    status: TripStatus | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "TripUpdate":
        """The contract's `minProperties: 1` plus its "no null spelling" rule for every field
        except `destination`/`notes`, which are allowed to null out on purpose (clearing either
        back to unset).
        """
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        not_nullable = self.model_fields_set - {"destination", "notes"}
        nulled = [field for field in not_nullable if getattr(self, field) is None]
        if nulled:
            raise ValueError(f"{', '.join(sorted(nulled))} may not be set to null.")
        return self


class TripRead(BaseModel):
    """The contract's `Trip` — the single response model for every route in `app/api/trips.py`.

    Named `TripRead`, not `Trip`: `app/models.py` already has a SQLModel table class called
    `Trip`, and a router needs to import both (`Trip.id` there is `int | None` until the insert;
    this model's `id` is the required `int` the contract promises).
    """

    id: int
    name: str
    destination: str | None
    start_date: date
    end_date: date
    status: TripStatus
    notes: str | None
    created_at: datetime
    updated_at: datetime


# --- Module 02 (Travel Schedule) --------------------------------------------------------------
#
# Built from `Module_02_Travel_Schedule_Spec.md` rather than a ratified spec.md — see the owner's
# explicit instruction recorded in this iteration's history to bypass the speckit workflow.


class TravelEventCreate(BaseModel):
    """`trip_id`/`title`/`event_date`/`event_type` are required (§14 — every form asks for a
    title and a date at minimum); every per-type field is optional and unvalidated against
    `event_type` — the table does not enforce which columns a given type uses, and neither does
    this model (see `TravelEvent`'s own docstring).
    """

    trip_id: int | None = None
    event_type: TravelEventType
    title: str = Field(max_length=200)
    event_date: date
    start_time: time | None = None
    location: str | None = Field(default=None, max_length=200)
    from_location: str | None = Field(default=None, max_length=120)
    to_location: str | None = Field(default=None, max_length=120)
    booking_reference: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=60)
    notes: str | None = None


class TravelEventUpdate(BaseModel):
    """Partial update, `TripUpdate`'s own shape: at least one key, no unknown ones. Every field
    here is a genuinely nullable column, so — unlike `TripUpdate` — nothing is exempted from
    accepting an explicit null; clearing `location` back to unset is a legitimate edit.
    """

    model_config = ConfigDict(extra="forbid")

    trip_id: int | None = None
    event_type: TravelEventType | None = None
    title: str | None = Field(default=None, max_length=200)
    event_date: date | None = None
    start_time: time | None = None
    location: str | None = Field(default=None, max_length=200)
    from_location: str | None = Field(default=None, max_length=120)
    to_location: str | None = Field(default=None, max_length=120)
    booking_reference: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=60)
    notes: str | None = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "TravelEventUpdate":
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        return self


class TravelEventRead(BaseModel):
    """The response model for every route in `app/api/travel_events.py`."""

    id: int
    trip_id: int | None
    event_type: TravelEventType
    title: str
    event_date: date
    start_time: time | None
    location: str | None
    from_location: str | None
    to_location: str | None
    booking_reference: str | None
    category: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class DestinationCreate(BaseModel):
    """The contract's `DestinationCreate`. `name`/`latitude`/`longitude` are required — this
    operation is reached **after** `GET /locations/search` has already resolved a name to
    coordinates (FR-011); it does not itself geocode. `trip_id` is optional (FR-020); `status`
    defaults to `wishlist`, matching `destination.status`'s own column default.
    """

    trip_id: int | None = None
    name: str = Field(max_length=200)
    latitude: float
    longitude: float
    start_date: date | None = None
    end_date: date | None = None
    status: DestinationStatus = DestinationStatus.WISHLIST
    note: str | None = None


class DestinationUpdate(BaseModel):
    """The contract's `DestinationUpdate`: at least one key, no unknown ones, and a **mixed**
    null-spelling rule. `trip_id`, `start_date`,
    `end_date` and `note` are nullable on `destination` (data-model.md), so an explicit `null`
    on any of those four clears it — `trip_id: null` is FR-020's detach. `name`, `latitude`,
    `longitude` and `status` back `NOT NULL` columns and may not be sent as `null`.
    """

    model_config = ConfigDict(extra="forbid")

    trip_id: int | None = None
    name: str | None = Field(default=None, max_length=200)
    latitude: float | None = None
    longitude: float | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: DestinationStatus | None = None
    note: str | None = None

    _NEVER_NULL = ("name", "latitude", "longitude", "status")

    @model_validator(mode="after")
    def at_least_one_field(self) -> "DestinationUpdate":
        """The contract's `minProperties: 1`, plus refusing `null` on the four fields that back
        a `NOT NULL` column. `trip_id`/`start_date`/`end_date`/`note` are exempt — sending those
        as `null` is a real clear, not a mistake.
        """
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        nulled = [
            field
            for field in self.model_fields_set
            if field in self._NEVER_NULL and getattr(self, field) is None
        ]
        if nulled:
            raise ValueError(f"{', '.join(sorted(nulled))} may not be set to null.")
        return self


class DestinationRead(BaseModel):
    """The contract's `Destination`. Every nullable field is always emitted — *stricter* than the
    contract's optional-but-nullable properties (`backend/AGENTS.md`) — no client written against
    the contract breaks.

    Named `DestinationRead`, not `Destination` — see `TripRead`'s docstring; `app/models.py`'s
    `Destination` is the SQLModel table class this reads from.
    """

    id: int
    trip_id: int | None
    name: str
    latitude: float
    longitude: float
    start_date: date | None
    end_date: date | None
    status: DestinationStatus
    created_at: datetime
    updated_at: datetime
    outside_trip_range: bool
    """FR-017. True when this Destination's own dates fall outside its Trip's — computed fresh on
    every response by `app/api/destinations.py`, never a stored column (data-model.md: the check
    needs both rows loaded, which a single-table `CHECK` cannot express). Always `False` when
    `trip_id` is null or either of this Destination's own dates is null — there is nothing to
    compare (Trip's own dates are `NOT NULL`, data-model.md)."""


class PhotographRead(BaseModel):
    """The contract's `Photograph`. `url` is a presigned GET, minted fresh on every response
    that includes it (FR-024) — never stored, so there is nothing to keep in sync with R2.

    Named `PhotographRead`, not `Photograph` — see `TripRead`'s docstring; `app/models.py`'s
    `Photograph` is the SQLModel table class this reads from.
    """

    id: int
    url: str
    created_at: datetime


class DestinationDetail(DestinationRead):
    """The contract's `DestinationDetail`: `Destination` plus `note` and `photographs`.

    Always includes both regardless of `status` — FR-009's "no gallery on a non-Visited pin" is
    a **frontend** display rule (INV-3, data-model.md), not a reason for the API to withhold
    data that exists.
    """

    note: str | None
    photographs: list[PhotographRead]


class PhotographCreate(BaseModel):
    """The contract's `PhotographCreate`. Sent **after** the browser has already `PUT` the image
    bytes to the presigned URL from `POST .../photos/upload-url` — this carries only the
    `object_key` that upload already used, never image bytes (FR-023, FR-025).
    """

    object_key: str = Field(max_length=512)


class PhotoUploadUrl(BaseModel):
    """The contract's `PhotoUploadUrl`. `upload_url` is a presigned `PUT` the browser uploads
    directly to R2 — this backend never receives the image (`tech-defaults.md`'s Object Storage
    section).
    """

    upload_url: str
    object_key: str = Field(max_length=512)
    expires_at: datetime


class LocationCandidate(BaseModel):
    """The contract's `LocationCandidate`. One geocoding match, as returned by
    `GET /locations/search` (FR-011, FR-012) — `app/services/geocoding.py` is the only producer.
    """

    name: str
    address: str
    latitude: float
    longitude: float
