"""`GET` and `PATCH /preferences` — 002-pixel-arcade-skin.

Both operations are scoped to the authenticated account's own row and take no identifier from the
request (INV-1, `specs/002-pixel-arcade-skin/data-model.md`): there is one creator, and the token
names it. The no-credential 401 cases for both routes live in `test_errors.py`'s `REACHABLE_4XX`,
alongside every other uniform-shape error in the API; this file is about `/preferences`'s own
semantics — defaults, partial update, and the two validation rules `PreferencesUpdate` enforces.
"""

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_get_returns_dark_and_false_for_a_never_touched_creator(auth_client: TestClient) -> None:
    """FR-012, FR-020 (and `data-model.md`): absent means dark / off, and both are the column
    default. The `creator` fixture never sets `theme` or `sound_enabled` explicitly, so this is the
    account's state exactly as `app.scripts.seed_user` would leave it for a brand-new account.
    """
    response = auth_client.get("/preferences")

    assert response.status_code == 200
    assert response.json() == {"theme": "dark", "sound_enabled": False}


def test_preferences_operations_take_no_identifier(app: FastAPI) -> None:
    """INV-1, mechanically: the generated document declares no path parameter on either operation,
    because the route itself has nowhere for one to be declared. `GET`/`PATCH`/`DELETE
    /trips/{trip_id}` by contrast carry a `trip_id` — the absence here is deliberate, not an
    oversight.
    """
    app.openapi_schema = None
    document: dict[str, Any] = app.openapi()
    app.openapi_schema = None

    operations = document["paths"]["/preferences"]
    for method in ("get", "patch"):
        parameters = operations[method].get("parameters", [])
        assert not any(p["in"] == "path" for p in parameters), (
            f"{method.upper()} /preferences declares a path parameter; INV-1 forbids one"
        )


def test_patch_with_empty_body_is_422(auth_client: TestClient) -> None:
    """The contract's `minProperties: 1`. An empty body is not a no-op 200 — see
    `TripUpdate.at_least_one_field` for the same rule and the same reason.
    """
    response = auth_client.patch("/preferences", json={})

    assert response.status_code == 422


def test_patch_with_an_unknown_key_is_422(auth_client: TestClient) -> None:
    """The contract's `additionalProperties: false`. Without it, a client that misspells
    `sound_enabled` would get a 200 describing a change that never happened, because FastAPI ignores
    unknown body keys by default.
    """
    response = auth_client.patch("/preferences", json={"sound_enable": True})

    assert response.status_code == 422


def test_patch_with_no_token_is_401_not_403(client: TestClient) -> None:
    """`HTTPBearer(auto_error=True)` would answer a missing header with Starlette's own
    `403 {"detail": "Not authenticated"}`. The contract declares 401 everywhere — `test_auth.py`
    asserts the same thing against the probe route; this is the same claim against this endpoint.
    """
    response = client.patch("/preferences", json={"theme": "light"})

    assert response.status_code == 401


def test_patch_response_is_the_full_object_not_the_diff(auth_client: TestClient) -> None:
    """Changing only `theme` still returns `sound_enabled` in the body, so a caller never has to
    reconstruct the new state from what it sent (contract: "The response is the full preferences
    object, not the diff").
    """
    response = auth_client.patch("/preferences", json={"theme": "light"})

    assert response.status_code == 200
    assert response.json() == {"theme": "light", "sound_enabled": False}


def test_patch_theme_only_leaves_sound_enabled_untouched(auth_client: TestClient) -> None:
    """Partial update, one direction: `sound_enabled` is turned on first, then only `theme` is sent,
    and the sound choice must survive the second request untouched.
    """
    auth_client.patch("/preferences", json={"sound_enabled": True})

    response = auth_client.patch("/preferences", json={"theme": "light"})

    assert response.status_code == 200
    assert response.json() == {"theme": "light", "sound_enabled": True}


def test_patch_sound_enabled_only_leaves_theme_untouched(auth_client: TestClient) -> None:
    """Partial update, the other direction: the default `theme` must survive a request that only
    names `sound_enabled`.
    """
    response = auth_client.patch("/preferences", json={"sound_enabled": True})

    assert response.status_code == 200
    assert response.json() == {"theme": "dark", "sound_enabled": True}


def test_patch_accepts_both_fields_in_one_request(auth_client: TestClient) -> None:
    """Not required by the contract's `minProperties: 1`, but nothing forbids sending both — and a
    request that changes both must actually change both.
    """
    response = auth_client.patch("/preferences", json={"theme": "light", "sound_enabled": True})

    assert response.status_code == 200
    assert response.json() == {"theme": "light", "sound_enabled": True}


def test_patch_with_an_invalid_theme_value_is_422(auth_client: TestClient) -> None:
    """`Theme` is a closed two-member enum (`dark`, `light`). A third string is not a silent no-op —
    it is a validation failure, the same as an unrecognised `Status` or `Platform` elsewhere in this
    API.
    """
    response = auth_client.patch("/preferences", json={"theme": "solarized"})

    assert response.status_code == 422


def test_patch_rejects_an_explicit_null(auth_client: TestClient) -> None:
    """Neither field here is nullable — the contract states this
    explicitly, because both columns are `NOT NULL` with a default and "clear it" has no meaning.
    An explicit `null` is therefore a validation failure, not a third intention.
    """
    response = auth_client.patch("/preferences", json={"theme": None})

    assert response.status_code == 422
