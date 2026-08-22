"""List, create, read, update, delete — over HTTP, against the real database (T044, User Story 3).

Cascade delete (FR-018) is proven end to end here rather than trusted to the migration: creating a
Destination (and a Photograph on it) under a Trip, deleting the Trip, and asserting both rows are
gone is the same "prove it, don't just declare it" pattern `test_destinations.py`'s own cascade
test uses for the Destination -> Photograph edge.
"""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import Destination, Photograph, Trip

TRIPS_PATH = "/trips"

CONTRACTED_TRIP_KEYS = {
    "id",
    "name",
    # Module 02 (Travel Schedule) additions — both nullable, see `TripRead` in `app/schemas.py`.
    "destination",
    "notes",
    "start_date",
    "end_date",
    "status",
    "created_at",
    "updated_at",
}


# --- Create -----------------------------------------------------------------------------------


def test_create_trip_with_every_required_field(auth_client: TestClient) -> None:
    response = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == CONTRACTED_TRIP_KEYS
    assert body["name"] == "Japan 2026"
    assert body["start_date"] == "2026-09-01"
    assert body["end_date"] == "2026-09-15"
    assert body["status"] == "wishlist"


def test_create_trip_accepts_an_explicit_status(auth_client: TestClient) -> None:
    response = auth_client.post(
        TRIPS_PATH,
        json={
            "name": "Japan 2026",
            "start_date": "2026-09-01",
            "end_date": "2026-09-15",
            "status": "booked",
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "booked"


def test_create_trip_requires_a_credential(client: TestClient) -> None:
    response = client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    )
    assert response.status_code == 401


def test_create_trip_422s_on_a_missing_field(auth_client: TestClient) -> None:
    response = auth_client.post(TRIPS_PATH, json={"name": "Japan 2026"})
    assert response.status_code == 422


# --- List -------------------------------------------------------------------------------------


def test_list_trips_is_empty_with_no_rows(auth_client: TestClient) -> None:
    response = auth_client.get(TRIPS_PATH)
    assert response.status_code == 200
    assert response.json() == []


def test_list_trips_requires_a_credential(client: TestClient) -> None:
    assert client.get(TRIPS_PATH).status_code == 401


def test_list_trips_returns_every_trip(auth_client: TestClient) -> None:
    created = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()

    response = auth_client.get(TRIPS_PATH)

    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert created["id"] in ids


# --- Get one ------------------------------------------------------------------------------------


def test_get_trip_returns_the_row(auth_client: TestClient) -> None:
    created = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()

    response = auth_client.get(f"{TRIPS_PATH}/{created['id']}")

    assert response.status_code == 200
    assert response.json()["name"] == "Japan 2026"


def test_get_trip_requires_a_credential(auth_client: TestClient, client: TestClient) -> None:
    created = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()
    assert client.get(f"{TRIPS_PATH}/{created['id']}").status_code == 401


def test_get_trip_404s_on_a_missing_id(auth_client: TestClient) -> None:
    assert auth_client.get(f"{TRIPS_PATH}/999999").status_code == 404


# --- Update -------------------------------------------------------------------------------------


def test_update_trip_changes_only_the_sent_fields(auth_client: TestClient) -> None:
    created = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()

    response = auth_client.patch(f"{TRIPS_PATH}/{created['id']}", json={"status": "booked"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "booked"
    assert body["name"] == "Japan 2026"


def test_update_trip_requires_a_credential(auth_client: TestClient, client: TestClient) -> None:
    created = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()
    response = client.patch(f"{TRIPS_PATH}/{created['id']}", json={"status": "booked"})
    assert response.status_code == 401


def test_update_trip_404s_on_a_missing_id(auth_client: TestClient) -> None:
    response = auth_client.patch(f"{TRIPS_PATH}/999999", json={"status": "booked"})
    assert response.status_code == 404


def test_update_trip_422s_on_an_empty_body(auth_client: TestClient) -> None:
    created = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()
    assert auth_client.patch(f"{TRIPS_PATH}/{created['id']}", json={}).status_code == 422


def test_update_trip_refuses_an_explicit_null(auth_client: TestClient) -> None:
    """`trip`'s columns are all `NOT NULL` — none of `TripUpdate`'s fields has a null spelling,
    unlike `DestinationUpdate`'s mixed rule.
    """
    created = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()
    response = auth_client.patch(f"{TRIPS_PATH}/{created['id']}", json={"name": None})
    assert response.status_code == 422


# --- Delete, and its cascade (FR-018) --------------------------------------------------------


def test_delete_trip_removes_the_row(auth_client: TestClient, session: Session) -> None:
    created = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()

    response = auth_client.delete(f"{TRIPS_PATH}/{created['id']}")

    assert response.status_code == 204
    assert session.get(Trip, created["id"]) is None


def test_delete_trip_cascades_to_its_destinations_and_their_photographs(
    auth_client: TestClient, session: Session
) -> None:
    trip = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()
    destination = auth_client.post(
        "/destinations",
        json={
            "name": "Kyoto",
            "latitude": 35.0116,
            "longitude": 135.7681,
            "trip_id": trip["id"],
        },
    ).json()
    photograph = Photograph(destination_id=destination["id"], object_key="destinations/1/abc")
    session.add(photograph)
    session.commit()
    session.refresh(photograph)
    photograph_id = photograph.id

    response = auth_client.delete(f"{TRIPS_PATH}/{trip['id']}")

    assert response.status_code == 204
    assert session.get(Destination, destination["id"]) is None
    assert session.get(Photograph, photograph_id) is None


def test_delete_trip_does_not_touch_an_unattached_destination(
    auth_client: TestClient, session: Session
) -> None:
    trip = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()
    unattached = auth_client.post(
        "/destinations", json={"name": "Elsewhere", "latitude": 1.0, "longitude": 1.0}
    ).json()

    auth_client.delete(f"{TRIPS_PATH}/{trip['id']}")

    assert session.get(Destination, unattached["id"]) is not None


def test_delete_trip_requires_a_credential(auth_client: TestClient, client: TestClient) -> None:
    created = auth_client.post(
        TRIPS_PATH,
        json={"name": "Japan 2026", "start_date": "2026-09-01", "end_date": "2026-09-15"},
    ).json()
    assert client.delete(f"{TRIPS_PATH}/{created['id']}").status_code == 401


def test_delete_trip_404s_on_a_missing_id(auth_client: TestClient) -> None:
    assert auth_client.delete(f"{TRIPS_PATH}/999999").status_code == 404
