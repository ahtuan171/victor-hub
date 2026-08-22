"use client";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { TravelEvent, Trip } from "@/lib/api";
import type { DateOnly } from "@/lib/dates";
import { EVENT_TYPE_SYMBOL, TRIP_SYMBOL } from "@/lib/schedule";

/**
 * §12's Day Detail panel: chronological events for one day, plus any Trip that starts that day.
 * Reuses the existing `Sheet` primitive (`.claude/rules/design.md`: "prefer an existing drawer/
 * panel/modal pattern"), the same one `EventFormSheet`/`TripFormSheet`/`NewEntryPicker` build on.
 *
 * Only TravelEvents are directly editable from here — a Trip starting this day is shown for
 * context (§12's "trip context, if applicable") but opens through `TripTimeline`'s own row, not
 * through this panel, keeping one place responsible for editing a Trip.
 */
export function DayDetailDrawer({
  open,
  onOpenChange,
  date,
  events,
  tripsStartingToday,
  onAddEntry,
  onOpenEvent,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly date: DateOnly | null;
  readonly events: readonly TravelEvent[];
  readonly tripsStartingToday: readonly Trip[];
  readonly onAddEntry: () => void;
  readonly onOpenEvent: (event: TravelEvent) => void;
}) {
  const sorted = [...events].sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton
        className="bg-surface-1 border-hairline flex max-h-[85dvh] flex-col gap-0 p-0 shadow-e2"
      >
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <span className="bg-ink-lo/50 h-[3px] w-[34px] rounded-sm" aria-hidden="true" />
          <SheetTitle className="text-ink leading-none tracking-[0.18em]" data-testid="day-detail-title">
            {date ?? ""}
          </SheetTitle>
        </div>

        <div className="flex-1 overflow-y-auto px-4" data-testid="day-detail-list">
          {tripsStartingToday.map((trip) => (
            <div
              key={`trip-${trip.id}`}
              className="border-hairline flex items-center gap-3 border-t py-2.5"
              data-testid={`day-detail-trip-${trip.id}`}
            >
              <span aria-hidden="true" className="text-ink-mid w-12 flex-none text-xs">
                {TRIP_SYMBOL}
              </span>
              <span className="text-ink text-sm">{trip.destination ?? trip.name} begins</span>
            </div>
          ))}

          {sorted.length === 0 && tripsStartingToday.length === 0 ? (
            <div className="py-8 text-center" data-testid="day-detail-empty">
              <p className="text-ink text-sm font-semibold">No travel events</p>
            </div>
          ) : (
            sorted.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onOpenEvent(event)}
                className="border-hairline focus-ring-inset flex w-full items-center gap-3 border-t py-2.5 text-left"
                data-testid={`day-detail-event-${event.id}`}
              >
                <span className="text-ink-mid w-12 flex-none text-xs font-semibold">
                  {event.start_time ? event.start_time.slice(0, 5) : ""}
                </span>
                <span aria-hidden="true" className="text-ink-mid flex-none">
                  {EVENT_TYPE_SYMBOL[event.event_type]}
                </span>
                <span className="text-ink truncate text-sm">{event.title}</span>
              </button>
            ))
          )}
        </div>

        <div className="px-4 pt-3 pb-4.5">
          <button
            type="button"
            onClick={onAddEntry}
            className="bg-brand focus-ring h-12 w-full rounded-none text-sm font-semibold tracking-[0.16em] text-white uppercase shadow-e1"
            data-testid="day-detail-add-entry"
          >
            + Add entry
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
