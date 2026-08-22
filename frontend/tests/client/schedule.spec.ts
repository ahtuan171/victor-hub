import { expect, test } from "@playwright/test";

import type { Trip, TravelEvent } from "@/lib/api";
import {
  buildScheduleEntries,
  computeTripStats,
  filterScheduleEntries,
  groupEntriesByDate,
  sortTripsByStartDate,
  upcomingEntries,
} from "@/lib/schedule";

function mockTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    name: "Japan Summer 2026",
    destination: "Tokyo, Japan",
    start_date: "2026-08-22",
    end_date: "2026-08-28",
    status: "planned",
    notes: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function mockEvent(overrides: Partial<TravelEvent> = {}): TravelEvent {
  return {
    id: 1,
    trip_id: 1,
    event_type: "note",
    title: "Pack bags",
    event_date: "2026-08-22",
    start_time: null,
    location: null,
    from_location: null,
    to_location: null,
    booking_reference: null,
    category: null,
    notes: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

test.describe("buildScheduleEntries", () => {
  test("draws one entry per Trip, at its start date, titled from destination", () => {
    const entries = buildScheduleEntries([mockTrip()], []);
    expect(entries).toEqual([
      { date: "2026-08-22", kind: "trip", title: "Tokyo, Japan", time: null, tripId: 1, refId: 1 },
    ]);
  });

  test("falls back to the Trip's name when destination is unset", () => {
    const entries = buildScheduleEntries([mockTrip({ destination: null, name: "Summer Trip" })], []);
    expect(entries[0]!.title).toBe("Summer Trip");
  });

  test("draws one entry per TravelEvent, at its own date", () => {
    const event = mockEvent({ event_type: "transport", title: "SGN -> NRT", start_time: "08:40:00" });
    const entries = buildScheduleEntries([], [event]);
    expect(entries).toEqual([
      { date: "2026-08-22", kind: "transport", title: "SGN -> NRT", time: "08:40:00", tripId: 1, refId: 1 },
    ]);
  });
});

test.describe("filterScheduleEntries", () => {
  const entries = buildScheduleEntries(
    [mockTrip()],
    [
      mockEvent({ id: 1, event_type: "transport" }),
      mockEvent({ id: 2, event_type: "stay" }),
      mockEvent({ id: 3, event_type: "activity" }),
    ],
  );

  test("all returns every entry", () => {
    expect(filterScheduleEntries(entries, "all")).toHaveLength(4);
  });

  test("trips returns only the Trip's own entry", () => {
    const filtered = filterScheduleEntries(entries, "trips");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.kind).toBe("trip");
  });

  test("a TravelEventType filter returns only that type", () => {
    const filtered = filterScheduleEntries(entries, "stay");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.refId).toBe(2);
  });
});

test.describe("groupEntriesByDate", () => {
  test("groups entries that share a date, keeps entries on different dates apart", () => {
    const entries = buildScheduleEntries(
      [],
      [
        mockEvent({ id: 1, event_date: "2026-08-22" }),
        mockEvent({ id: 2, event_date: "2026-08-22" }),
        mockEvent({ id: 3, event_date: "2026-08-23" }),
      ],
    );

    const byDate = groupEntriesByDate(entries);

    expect(byDate.get("2026-08-22")).toHaveLength(2);
    expect(byDate.get("2026-08-23")).toHaveLength(1);
    expect(byDate.has("2026-08-24")).toBe(false);
  });
});

test.describe("upcomingEntries", () => {
  test("excludes entries strictly before today", () => {
    const entries = buildScheduleEntries(
      [],
      [
        mockEvent({ id: 1, event_date: "2026-08-20" }),
        mockEvent({ id: 2, event_date: "2026-08-22" }),
      ],
    );

    const upcoming = upcomingEntries(entries, "2026-08-22");

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]!.refId).toBe(2);
  });

  test("includes an entry dated exactly today", () => {
    const entries = buildScheduleEntries([], [mockEvent({ event_date: "2026-08-22" })]);
    expect(upcomingEntries(entries, "2026-08-22")).toHaveLength(1);
  });

  test("sorts soonest first, and an untimed entry before a timed one on the same day", () => {
    const entries = buildScheduleEntries(
      [],
      [
        mockEvent({ id: 1, event_date: "2026-08-23", start_time: null }),
        mockEvent({ id: 2, event_date: "2026-08-22", start_time: "08:40:00" }),
        mockEvent({ id: 3, event_date: "2026-08-22", start_time: null }),
      ],
    );

    const upcoming = upcomingEntries(entries, "2026-08-22");

    expect(upcoming.map((entry) => entry.refId)).toEqual([3, 2, 1]);
  });

  test("respects the limit", () => {
    const events = Array.from({ length: 10 }, (_, index) =>
      mockEvent({ id: index + 1, event_date: "2026-08-22" }),
    );
    const entries = buildScheduleEntries([], events);
    expect(upcomingEntries(entries, "2026-08-22", 3)).toHaveLength(3);
  });
});

test.describe("computeTripStats", () => {
  test("counts flights, stays, and other events separately, ignoring another Trip's events", () => {
    const events = [
      mockEvent({ id: 1, trip_id: 1, event_type: "transport" }),
      mockEvent({ id: 2, trip_id: 1, event_type: "transport" }),
      mockEvent({ id: 3, trip_id: 1, event_type: "stay" }),
      mockEvent({ id: 4, trip_id: 1, event_type: "activity" }),
      mockEvent({ id: 5, trip_id: 1, event_type: "food" }),
      mockEvent({ id: 6, trip_id: 2, event_type: "transport" }),
    ];

    const stats = computeTripStats(1, events, 6);

    expect(stats).toEqual({ places: 6, flights: 2, stays: 1, events: 2 });
  });
});

test.describe("sortTripsByStartDate", () => {
  test("orders soonest-start-first", () => {
    const trips = [
      mockTrip({ id: 1, start_date: "2026-09-01" }),
      mockTrip({ id: 2, start_date: "2026-08-01" }),
    ];
    expect(sortTripsByStartDate(trips).map((trip) => trip.id)).toEqual([2, 1]);
  });
});
