import type { Trip, TravelEvent, TravelEventType } from "./api";
import { compareDateOnly, type DateOnly } from "./dates";

/**
 * Module 02 (Travel Schedule) — pure functions, built from `Module_02_Travel_Schedule_Spec.md`
 * rather than a ratified `spec.md`. See the owner's explicit instruction recorded in this
 * iteration's history to bypass the speckit workflow for this module.
 *
 * Shaped after `lib/period.ts` and `lib/log.ts`: no renderer exists in this project
 * (`tech-defaults.md` rules out Jest/RTL), so anything worth testing on its own lives here as a
 * plain function rather than inside a component, and every date in and out is a `YYYY-MM-DD`
 * string — `lib/dates.ts` is the only module allowed to touch `Date`.
 */

/** §8. One symbol per kind of dated entry, including the Trip itself (`◆`, drawn separately from
 * `TravelEventType` — see `ScheduleEntry`'s own docstring for why). */
export const TRIP_SYMBOL = "◆";

export const EVENT_TYPE_SYMBOL: Readonly<Record<TravelEventType, string>> = {
  transport: "✈",
  stay: "⌂",
  activity: "◇",
  food: "◈",
  note: "○",
};

/** §14's per-type labels, used by the type picker and the filter row. */
export const EVENT_TYPE_LABEL: Readonly<Record<TravelEventType, string>> = {
  transport: "Flight",
  stay: "Stay",
  activity: "Activity",
  food: "Food",
  note: "Note",
};

/** §9's filter row: `all`/`trips` plus one entry per `TravelEventType`. */
export type ScheduleFilterId = "all" | "trips" | TravelEventType;

export const SCHEDULE_FILTERS: ReadonlyArray<{
  readonly id: ScheduleFilterId;
  readonly label: string;
}> = [
  { id: "all", label: "All" },
  { id: "trips", label: "Trips" },
  { id: "transport", label: "Flights" },
  { id: "stay", label: "Stays" },
  { id: "activity", label: "Activities" },
  { id: "food", label: "Food" },
  { id: "note", label: "Notes" },
];

/**
 * One dated entry on the schedule — a Trip's start date, or a TravelEvent's own date. Unifying
 * the two under one shape is what lets the calendar's markers, the filter row and the Upcoming
 * list share one filter and one grouping function, rather than three separate ones that could
 * disagree about what "Trips" means.
 */
export interface ScheduleEntry {
  readonly date: DateOnly;
  readonly kind: "trip" | TravelEventType;
  readonly title: string;
  /** `HH:MM:SS` for an event with a `start_time`; always null for a Trip's own entry. */
  readonly time: string | null;
  readonly tripId: number | null;
  /** The Trip's or TravelEvent's own id — which table depends on `kind`. */
  readonly refId: number;
}

/** Every Trip and TravelEvent, as one flat list of dated entries. */
export function buildScheduleEntries(
  trips: readonly Trip[],
  events: readonly TravelEvent[],
): ScheduleEntry[] {
  const tripEntries: ScheduleEntry[] = trips.map((trip) => ({
    date: trip.start_date,
    kind: "trip",
    title: trip.destination ?? trip.name,
    time: null,
    tripId: trip.id,
    refId: trip.id,
  }));
  const eventEntries: ScheduleEntry[] = events.map((event) => ({
    date: event.event_date,
    kind: event.event_type,
    title: event.title,
    time: event.start_time,
    tripId: event.trip_id,
    refId: event.id,
  }));
  return [...tripEntries, ...eventEntries];
}

/** Narrow entries to one filter (§9's "ALL"/"TRIPS"/"FLIGHTS"/… behaviour). */
export function filterScheduleEntries(
  entries: readonly ScheduleEntry[],
  filter: ScheduleFilterId,
): ScheduleEntry[] {
  if (filter === "all") return [...entries];
  if (filter === "trips") return entries.filter((entry) => entry.kind === "trip");
  return entries.filter((entry) => entry.kind === filter);
}

/** Group entries by date, for the calendar grid's own markers. */
export function groupEntriesByDate(
  entries: readonly ScheduleEntry[],
): Map<DateOnly, ScheduleEntry[]> {
  const byDate = new Map<DateOnly, ScheduleEntry[]>();
  for (const entry of entries) {
    const bucket = byDate.get(entry.date);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDate.set(entry.date, [entry]);
    }
  }
  return byDate;
}

/**
 * §11's Upcoming list: every entry on or after `today`, soonest first, ties broken by `time`
 * (untimed entries sort before timed ones on the same day — an untimed Trip marker reads as
 * "starts sometime that day", which belongs before a 08:40 flight, not after it).
 */
export function upcomingEntries(
  entries: readonly ScheduleEntry[],
  today: DateOnly,
  limit = 8,
): ScheduleEntry[] {
  return entries
    .filter((entry) => !isBeforeStrict(entry.date, today))
    .sort((a, b) => compareDateOnly(a.date, b.date) || compareTimeOrNull(a.time, b.time))
    .slice(0, limit);
}

function isBeforeStrict(a: DateOnly, b: DateOnly): boolean {
  return compareDateOnly(a, b) < 0;
}

function compareTimeOrNull(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** §10's Trip Timeline counts: places (Destinations under this Trip), flights, stays, and every
 * other event (activity/food/note combined, the timeline's own "EVENTS" figure). */
export interface TripStats {
  readonly places: number;
  readonly flights: number;
  readonly stays: number;
  readonly events: number;
}

export function computeTripStats(
  tripId: number,
  events: readonly TravelEvent[],
  placesCount: number,
): TripStats {
  const tripEvents = events.filter((event) => event.trip_id === tripId);
  const flights = tripEvents.filter((event) => event.event_type === "transport").length;
  const stays = tripEvents.filter((event) => event.event_type === "stay").length;
  const other = tripEvents.length - flights - stays;
  return { places: placesCount, flights, stays, events: other };
}

/** Trips ordered soonest-start-first, for the Trip Timeline (§10). */
export function sortTripsByStartDate(trips: readonly Trip[]): Trip[] {
  return [...trips].sort((a, b) => compareDateOnly(a.start_date, b.start_date));
}
