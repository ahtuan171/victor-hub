"use client";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TRAVEL_EVENT_TYPES, type TravelEventType } from "@/lib/api";
import { EVENT_TYPE_LABEL, EVENT_TYPE_SYMBOL, TRIP_SYMBOL } from "@/lib/schedule";

/**
 * §13's "NEW TRAVEL ENTRY" picker — the `+ SCHEDULE` action's first step. A Trip is offered as a
 * distinct first choice alongside the five `TravelEventType`s, never as a sixth member of that
 * enum (see `TravelEventType`'s own docstring in `app/models.py` for why).
 */
export function NewEntryPicker({
  open,
  onOpenChange,
  onPickTrip,
  onPickEventType,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPickTrip: () => void;
  readonly onPickEventType: (eventType: TravelEventType) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="bg-surface-1 border-hairline gap-0 p-0 shadow-e2"
      >
        <div className="flex items-center gap-2.5 px-4 pt-4">
          <span className="bg-ink-lo/50 h-[3px] w-[34px] rounded-sm" aria-hidden="true" />
          <SheetTitle className="text-ink leading-none tracking-[0.18em]">New travel entry</SheetTitle>
        </div>

        <div className="flex flex-col gap-2 px-4 pt-3.5 pb-4.5">
          <button
            type="button"
            onClick={onPickTrip}
            className="border-hairline bg-surface-2 text-ink focus-ring flex h-12 items-center gap-2.5 rounded-sm border px-3.5 text-sm font-semibold tracking-[0.04em] uppercase"
            data-testid="new-entry-trip"
          >
            <span aria-hidden="true">{TRIP_SYMBOL}</span>
            Trip
          </button>

          {TRAVEL_EVENT_TYPES.map((eventType) => (
            <button
              key={eventType}
              type="button"
              onClick={() => onPickEventType(eventType)}
              className="border-hairline bg-surface-2 text-ink focus-ring flex h-12 items-center gap-2.5 rounded-sm border px-3.5 text-sm font-semibold tracking-[0.04em] uppercase"
              data-testid={`new-entry-${eventType}`}
            >
              <span aria-hidden="true">{EVENT_TYPE_SYMBOL[eventType]}</span>
              {EVENT_TYPE_LABEL[eventType]}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
