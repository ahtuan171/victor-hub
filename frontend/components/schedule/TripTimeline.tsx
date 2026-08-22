"use client";

import type { TravelEvent, Trip } from "@/lib/api";
import { formatDateOnlyShort } from "@/lib/period";
import { computeTripStats, sortTripsByStartDate } from "@/lib/schedule";

/**
 * §10's Trip Timeline: every Trip as a date-range entity, soonest-first, with its place/flight/
 * stay/event counts. Deliberately plain — §10 itself says "do not make the timeline overly
 * decorative; it is primarily an information hierarchy element", so this is a list of rows, not a
 * gantt chart.
 */
export function TripTimeline({
  trips,
  events,
  placesCountByTrip,
  onOpenTrip,
}: {
  readonly trips: readonly Trip[];
  readonly events: readonly TravelEvent[];
  /** Destination count per Trip, from Module 01's own data — §16's "reuse place entities". */
  readonly placesCountByTrip: ReadonlyMap<number, number>;
  readonly onOpenTrip: (trip: Trip) => void;
}) {
  const ordered = sortTripsByStartDate(trips);

  if (ordered.length === 0) {
    return (
      <section aria-label="Trip timeline" className="px-4 py-6 text-center" data-testid="trip-timeline-empty">
        <p className="text-ink text-sm font-semibold">No trips scheduled</p>
        <p className="text-ink-mid mt-1 text-xs leading-relaxed">Your next journey starts here.</p>
      </section>
    );
  }

  return (
    <section aria-label="Trip timeline" className="flex flex-col" data-testid="trip-timeline">
      <h2 className="text-ink-mid px-4 pt-4 pb-2 text-xs leading-none font-semibold tracking-[0.18em] uppercase">
        Trip timeline
      </h2>
      <ul className="flex flex-col">
        {ordered.map((trip) => {
          const stats = computeTripStats(trip.id, events, placesCountByTrip.get(trip.id) ?? 0);
          return (
            <li key={trip.id} className="border-hairline border-t">
              <button
                type="button"
                onClick={() => onOpenTrip(trip)}
                className="focus-ring-inset flex w-full flex-col gap-1.5 px-4 py-3 text-left"
                data-testid={`trip-timeline-row-${trip.id}`}
              >
                <span className="text-ink text-sm font-semibold uppercase tracking-[0.04em]">
                  {trip.destination ?? trip.name}
                </span>
                <span className="text-ink-mid text-xs">
                  {formatDateOnlyShort(trip.start_date)} – {formatDateOnlyShort(trip.end_date)}
                </span>
                <span className="text-ink-mid flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>◆ {stats.places} places</span>
                  <span>✈ {stats.flights} flights</span>
                  <span>⌂ {stats.stays} stay</span>
                  <span>◇ {stats.events} events</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
