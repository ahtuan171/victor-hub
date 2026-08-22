"""List, create, read, update, delete, and the date/type/trip filter — Module 02 (Travel
Schedule), over HTTP against the real database. Built from `Module_02_Travel_Schedule_Spec.md`
rather than a ratified `spec.md` — see the owner's explicit instruction recorded in this
iteration's history to bypass the speckit workflow for this module.

Shaped after `test_trips.py`: a shared cascade-on-delete assertion, an exact-set assertion for
every filter (per `backend/AGENTS.md`'s "a membership assertion about a filtered list is green
against no filter at all" trap), and a 422 — not 404 — when `trip_id` names no Trip.
"""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import TravelEvent

EVENTS_PATH = "/travel-events"
TRIPS_PATH = "/trips"

CONTRACTED_EVENT_KEYS = {
    "id",
    "trip_id",
    "event_type",
    "title",
    "event_date",
    "start_time",
    "location",
    "from_location",
    "to_location",
    "booking_reference",
    "category",
    "notes",
    "created_at",
    "updated_at",
}


def _make_trip(auth_client: TestClient, **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "name": "Japan 2026",
        "start_date": "2026-09-01",
        "end_date": "2026-09-15",
    }
    body.update(overrides)
    result: dict[str, object] = auth_client.post(TRIPS_PATH, json=body).json()
    return result


# --- Create -----------------------------------------------------------------------------------


def test_create_travel_event_with_only_required_fields(auth_client: TestClient) -> None:
    response = auth_client.post(
        EVENTS_PATH,
        json={"event_type": "note", "title": "Pack bags", "event_date": "2026-08-30"},
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == CONTRACTED_EVENT_KEYS
    assert body["trip_id"] is None
    assert body["event_type"] == "note"
    assert body["title"] == "Pack bags"
    assert body["event_date"] == "2026-08-30"
    assert body["start_time"] is None


def test_create_travel_event_with_every_type_specific_field(auth_client: TestClient) -> None:
    trip = _make_trip(auth_client)

    response = auth_client.post(
        EVENTS_PATH,
        json={
            "trip_id": trip["id"],
            "event_type": "transport",
            "title": "SGN -> NRT",
            "event_date": "2026-09-01",
            "start_time": "08:40:00",
            "from_location": "SGN",
            "to_location": "NRT",
            "booking_reference": "ABC123",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["trip_id"] == trip["id"]
    assert body["start_time"] == "08:40:00"
    assert body["from_location"] == "SGN"
    assert body["to_location"] == "NRT"
    assert body["booking_reference"] == "ABC123"


def test_create_travel_event_requires_a_credential(client: TestClient) -> None:
    response = client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-08-30"}
    )
    assert response.status_code == 401


def test_create_travel_event_422s_on_a_missing_field(auth_client: TestClient) -> None:
    assert auth_client.post(EVENTS_PATH, json={"title": "x"}).status_code == 422


def test_create_travel_event_422s_when_trip_id_names_no_trip(auth_client: TestClient) -> None:
    response = auth_client.post(
        EVENTS_PATH,
        json={
            "trip_id": 999999,
            "event_type": "note",
            "title": "x",
            "event_date": "2026-08-30",
        },
    )
    assert response.status_code == 422


# --- List and its filters ----------------------------------------------------------------------


def test_list_travel_events_is_empty_with_no_rows(auth_client: TestClient) -> None:
    assert auth_client.get(EVENTS_PATH).json() == []


def test_list_travel_events_requires_a_credential(client: TestClient) -> None:
    assert client.get(EVENTS_PATH).status_code == 401


def test_list_travel_events_filters_by_trip_id(auth_client: TestClient) -> None:
    trip = _make_trip(auth_client)
    other_trip = _make_trip(auth_client, name="Other")
    on_trip = auth_client.post(
        EVENTS_PATH,
        json={
            "trip_id": trip["id"],
            "event_type": "note",
            "title": "on trip",
            "event_date": "2026-09-01",
        },
    ).json()
    auth_client.post(
        EVENTS_PATH,
        json={
            "trip_id": other_trip["id"],
            "event_type": "note",
            "title": "other trip",
            "event_date": "2026-09-01",
        },
    )
    auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "unattached", "event_date": "2026-09-01"}
    )

    response = auth_client.get(EVENTS_PATH, params={"trip_id": str(trip["id"])})

    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {on_trip["id"]}


def test_list_travel_events_filters_by_event_type(auth_client: TestClient) -> None:
    note = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "a note", "event_date": "2026-09-01"}
    ).json()
    auth_client.post(
        EVENTS_PATH, json={"event_type": "food", "title": "dinner", "event_date": "2026-09-01"}
    )

    response = auth_client.get(EVENTS_PATH, params={"event_type": "note"})

    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {note["id"]}


def test_list_travel_events_filters_by_date_range(auth_client: TestClient) -> None:
    inside = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "inside", "event_date": "2026-09-05"}
    ).json()
    auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "before", "event_date": "2026-08-01"}
    )
    auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "after", "event_date": "2026-10-01"}
    )

    response = auth_client.get(
        EVENTS_PATH, params={"date_from": "2026-09-01", "date_to": "2026-09-30"}
    )

    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {inside["id"]}


# --- Get one ------------------------------------------------------------------------------------


def test_get_travel_event_returns_the_row(auth_client: TestClient) -> None:
    created = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-08-30"}
    ).json()

    response = auth_client.get(f"{EVENTS_PATH}/{created['id']}")

    assert response.status_code == 200
    assert response.json()["title"] == "x"


def test_get_travel_event_requires_a_credential(
    auth_client: TestClient, client: TestClient
) -> None:
    created = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-08-30"}
    ).json()
    assert client.get(f"{EVENTS_PATH}/{created['id']}").status_code == 401


def test_get_travel_event_404s_on_a_missing_id(auth_client: TestClient) -> None:
    assert auth_client.get(f"{EVENTS_PATH}/999999").status_code == 404


# --- Update -------------------------------------------------------------------------------------


def test_update_travel_event_changes_only_the_sent_fields(auth_client: TestClient) -> None:
    created = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-08-30"}
    ).json()

    response = auth_client.patch(f"{EVENTS_PATH}/{created['id']}", json={"title": "y"})

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "y"
    assert body["event_type"] == "note"


def test_update_travel_event_can_null_out_an_optional_field(auth_client: TestClient) -> None:
    created = auth_client.post(
        EVENTS_PATH,
        json={
            "event_type": "activity",
            "title": "x",
            "event_date": "2026-08-30",
            "location": "Shibuya",
        },
    ).json()

    response = auth_client.patch(f"{EVENTS_PATH}/{created['id']}", json={"location": None})

    assert response.status_code == 200
    assert response.json()["location"] is None


def test_update_travel_event_422s_when_trip_id_names_no_trip(auth_client: TestClient) -> None:
    created = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-08-30"}
    ).json()

    response = auth_client.patch(f"{EVENTS_PATH}/{created['id']}", json={"trip_id": 999999})

    assert response.status_code == 422


def test_update_travel_event_requires_a_credential(
    auth_client: TestClient, client: TestClient
) -> None:
    created = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-08-30"}
    ).json()
    response = client.patch(f"{EVENTS_PATH}/{created['id']}", json={"title": "y"})
    assert response.status_code == 401


def test_update_travel_event_404s_on_a_missing_id(auth_client: TestClient) -> None:
    assert auth_client.patch(f"{EVENTS_PATH}/999999", json={"title": "y"}).status_code == 404


def test_update_travel_event_422s_on_an_empty_body(auth_client: TestClient) -> None:
    created = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-08-30"}
    ).json()
    assert auth_client.patch(f"{EVENTS_PATH}/{created['id']}", json={}).status_code == 422


# --- Delete, and its cascade -------------------------------------------------------------------


def test_delete_travel_event_removes_the_row(auth_client: TestClient, session: Session) -> None:
    created = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-08-30"}
    ).json()

    response = auth_client.delete(f"{EVENTS_PATH}/{created['id']}")

    assert response.status_code == 204
    assert session.get(TravelEvent, created["id"]) is None


def test_delete_trip_cascades_to_its_travel_events(
    auth_client: TestClient, session: Session
) -> None:
    trip = _make_trip(auth_client)
    event = auth_client.post(
        EVENTS_PATH,
        json={
            "trip_id": trip["id"],
            "event_type": "note",
            "title": "x",
            "event_date": "2026-09-01",
        },
    ).json()

    response = auth_client.delete(f"{TRIPS_PATH}/{trip['id']}")

    assert response.status_code == 204
    assert session.get(TravelEvent, event["id"]) is None


def test_delete_trip_does_not_touch_an_unattached_travel_event(
    auth_client: TestClient, session: Session
) -> None:
    trip = _make_trip(auth_client)
    unattached = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-09-01"}
    ).json()

    auth_client.delete(f"{TRIPS_PATH}/{trip['id']}")

    assert session.get(TravelEvent, unattached["id"]) is not None


def test_delete_travel_event_requires_a_credential(
    auth_client: TestClient, client: TestClient
) -> None:
    created = auth_client.post(
        EVENTS_PATH, json={"event_type": "note", "title": "x", "event_date": "2026-08-30"}
    ).json()
    assert client.delete(f"{EVENTS_PATH}/{created['id']}").status_code == 401


def test_delete_travel_event_404s_on_a_missing_id(auth_client: TestClient) -> None:
    assert auth_client.delete(f"{EVENTS_PATH}/999999").status_code == 404
