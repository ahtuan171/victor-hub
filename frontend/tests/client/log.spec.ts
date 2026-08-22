import { expect, test } from "@playwright/test";

import type { Destination, Trip } from "@/lib/api";
import {
  filterLogEntries,
  formatDestinationDateRange,
  sortDestinationsForLog,
} from "@/lib/log";

function mockDestination(overrides: Partial<Destination> = {}): Destination {
  return {
    id: 1,
    trip_id: null,
    name: "Kyoto",
    latitude: 35.0116,
    longitude: 135.7681,
    start_date: null,
    end_date: null,
    status: "wishlist",
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    outside_trip_range: false,
    ...overrides,
  };
}

function mockTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 10,
    name: "Japan Summer 2026",
    destination: null,
    start_date: "2026-08-01",
    end_date: "2026-08-15",
    status: "planned",
    notes: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

test.describe("formatDestinationDateRange", () => {
  test("returns null when start_date is null", () => {
    const dest = mockDestination({ start_date: null, end_date: null });
    expect(formatDestinationDateRange(dest)).toBeNull();
  });

  test("returns single date when end_date is null or identical", () => {
    const single = mockDestination({ start_date: "2026-08-10", end_date: null });
    expect(formatDestinationDateRange(single)).toBe("2026-08-10");

    const same = mockDestination({ start_date: "2026-08-10", end_date: "2026-08-10" });
    expect(formatDestinationDateRange(same)).toBe("2026-08-10");
  });

  test("returns formatted range when start_date and end_date differ", () => {
    const range = mockDestination({ start_date: "2026-08-10", end_date: "2026-08-15" });
    expect(formatDestinationDateRange(range)).toBe("2026-08-10 — 2026-08-15");
  });
});

test.describe("sortDestinationsForLog", () => {
  test("sorts places in reverse-chronological order by start_date DESC", () => {
    const dest1 = mockDestination({ id: 1, name: "Tokyo", start_date: "2026-08-01", status: "visited" });
    const dest2 = mockDestination({ id: 2, name: "Osaka", start_date: "2026-08-15", status: "visited" });
    const dest3 = mockDestination({ id: 3, name: "Kyoto", start_date: "2026-08-10", status: "visited" });

    const entries = sortDestinationsForLog([dest1, dest2, dest3], []);
    expect(entries.map((e) => e.destination.name)).toEqual(["Osaka", "Kyoto", "Tokyo"]);
  });

  test("falls back to created_at DESC when start_date is missing", () => {
    const dest1 = mockDestination({
      id: 1,
      name: "Earlier Wishlist",
      start_date: null,
      created_at: "2026-08-01T00:00:00Z",
    });
    const dest2 = mockDestination({
      id: 2,
      name: "Later Wishlist",
      start_date: null,
      created_at: "2026-08-10T00:00:00Z",
    });

    const entries = sortDestinationsForLog([dest1, dest2], []);
    expect(entries.map((e) => e.destination.name)).toEqual(["Later Wishlist", "Earlier Wishlist"]);
  });

  test("attaches matching tripName when trip_id is present", () => {
    const trip = mockTrip({ id: 10, name: "Kansai Trip" });
    const dest = mockDestination({ id: 1, name: "Kyoto", trip_id: 10 });

    const entries = sortDestinationsForLog([dest], [trip]);
    expect(entries[0]?.tripName).toBe("Kansai Trip");
  });

  test("returns null for tripName when trip_id is null or not found", () => {
    const dest1 = mockDestination({ id: 1, name: "Kyoto", trip_id: null });
    const dest2 = mockDestination({ id: 2, name: "Nara", trip_id: 999 });

    const entries = sortDestinationsForLog([dest1, dest2], []);
    expect(entries[0]?.tripName).toBeNull();
    expect(entries[1]?.tripName).toBeNull();
  });
});

test.describe("filterLogEntries", () => {
  test("returns all entries when filter is 'all'", () => {
    const dest1 = mockDestination({ id: 1, status: "visited" });
    const dest2 = mockDestination({ id: 2, status: "planned" });
    const entries = sortDestinationsForLog([dest1, dest2], []);

    expect(filterLogEntries(entries, "all").length).toBe(2);
  });

  test("filters entries by matching status", () => {
    const dest1 = mockDestination({ id: 1, status: "visited" });
    const dest2 = mockDestination({ id: 2, status: "planned" });
    const dest3 = mockDestination({ id: 3, status: "wishlist" });
    const entries = sortDestinationsForLog([dest1, dest2, dest3], []);

    const visitedOnly = filterLogEntries(entries, "visited");
    expect(visitedOnly.length).toBe(1);
    expect(visitedOnly[0]?.destination.id).toBe(1);

    const plannedOnly = filterLogEntries(entries, "planned");
    expect(plannedOnly.length).toBe(1);
    expect(plannedOnly[0]?.destination.id).toBe(2);
  });
});
