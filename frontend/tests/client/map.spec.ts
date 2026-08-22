import { expect, test } from "@playwright/test";

import { DESTINATION_STATUSES, type Destination, type DestinationDetail, type Trip } from "@/lib/api";
import {
  DESTINATION_PIN_TREATMENTS,
  boundsForDestinations,
  disambiguateCoincidentPins,
  isCurrentlyTraveling,
  pinTreatment,
  plannedPlaceContext,
  resolveOverlap,
  selectByStatus,
} from "@/lib/map";

/**
 * `lib/map.ts` (T015, FR-002, FR-026, research.md R-004).
 *
 * Same shape as `tests/client/status.spec.ts`: the `client` project runs with no browser and no
 * renderer, so these assert the **encoding** and the **pure computations**, never styling —
 * `lib/map.ts` returns data for exactly this reason (`tech-defaults.md` rules out Jest/RTL).
 *
 * `T054` extends this file later with the status-narrowing logic `StatusFilter` (Phase 7) adds
 * to `lib/map.ts` — this file exists from T015 so that later task has something to extend.
 */

function destination(overrides: Partial<Destination> = {}): Destination {
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

function detail(overrides: Partial<DestinationDetail> = {}): DestinationDetail {
  return { ...destination(overrides), note: null, photographs: [], ...overrides };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    name: "Japan 2026",
    destination: null,
    start_date: "2026-09-01",
    end_date: "2026-09-14",
    status: "wishlist",
    notes: null,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    ...overrides,
  };
}

test.describe("pin treatment", () => {
  test("every status the contract defines has a treatment", () => {
    for (const status of DESTINATION_STATUSES) {
      expect(DESTINATION_PIN_TREATMENTS[status], `no treatment for status ${status}`).toBeDefined();
      expect(pinTreatment(status).status).toBe(status);
    }
    expect(Object.keys(DESTINATION_PIN_TREATMENTS)).toHaveLength(DESTINATION_STATUSES.length);
  });

  test("the three statuses are distinguishable without colour", () => {
    // The greyscale-survival assertion `design/003-travel-map/BRIEF.md`'s `1b` panel confirms by
    // screenshot — this is the strongest form available without a browser: strip the colour
    // classes and fill+glyph alone must still tell the three apart.
    const greyscale = DESTINATION_STATUSES.map((status) => {
      const treatment = pinTreatment(status);
      return `${treatment.fill}/${treatment.glyph}`;
    });

    expect(new Set(greyscale).size).toBe(DESTINATION_STATUSES.length);
  });

  test("the fills progress outline -> half -> solid, matching 001's house style", () => {
    expect(pinTreatment("wishlist").fill).toBe("outline");
    expect(pinTreatment("planned").fill).toBe("half");
    expect(pinTreatment("visited").fill).toBe("solid");
  });

  test("every status has an accessible name that is not the raw value", () => {
    for (const status of DESTINATION_STATUSES) {
      const { label } = pinTreatment(status);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(status);
    }
  });

  test("no treatment carries a colour literal", () => {
    // `app/globals.css` is the only file allowed to contain a colour — see `status.spec.ts`'s
    // identical assertion for Content Calendar's own cue.
    const classNames = DESTINATION_STATUSES.flatMap((status) => {
      const treatment = pinTreatment(status);
      return [treatment.borderClass, treatment.fillClass, treatment.textClass];
    });

    for (const className of classNames) {
      expect(className, `${className} looks like a literal colour`).not.toMatch(/#|rgb|hsl|oklch/);
      expect(className).toContain("status-");
    }
  });
});

test.describe("isCurrentlyTraveling", () => {
  test("false before today is known", () => {
    const planned = destination({ status: "planned", start_date: "2026-08-01", end_date: "2026-08-20" });
    expect(isCurrentlyTraveling(planned, null)).toBe(false);
  });

  test("false for Visited or Wishlist, whatever their dates say", () => {
    const visited = destination({
      status: "visited",
      start_date: "2026-08-01",
      end_date: "2026-08-20",
    });
    const wishlist = destination({
      status: "wishlist",
      start_date: "2026-08-01",
      end_date: "2026-08-20",
    });
    expect(isCurrentlyTraveling(visited, "2026-08-14")).toBe(false);
    expect(isCurrentlyTraveling(wishlist, "2026-08-14")).toBe(false);
  });

  test("false for a Planned destination with no date range", () => {
    const planned = destination({ status: "planned", start_date: null, end_date: null });
    expect(isCurrentlyTraveling(planned, "2026-08-14")).toBe(false);
  });

  test("true when today falls inside a Planned destination's range, inclusive both ends", () => {
    const planned = destination({ status: "planned", start_date: "2026-08-01", end_date: "2026-08-20" });
    expect(isCurrentlyTraveling(planned, "2026-08-01")).toBe(true);
    expect(isCurrentlyTraveling(planned, "2026-08-14")).toBe(true);
    expect(isCurrentlyTraveling(planned, "2026-08-20")).toBe(true);
  });

  test("false the day before or the day after the range", () => {
    const planned = destination({ status: "planned", start_date: "2026-08-01", end_date: "2026-08-20" });
    expect(isCurrentlyTraveling(planned, "2026-07-31")).toBe(false);
    expect(isCurrentlyTraveling(planned, "2026-08-21")).toBe(false);
  });
});

test.describe("disambiguateCoincidentPins", () => {
  test("leaves distinct coordinates untouched", () => {
    const kyoto = destination({ id: 1, latitude: 35.0116, longitude: 135.7681 });
    const tokyo = destination({ id: 2, latitude: 35.6812, longitude: 139.7671 });

    expect(disambiguateCoincidentPins([kyoto, tokyo])).toEqual([kyoto, tokyo]);
  });

  test("nudges exactly-coincident destinations apart, deterministically", () => {
    const first = destination({ id: 1, latitude: 35.0116, longitude: 135.7681 });
    const second = destination({ id: 2, latitude: 35.0116, longitude: 135.7681 });

    const [nudgedFirst, nudgedSecond] = disambiguateCoincidentPins([first, second]);

    // The first occurrence at a coordinate is left exactly where it was.
    expect(nudgedFirst).toEqual(first);
    // The second is moved, but only by a small amount — still recognisably "the same place".
    expect(nudgedSecond).not.toEqual(second);
    expect(nudgedSecond?.latitude).not.toBe(second.latitude);
    expect(Math.abs((nudgedSecond?.latitude ?? 0) - second.latitude)).toBeLessThan(0.001);
    expect(Math.abs((nudgedSecond?.longitude ?? 0) - second.longitude)).toBeLessThan(0.001);

    // Deterministic: running it again on the same input produces the same offset.
    const [, nudgedAgain] = disambiguateCoincidentPins([first, second]);
    expect(nudgedAgain).toEqual(nudgedSecond);
  });

  test("three-way coincidence nudges the second and third apart from each other too", () => {
    const shared = { latitude: 35.0116, longitude: 135.7681 };
    const rows = [
      destination({ id: 1, ...shared }),
      destination({ id: 2, ...shared }),
      destination({ id: 3, ...shared }),
    ];

    const nudged = disambiguateCoincidentPins(rows);
    const positions = nudged.map((row) => `${row.latitude},${row.longitude}`);
    expect(new Set(positions).size).toBe(3);
  });
});

test.describe("boundsForDestinations", () => {
  test("null for an empty list — the caller's cue to fall back to the default view", () => {
    expect(boundsForDestinations([])).toBeNull();
  });

  test("a single destination produces a zero-area box at its own coordinates", () => {
    const kyoto = destination({ latitude: 35.0116, longitude: 135.7681 });
    expect(boundsForDestinations([kyoto])).toEqual([135.7681, 35.0116, 135.7681, 35.0116]);
  });

  test("spans every destination, west/south/east/north", () => {
    const kyoto = destination({ id: 1, latitude: 35.0116, longitude: 135.7681 });
    const tokyo = destination({ id: 2, latitude: 35.6812, longitude: 139.7671 });
    const osaka = destination({ id: 3, latitude: 34.6937, longitude: 135.5023 });

    expect(boundsForDestinations([kyoto, tokyo, osaka])).toEqual([
      135.5023, // west: osaka's longitude
      34.6937, // south: osaka's latitude
      139.7671, // east: tokyo's longitude
      35.6812, // north: tokyo's latitude
    ]);
  });
});

test.describe("resolveOverlap", () => {
  /**
   * Both fixtures sit on the equator (`latitude: 0`) on purpose — Web Mercator's y-axis depends on
   * latitude through the Gudermannian inverse, but its x-axis is a plain linear function of
   * longitude alone. Fixing both points to the same latitude collapses the distance to a pure
   * x-difference, which lets these fixtures be **derived exactly** from the pixel distance they are
   * meant to test, rather than approximated and asserted loosely (004, T006, R-002).
   *
   * `scale = 256 * 2^zoom`; a longitude delta of `pixels * 360 / scale` degrees is exactly
   * `pixels` screen pixels apart at that zoom. Zoom 10 is an arbitrary "city view" reference zoom
   * — nothing about these tests depends on its specific value beyond it being fixed and known.
   */
  const REFERENCE_ZOOM = 10;
  const SCALE_AT_REFERENCE_ZOOM = 256 * 2 ** REFERENCE_ZOOM;

  function degreesForPixels(pixels: number): number {
    return (pixels * 360) / SCALE_AT_REFERENCE_ZOOM;
  }

  const origin = destination({ id: 1, latitude: 0, longitude: 100 });
  /** Exactly 40px from `origin` at `REFERENCE_ZOOM` — inside the 44px radius (research.md R-002). */
  const near = destination({ id: 2, latitude: 0, longitude: 100 + degreesForPixels(40) });
  /** Exactly 50px from `origin` at `REFERENCE_ZOOM` — outside the 44px radius. */
  const far = destination({ id: 3, latitude: 0, longitude: 100 + degreesForPixels(50) });

  test("no other destination at all is never overlapping, and the zoom is unchanged", () => {
    const result = resolveOverlap(origin, [origin], REFERENCE_ZOOM);
    expect(result).toEqual({ overlapping: false, targetZoom: REFERENCE_ZOOM });
  });

  test("excludes the tapped destination itself from the comparison", () => {
    // If the tapped destination were compared against itself, distance would be 0 and this would
    // always report overlapping — the same fixture as the test above, spelled out explicitly.
    const result = resolveOverlap(origin, [origin], REFERENCE_ZOOM);
    expect(result.overlapping).toBe(false);
  });

  test("50px apart, right at the boundary's outside edge, is not overlapping", () => {
    const result = resolveOverlap(origin, [origin, far], REFERENCE_ZOOM);
    expect(result).toEqual({ overlapping: false, targetZoom: REFERENCE_ZOOM });
  });

  test("40px apart is overlapping, and the zoom step that clears it is exact", () => {
    // Web Mercator distance doubles with every whole zoom level, so a 40px gap becomes
    // 40 * sqrt(2) ≈ 56.6px after the +0.5 zoom step `resolveOverlap` takes — already past the
    // 44px radius, so this is the first (and only) step the search needs.
    const result = resolveOverlap(origin, [origin, near], REFERENCE_ZOOM);
    expect(result).toEqual({ overlapping: true, targetZoom: REFERENCE_ZOOM + 0.5 });
  });

  test("the returned targetZoom actually resolves the overlap it reported", () => {
    // A self-consistency check that needs no independent reimplementation of the projection math:
    // whatever zoom the function says will separate the pair, asking it again at that exact zoom
    // must come back clear.
    const first = resolveOverlap(origin, [origin, near], REFERENCE_ZOOM);
    expect(first.overlapping).toBe(true);

    const second = resolveOverlap(origin, [origin, near], first.targetZoom);
    expect(second.overlapping).toBe(false);
  });

  test("picks the closest of several other destinations", () => {
    // `far` alone would not overlap; `near` alone would. Together, the closer one must win.
    const result = resolveOverlap(origin, [origin, far, near], REFERENCE_ZOOM);
    expect(result.overlapping).toBe(true);
  });

  test("two destinations at the exact same coordinate stay overlapping but the search still terminates", () => {
    // Distance is 0 at every zoom for a genuinely coincident pair — no zoom level separates them —
    // so this is the case the search's own upper bound exists for. It must still return promptly
    // with a finite, bounded zoom rather than loop forever.
    const coincident = destination({ id: 2, latitude: origin.latitude, longitude: origin.longitude });
    const result = resolveOverlap(origin, [origin, coincident], REFERENCE_ZOOM);
    expect(result.overlapping).toBe(true);
    expect(Number.isFinite(result.targetZoom)).toBe(true);
    expect(result.targetZoom).toBeLessThan(25);
  });
});

test.describe("selectByStatus", () => {
  const visited = destination({ id: 1, name: "Da Nang", status: "visited" });
  const planned = destination({ id: 2, name: "Kyoto", status: "planned" });
  const wishlist = destination({ id: 3, name: "Patagonia", status: "wishlist" });
  const alsoVisited = destination({ id: 4, name: "Ha Long Bay", status: "visited" });
  const all = [visited, planned, wishlist, alsoVisited];

  test("null is every status, not none of them", () => {
    // The whole reason the filter's `ALL` is a real radio option rather than the state of having
    // deselected everything (`StatusFilter`'s docstring).
    expect(selectByStatus(all, null)).toEqual(all);
  });

  test("narrows to exactly one status", () => {
    expect(selectByStatus(all, "visited")).toEqual([visited, alsoVisited]);
    expect(selectByStatus(all, "planned")).toEqual([planned]);
    expect(selectByStatus(all, "wishlist")).toEqual([wishlist]);
  });

  test("every status the contract defines can be selected", () => {
    for (const status of DESTINATION_STATUSES) {
      const narrowed = selectByStatus(all, status);
      for (const row of narrowed) expect(row.status).toBe(status);
    }
  });

  test("a status with nothing in it narrows to empty rather than falling back to everything", () => {
    // The failure that would make the filter look broken in the least obvious way: an empty result
    // silently treated as "no filter" would show the owner every pin while the control says
    // otherwise.
    expect(selectByStatus([planned, wishlist], "visited")).toEqual([]);
  });

  test("preserves the server's ordering rather than sorting", () => {
    // `filter` keeps order, and the list arrives already in the server's total order — the same
    // reason `selectBacklog` needs no sort of its own (`lib/items.ts`).
    const reversed = [alsoVisited, visited];
    expect(selectByStatus(reversed, "visited")).toEqual([alsoVisited, visited]);
  });

  test("does not mutate the list it was given", () => {
    const input = [...all];
    selectByStatus(input, "visited");
    expect(input).toEqual(all);
  });

  test("an empty list stays empty for every selection", () => {
    expect(selectByStatus([], null)).toEqual([]);
    expect(selectByStatus([], "visited")).toEqual([]);
  });
});

test.describe("plannedPlaceContext", () => {
  test("finds the matching Trip and its siblings, excluding the place itself", () => {
    const japanTrip = trip({ id: 10, name: "Japan 2026" });
    const kyoto = detail({ id: 1, trip_id: 10, status: "planned" });
    const osaka = destination({ id: 2, trip_id: 10, name: "Osaka", status: "planned" });
    const notInTrip = destination({ id: 3, trip_id: null, name: "Lisbon", status: "wishlist" });

    const context = plannedPlaceContext(kyoto, [kyoto, osaka, notInTrip], [japanTrip], null);

    expect(context.trip).toEqual(japanTrip);
    expect(context.siblings).toEqual([osaka]);
  });

  test("no trip_id means no Trip and no siblings — the FR-014 attach-offer case", () => {
    const kyoto = detail({ id: 1, trip_id: null, status: "planned" });
    const osaka = destination({ id: 2, trip_id: null, name: "Osaka", status: "planned" });

    const context = plannedPlaceContext(kyoto, [kyoto, osaka], [], null);

    expect(context.trip).toBeNull();
    expect(context.siblings).toEqual([]);
  });

  test("a trip_id naming a Trip that no longer exists is treated the same as no trip_id", () => {
    // Deleted out from under an open sheet, or a detail loaded a moment before a delete
    // elsewhere reconciles — this function does not throw or surface a broken reference.
    const kyoto = detail({ id: 1, trip_id: 999, status: "planned" });

    const context = plannedPlaceContext(kyoto, [kyoto], [trip({ id: 10 })], null);

    expect(context.trip).toBeNull();
    expect(context.siblings).toEqual([]);
  });

  test("outsideTripRange passes the Destination's own flag through unchanged", () => {
    const outside = detail({ id: 1, trip_id: 10, status: "planned", outside_trip_range: true });

    const context = plannedPlaceContext(outside, [outside], [trip({ id: 10 })], null);

    expect(context.outsideTripRange).toBe(true);
  });

  test("currentlyTraveling matches isCurrentlyTraveling exactly — same function, not a second copy", () => {
    const traveling = detail({
      id: 1,
      trip_id: 10,
      status: "planned",
      start_date: "2026-09-01",
      end_date: "2026-09-14",
    });
    const today = "2026-09-05";

    const context = plannedPlaceContext(traveling, [traveling], [trip({ id: 10 })], today);

    expect(context.currentlyTraveling).toBe(isCurrentlyTraveling(traveling, today));
    expect(context.currentlyTraveling).toBe(true);
  });

  test("does not mutate the lists it was given", () => {
    const kyoto = detail({ id: 1, trip_id: 10, status: "planned" });
    const osaka = destination({ id: 2, trip_id: 10, name: "Osaka", status: "planned" });
    const allDestinations = [kyoto, osaka];
    const allTrips = [trip({ id: 10 })];

    plannedPlaceContext(kyoto, allDestinations, allTrips, null);

    expect(allDestinations).toEqual([kyoto, osaka]);
    expect(allTrips).toEqual([trip({ id: 10 })]);
  });
});
