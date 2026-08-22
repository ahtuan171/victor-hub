"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

import { NavDrawer } from "@/components/arcade/NavDrawer";
import type { TravelEvent, TravelEventType, Trip } from "@/lib/api";
import { today as readToday, type DateOnly } from "@/lib/dates";
import { useDestinations } from "@/lib/destinations";
import { periodTitle, shiftPeriod } from "@/lib/period";
import {
  buildScheduleEntries,
  filterScheduleEntries,
  upcomingEntries,
  type ScheduleFilterId,
} from "@/lib/schedule";
import { useTravelEvents } from "@/lib/travelEvents";
import { useTrips } from "@/lib/trips";

import { DayDetailDrawer } from "./DayDetailDrawer";
import { EventFormSheet } from "./EventFormSheet";
import { NewEntryPicker } from "./NewEntryPicker";
import { ScheduleFilters } from "./ScheduleFilters";
import { ScheduleMonthGrid } from "./ScheduleMonthGrid";
import { TripFormSheet } from "./TripFormSheet";
import { TripTimeline } from "./TripTimeline";
import { UpcomingList } from "./UpcomingList";

/**
 * The Travel Schedule surface's shell — Module 02, built from
 * `Module_02_Travel_Schedule_Spec.md` rather than a ratified `spec.md` (see the owner's explicit
 * instruction recorded in this iteration's history to bypass the speckit workflow). Plays the same
 * role `MapShell`/`CalendarShell` play for their own surfaces: it owns the data load, the header,
 * and every overlay's open/closed state; each child component owns its own layout only.
 *
 * §24's target hierarchy — header, summary, calendar, filters, trip timeline, upcoming — is drawn
 * top to bottom in exactly that order, one scrollable column, matching §22's "preserve calendar
 * usability, move Trip Timeline below calendar" mobile guidance (this product ships one layout, not
 * a separate mobile redesign).
 *
 * §7.1: Month view only. §7.1 itself allows this — "keep Month/Week; do not implement Day view
 * unless the existing architecture already supports it cleanly" is about *Day*, but a Week view
 * for this data is a second grid this MVP does not build; `components/calendar/PeriodNav`'s
 * MONTH/WEEK toggle is deliberately not reused here for the same reason. Recorded as a known
 * scope reduction rather than silently dropped.
 */
export function ScheduleShell() {
  const tripsStore = useTrips();
  const eventsStore = useTravelEvents();
  const { destinations } = useDestinations();
  const today = useSyncExternalStore(subscribeToNothing, readToday, readNoToday);

  const [period, setPeriod] = useState<DateOnly | null>(null);
  const [filter, setFilter] = useState<ScheduleFilterId>("all");
  const [openDay, setOpenDay] = useState<DateOnly | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [eventForm, setEventForm] = useState<{
    readonly eventType: TravelEventType;
    readonly event?: TravelEvent;
  } | null>(null);
  const [tripForm, setTripForm] = useState<{ readonly trip?: Trip } | null>(null);

  const effectivePeriod = period ?? today;

  const placesCountByTrip = useMemo(() => {
    const counts = new Map<number, number>();
    for (const destination of destinations) {
      if (destination.trip_id === null) continue;
      counts.set(destination.trip_id, (counts.get(destination.trip_id) ?? 0) + 1);
    }
    return counts;
  }, [destinations]);

  const allEntries = useMemo(
    () => buildScheduleEntries(tripsStore.trips, eventsStore.events),
    [tripsStore.trips, eventsStore.events],
  );
  const filteredEntries = useMemo(
    () => filterScheduleEntries(allEntries, filter),
    [allEntries, filter],
  );
  const upcoming = useMemo(
    () => (today === null ? [] : upcomingEntries(filteredEntries, today)),
    [filteredEntries, today],
  );

  function reload(): void {
    tripsStore.reload();
    eventsStore.reload();
  }

  const dayEvents = eventsStore.events.filter((event) => event.event_date === openDay);
  const tripsStartingOnOpenDay = tripsStore.trips.filter((trip) => trip.start_date === openDay);

  return (
    <div className="bg-surface-0 flex min-h-dvh flex-col" data-testid="schedule-shell">
      <header className="border-hairline flex items-center justify-between gap-2 border-b px-4 pt-4 pb-3">
        <div>
          <p className="text-ink-mid text-xs leading-none font-semibold tracking-[0.18em] uppercase">
            Travel Schedule
          </p>
          <h1 className="text-ink mt-1 text-lg leading-none font-semibold tracking-[0.02em]">
            {effectivePeriod === null ? "" : periodTitle(effectivePeriod, "month")}
          </h1>
        </div>
        <NavDrawer />
      </header>

      <div
        className="border-hairline text-ink-mid flex gap-4 border-b px-4 py-2.5 text-xs font-semibold tracking-[0.06em] uppercase"
        data-testid="schedule-summary"
      >
        <span>{destinations.length} places</span>
        <span>{tripsStore.trips.length} trips</span>
        <span>{eventsStore.events.length} events</span>
      </div>

      {eventsStore.status === "error" || tripsStore.status === "error" ? (
        <p className="text-danger-hi px-4 py-2 text-xs" role="alert">
          {eventsStore.error ?? tripsStore.error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => effectivePeriod !== null && setPeriod(shiftPeriod(effectivePeriod, "month", -1))}
          disabled={effectivePeriod === null}
          aria-label="Previous month"
          className="border-hairline bg-surface-2 text-ink-mid focus-ring h-11 w-10 flex-none rounded-sm border text-base font-semibold disabled:opacity-40"
          data-testid="schedule-period-previous"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          type="button"
          onClick={() => effectivePeriod !== null && setPeriod(shiftPeriod(effectivePeriod, "month", 1))}
          disabled={effectivePeriod === null}
          aria-label="Next month"
          className="border-hairline bg-surface-2 text-ink-mid focus-ring h-11 w-10 flex-none rounded-sm border text-base font-semibold disabled:opacity-40"
          data-testid="schedule-period-next"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {effectivePeriod !== null ? (
        <ScheduleMonthGrid
          period={effectivePeriod}
          today={today}
          entries={filteredEntries}
          onOpenDay={setOpenDay}
        />
      ) : null}

      <ScheduleFilters active={filter} onChange={setFilter} />

      <TripTimeline
        trips={tripsStore.trips}
        events={eventsStore.events}
        placesCountByTrip={placesCountByTrip}
        onOpenTrip={(trip) => setTripForm({ trip })}
      />

      <UpcomingList entries={upcoming} />

      {/* §13's CTA — floats over the bottom band, in thumb reach, matching `QuickAdd`'s own
          anchoring on the map surface. */}
      <div className="sticky bottom-3 mt-auto px-4 pt-4">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="bg-brand focus-ring h-12 w-full rounded-none text-sm font-semibold tracking-[0.16em] text-white uppercase shadow-e2"
          data-testid="schedule-cta"
        >
          + Schedule
        </button>
      </div>

      <DayDetailDrawer
        open={openDay !== null}
        onOpenChange={(open) => {
          if (!open) setOpenDay(null);
        }}
        date={openDay}
        events={dayEvents}
        tripsStartingToday={tripsStartingOnOpenDay}
        onAddEntry={() => {
          setPickerOpen(true);
        }}
        onOpenEvent={(event) => setEventForm({ eventType: event.event_type, event })}
      />

      <NewEntryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPickTrip={() => {
          setPickerOpen(false);
          setTripForm({});
        }}
        onPickEventType={(eventType) => {
          setPickerOpen(false);
          setEventForm({ eventType });
        }}
      />

      {eventForm ? (
        <EventFormSheet
          open
          onOpenChange={(open) => {
            if (!open) setEventForm(null);
          }}
          eventType={eventForm.eventType}
          {...(eventForm.event ? { initialEvent: eventForm.event } : {})}
          {...(openDay !== null ? { defaultDate: openDay } : {})}
          onSaved={reload}
          onDeleted={reload}
        />
      ) : null}

      {tripForm ? (
        <TripFormSheet
          open
          onOpenChange={(open) => {
            if (!open) setTripForm(null);
          }}
          {...(tripForm.trip ? { initialTrip: tripForm.trip } : {})}
          {...(openDay !== null ? { defaultStartDate: openDay } : {})}
          onSaved={reload}
          onDeleted={reload}
        />
      ) : null}
    </div>
  );
}

function subscribeToNothing(): () => void {
  return () => {};
}

function readNoToday(): DateOnly | null {
  return null;
}
