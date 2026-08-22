"""One error shape, everywhere — the promise `contracts/openapi.yaml` makes in its own preamble.

    Error bodies are uniformly `{"detail": "<string>"}`.

That sentence is load-bearing rather than decorative: the typed client generated at T023 types
`detail` as a string, so anything else renders `[object Object]` in front of the creator. Two
separate mechanisms have to hold for it to be true, and they fail independently.

* **The runtime body.** FastAPI's `RequestValidationError` returns `detail` as an *array of
  objects*. `app/main.py` installs a handler that flattens it.
* **The generated document.** A route that declares a 4xx with no model advertises no body at all,
  and a client generated from that document is left guessing at the one response it most needs to
  render. Declaring `ErrorResponse` on every 4xx is what closes this half.

The handler fixes the first and does nothing for the second, which is why both are asserted here.
Reading the code cannot tell you which one you have — the only reliable check is the generated
`openapi.json` itself, and that is a thing this project has already got wrong once.

The four Starlette-generated responses matter as much as our own. `404` and `405` never reach any
handler in `app/`, so "uniformly" is a claim about a framework default as much as about our code.
"""

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import Creator

CONTRACTED_ERROR_KEYS = {"detail"}
"""Exactly one key. Not "at least" — FR-002 and SC-006 say a 401 carries no content data of any
kind, and an error body that grew a `field` or an `errors` array would break the generated client's
type as surely as an array-shaped `detail` would."""

CONTRACTED_INVARIANT_ERROR_KEYS = {"code", "detail"}
"""The `{code, detail}` shape a 409 carries — currently unreachable, since the one thing that
produced a 409 (Content Calendar's INV-1) was removed 2026-08-22. Kept rather than deleted: no
other status code shares this key set, so `expected_keys_for` stays a correct, generic answer for
whichever future route next needs a 409 to distinguish two failure reasons for the caller, the
same job `platform_required`/`platform_locked` did.

Each status code has exactly one legal key set, chosen by `expected_keys_for`, so a 401 that grew
a `code` still fails and a third shape cannot appear anywhere without being declared here first.
"""


def expected_keys_for(status_code: int) -> set[str]:
    """The one legal body shape for a status code.

    A function rather than a per-case parameter so that a 409 added to `REACHABLE_4XX` later cannot
    be registered with the wrong expectation — the shape follows from the contract, not from whoever
    writes the test.
    """
    return CONTRACTED_INVARIANT_ERROR_KEYS if status_code == 409 else CONTRACTED_ERROR_KEYS


def assert_matches_the_contracted_error_shape(response: Any) -> None:
    """The whole of `components.schemas.Error` — or of `InvariantError` on a 409 — in one place.

    Written as a helper rather than repeated so that the shape has exactly one definition in this
    file. If the contract ever gains a field, this is the only line that changes — and every case
    below starts asserting it at once, which is the point.
    """
    assert 400 <= response.status_code < 500, f"not a 4xx: {response.status_code}"
    assert response.headers["content-type"].startswith("application/json"), (
        "an error rendered as HTML is an error the generated client cannot read at all"
    )

    expected_keys = expected_keys_for(response.status_code)

    body = response.json()
    assert isinstance(body, dict), f"error body is {type(body).__name__}, not an object"
    assert set(body) == expected_keys, (
        f"{response.status_code} body has keys {sorted(set(body))}, "
        f"contract says {sorted(expected_keys)}"
    )
    assert isinstance(body["detail"], str), (
        f"detail is {type(body['detail']).__name__}, not a string - this is the array-shaped "
        "RequestValidationError leaking past the handler in app/main.py"
    )
    assert body["detail"].strip(), "detail is present but empty, which tells the creator nothing"


# Every 4xx this API can currently produce. Each new 4xx must be registered here as well as in the
# test file for its own route — the by-id 404s arrived that way at T049 and T050.
REACHABLE_4XX = [
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/auth/login", json={"email": creator.email, "password": "not the password"}
        ),
        401,
        id="login-wrong-password",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/auth/login", json={"email": "nobody@example.com", "password": "irrelevant"}
        ),
        401,
        id="login-unknown-email",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post("/auth/logout"),
        401,
        id="logout-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/auth/login", json={"email": creator.email}
        ),
        422,
        id="login-missing-password",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/auth/login", json={"password": "irrelevant"}
        ),
        422,
        id="login-missing-email",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/auth/login", json={"email": creator.email, "password": ""}
        ),
        422,
        id="login-empty-password",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/auth/login", json={"email": "not-an-email", "password": "irrelevant"}
        ),
        422,
        id="login-malformed-email",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/auth/login", json={"email": 7, "password": ["a", "list"]}
        ),
        422,
        id="login-wrong-types",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/auth/login", json=["not", "an", "object"]
        ),
        422,
        id="login-body-is-an-array",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/auth/login",
            content=b"{this is not json",
            headers={"Content-Type": "application/json"},
        ),
        422,
        id="login-unparseable-json",
    ),
    # 002-pixel-arcade-skin: the preferences routes. Both are scoped to the authenticated account's
    # own row and take no identifier (INV-1, data-model.md), so the only 4xx either can produce
    # without a dedicated request body is the shared no-credential 401 — the 422 cases (empty body,
    # unknown key) live in test_preferences.py, which is about that endpoint's own validation rather
    # than the uniform error shape this file pins.
    pytest.param(
        lambda client, auth_client, creator: client.get("/preferences"),
        401,
        id="get-preferences-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.patch("/preferences", json={"theme": "light"}),
        401,
        id="update-preferences-no-credential",
    ),
    # 003-travel-map, T012/T013: listDestinations/createDestination. INV-1 (coordinates never
    # null on a stored row) is enforced entirely by DestinationCreate requiring both fields with
    # no default, so a body missing them is a 422 rather than a 409 — there is no invariant to
    # violate once the request model itself refuses the write.
    pytest.param(
        lambda client, auth_client, creator: client.get("/destinations"),
        401,
        id="list-destinations-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/destinations", json={"name": "Kyoto", "latitude": 35.0, "longitude": 135.0}
        ),
        401,
        id="create-destination-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.post(
            "/destinations", json={"name": "Kyoto"}
        ),
        422,
        id="create-destination-missing-coordinates",
    ),
    # T023-T025, User Story 2: getDestination/updateDestination/deleteDestination. Every one of
    # these is id-addressed, so each carries both a no-credential 401 and a missing-id 404 — the
    # shared `get_or_404` in `destinations.py` is what makes "no such destination" identical
    # across all three.
    pytest.param(
        lambda client, auth_client, creator: client.get("/destinations/1"),
        401,
        id="get-destination-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.get("/destinations/999999"),
        404,
        id="get-destination-missing-id",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.patch("/destinations/1", json={"note": "x"}),
        401,
        id="update-destination-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.patch(
            "/destinations/999999", json={"note": "x"}
        ),
        404,
        id="update-destination-missing-id",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.patch("/destinations/1", json={}),
        422,
        id="update-destination-empty-body",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.delete("/destinations/1"),
        401,
        id="delete-destination-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.delete("/destinations/999999"),
        404,
        id="delete-destination-missing-id",
    ),
    # T026-T028, User Story 2: the photograph routes. Every 4xx here is reachable *before* the
    # stubbed object-storage boundary — a no-credential or missing-destination request never
    # reaches `create_upload_url`/`read_url`, so this file needs no R2 stub of its own.
    pytest.param(
        lambda client, auth_client, creator: client.post("/destinations/1/photos/upload-url"),
        401,
        id="create-photo-upload-url-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.post(
            "/destinations/999999/photos/upload-url"
        ),
        404,
        id="create-photo-upload-url-missing-destination",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/destinations/1/photos", json={"object_key": "x"}
        ),
        401,
        id="create-photograph-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.post(
            "/destinations/999999/photos", json={"object_key": "x"}
        ),
        404,
        id="create-photograph-missing-destination",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.post("/destinations/1/photos", json={}),
        422,
        id="create-photograph-missing-object-key",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.delete("/destinations/1/photos/1"),
        401,
        id="delete-photograph-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.delete("/destinations/999999/photos/1"),
        404,
        id="delete-photograph-missing-destination",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.delete("/destinations/1/photos/999999"),
        404,
        id="delete-photograph-missing-photograph",
    ),
    # 003-travel-map, T036/T037, User Story 3: the Trip routes. Same shape as the Destination
    # 4xx cases above — a shared `get_or_404` in `trips.py` makes "no such trip" identical
    # whichever verb asked.
    pytest.param(
        lambda client, auth_client, creator: client.get("/trips"),
        401,
        id="list-trips-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/trips", json={"name": "x", "start_date": "2026-09-01", "end_date": "2026-09-15"}
        ),
        401,
        id="create-trip-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.post("/trips", json={"name": "x"}),
        422,
        id="create-trip-missing-fields",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.get("/trips/1"),
        401,
        id="get-trip-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.get("/trips/999999"),
        404,
        id="get-trip-missing-id",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.patch("/trips/1", json={"status": "booked"}),
        401,
        id="update-trip-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.patch(
            "/trips/999999", json={"status": "booked"}
        ),
        404,
        id="update-trip-missing-id",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.patch("/trips/1", json={}),
        422,
        id="update-trip-empty-body",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.delete("/trips/1"),
        401,
        id="delete-trip-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.delete("/trips/999999"),
        404,
        id="delete-trip-missing-id",
    ),
    # Module 02 (Travel Schedule) — the TravelEvent routes. Same shape as the Trip 4xx cases
    # above — a shared `get_or_404` in `travel_events.py` makes "no such travel event" identical
    # whichever verb asked.
    pytest.param(
        lambda client, auth_client, creator: client.get("/travel-events"),
        401,
        id="list-travel-events-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.post(
            "/travel-events", json={"event_type": "note", "title": "x", "event_date": "2026-09-01"}
        ),
        401,
        id="create-travel-event-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.post(
            "/travel-events", json={"title": "x"}
        ),
        422,
        id="create-travel-event-missing-fields",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.post(
            "/travel-events",
            json={
                "trip_id": 999999,
                "event_type": "note",
                "title": "x",
                "event_date": "2026-09-01",
            },
        ),
        422,
        id="create-travel-event-missing-trip",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.get("/travel-events/1"),
        401,
        id="get-travel-event-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.get("/travel-events/999999"),
        404,
        id="get-travel-event-missing-id",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.patch("/travel-events/1", json={"title": "x"}),
        401,
        id="update-travel-event-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.patch(
            "/travel-events/999999", json={"title": "x"}
        ),
        404,
        id="update-travel-event-missing-id",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.patch("/travel-events/1", json={}),
        422,
        id="update-travel-event-empty-body",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.delete("/travel-events/1"),
        401,
        id="delete-travel-event-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.delete("/travel-events/999999"),
        404,
        id="delete-travel-event-missing-id",
    ),
    # T038, User Story 3: searchLocations. The 502 (Nominatim unreachable) is not a 4xx, so it
    # has no entry here — `test_locations.py` covers it on its own.
    pytest.param(
        lambda client, auth_client, creator: client.get("/locations/search", params={"q": "x"}),
        401,
        id="search-locations-no-credential",
    ),
    pytest.param(
        lambda client, auth_client, creator: auth_client.get("/locations/search", params={"q": ""}),
        422,
        id="search-locations-empty-query",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.get("/no/such/path"),
        404,
        id="starlette-not-found",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.get("/auth/login"),
        405,
        id="starlette-method-not-allowed",
    ),
    pytest.param(
        lambda client, auth_client, creator: client.delete("/health"),
        405,
        id="starlette-method-not-allowed-on-health",
    ),
]


@pytest.mark.parametrize(("send", "expected_status"), REACHABLE_4XX)
def test_every_reachable_4xx_matches_the_contracted_shape(
    client: TestClient,
    auth_client: TestClient,
    creator: Creator,
    send: Any,
    expected_status: int,
) -> None:
    """The uniformity claim, case by case.

    The status code is asserted alongside the shape because a case that silently stopped producing
    the error it was written for would still pass the shape check — a 200 would not, but a 401 where
    a 422 was intended would, and the two are not interchangeable to a client.

    Both clients are handed to every case since T030. The content-item routes are the first that can
    fail *after* authenticating, so a 422 and a 409 there are only reachable with a token — while
    the 401 cases are only reachable without one, and a case that quietly used the wrong client
    would assert the shape of a response it was not written about.
    """
    response = send(client, auth_client, creator)

    assert response.status_code == expected_status
    assert_matches_the_contracted_error_shape(response)


# ---------------------------------------------------------------------------
# The array-shaped detail, specifically
# ---------------------------------------------------------------------------


def test_a_multi_field_validation_failure_is_one_string_not_a_list(client: TestClient) -> None:
    """The exact defect the handler exists for, provoked deliberately.

    An empty body fails both fields at once, so FastAPI's own `detail` would be a two-element array
    of objects. This is the case a single-field test cannot distinguish from a working
    implementation: a handler that returned `errors[0]` would pass that one and fail this.
    """
    response = client.post("/auth/login", json={})

    body = response.json()
    assert response.status_code == 422
    assert isinstance(body["detail"], str)
    assert "email" in body["detail"]
    assert "password" in body["detail"]


def test_the_flattened_message_keeps_the_field_name(client: TestClient) -> None:
    """`app/main.py` keeps the field path on purpose, and the reason is a product one.

    "value is not a valid email address" is unusable on a form with more than one field. The login
    form has two. Dropping the prefix would be an easy "simplification" that costs nothing visible
    in a test asserting only the type of `detail`.
    """
    response = client.post("/auth/login", json={"email": "not-an-email", "password": "irrelevant"})

    assert response.json()["detail"].startswith("email:")


def test_the_request_part_is_dropped_from_the_message(client: TestClient) -> None:
    """FastAPI's `loc` is `("body", "email")`. The creator does not need to be told "body"."""
    response = client.post("/auth/login", json={"email": "not-an-email", "password": "irrelevant"})

    assert not response.json()["detail"].startswith("body")


# ---------------------------------------------------------------------------
# The generated document — the half the handler does not fix
# ---------------------------------------------------------------------------


@pytest.fixture
def generated_document(app: FastAPI) -> Any:
    """A freshly generated `openapi.json`.

    The cache is cleared on both sides because it is application-wide state: another test file
    mounts a route and clears it on teardown, and a document generated before that happened would
    be a different document. Regenerating costs milliseconds and removes the ordering question.
    """
    app.openapi_schema = None
    document = app.openapi()
    app.openapi_schema = None
    return document


def test_the_generated_document_declares_a_body_for_every_4xx(generated_document: Any) -> None:
    """Every declared 4xx must reference a schema, not merely carry a description.

    This is the assertion that would have caught the state of things before T020: `/auth/login`
    declared a 401 with a description and no model, so the generated document promised no body at
    all for the response the login form most needs to render, and `/auth/logout` declared no 401
    whatsoever. A description is for a human reading the docs; a client is built from the schema.
    """
    undeclared = []
    for path, operations in generated_document["paths"].items():
        for method, operation in operations.items():
            for code, response in operation["responses"].items():
                if not code.startswith("4"):
                    continue
                schema = response.get("content", {}).get("application/json", {}).get("schema")
                if schema is None:
                    undeclared.append(f"{method.upper()} {path} {code}")

    assert not undeclared, f"4xx responses with no body schema: {undeclared}"


def test_every_declared_4xx_uses_the_error_schema_its_status_code_calls_for(
    generated_document: Any,
) -> None:
    """Uniformity in the document, not just in the bodies.

    Two endpoints returning two differently-shaped errors would each be individually valid and
    together make the contract's "uniformly" false. Asserting the `$ref` rather than the resolved
    shape is deliberate: it fails if an *undeclared* error model is introduced, which is the thing
    being prevented.

    No route currently declares a 409 (the one thing that did, Content Calendar's INV-1, was
    removed — see `CONTRACTED_INVARIANT_ERROR_KEYS`'s own docstring), so `expected` below is built
    from whatever status codes `refs_by_status` actually contains rather than a hard-coded set —
    the assertion still holds if a future 409 reintroduces the invariant shape, without this test
    needing to change.
    """
    refs_by_status: dict[str, set[str | None]] = {}
    for operations in generated_document["paths"].values():
        for operation in operations.values():
            for code, response in operation["responses"].items():
                if not code.startswith("4"):
                    continue
                ref = response["content"]["application/json"]["schema"].get("$ref")
                refs_by_status.setdefault(code, set()).add(ref)

    expected = {
        code: {
            "#/components/schemas/InvariantErrorResponse"
            if code == "409"
            else "#/components/schemas/ErrorResponse"
        }
        for code in refs_by_status
    }

    assert refs_by_status == expected


def test_the_error_schema_types_detail_as_a_required_string(generated_document: Any) -> None:
    """What the generated client is actually built from."""
    schema = generated_document["components"]["schemas"]["ErrorResponse"]

    assert schema["properties"]["detail"]["type"] == "string"
    assert schema["required"] == ["detail"]


def test_fastapis_array_shaped_validation_model_is_absent_entirely(
    generated_document: Any,
) -> None:
    """The trap in `backend/AGENTS.md`, pinned.

    Declaring the 422 model on the `FastAPI()` constructor is what removes `HTTPValidationError` and
    `ValidationError` from the components. Declaring it only in the exception handler fixes the
    runtime body and leaves the document advertising the array shape — so a generated client would
    still be wrong while every runtime test passed. Asserting the *absence* of these two names is
    the only way to tell the two situations apart.
    """
    schemas = set(generated_document["components"]["schemas"])

    assert "HTTPValidationError" not in schemas
    assert "ValidationError" not in schemas


def test_health_advertises_an_impossible_422_and_that_is_the_accepted_cost(
    generated_document: Any,
) -> None:
    """Documents a known, deliberate wart so it is not "fixed" into a real defect.

    `/health` takes no input and can never fail validation, but the global `responses=` on the
    `FastAPI()` constructor applies to every route. The alternative — declaring the model per
    route — lets one forgotten route reintroduce the array shape, which is a worse failure than an
    impossible response appearing in the document. This test exists so that anyone who removes the
    global declaration gets a failure pointing at the reason rather than a silently wrong schema.
    """
    assert "422" in generated_document["paths"]["/health"]["get"]["responses"]
