"use client";

import { useId, useState, type ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  ApiError,
  createTravelEvent,
  deleteTravelEvent,
  updateTravelEvent,
  type TravelEvent,
  type TravelEventType,
} from "@/lib/api";
import type { DateOnly } from "@/lib/dates";
import { EVENT_TYPE_LABEL, EVENT_TYPE_SYMBOL } from "@/lib/schedule";

/**
 * §14.2–14.6's progressive event forms, built as one shared component rather than five near-
 * duplicates: every type asks for a title and a date, and the type-specific fields below
 * (`from_location`/`to_location` for transport, `category` for activity, and so on) are the only
 * real difference between them — see `TravelEvent`'s own docstring in `app/models.py` for the
 * same reasoning on the backend side.
 *
 * One instance handles both create (`initialEvent` absent) and edit (`initialEvent` present) —
 * the same split `ItemSheet` draws for content items. `eventType` is fixed for the lifetime of a
 * mount: creating switches type by closing and reopening from the picker (`NewEntryPicker`),
 * editing never changes an event's type at all.
 *
 * **`event-form-delete`/`event-form-cancel` sit in the footer's bottom-left corner, which
 * `pnpm dev`'s Next.js Dev Tools indicator also occupies.** Found running `tests/e2e/
 * schedule.spec.ts`'s delete flow under `pnpm dev`: the indicator (invisible to `pageerror`/
 * `console` listeners — it is not an error, just chrome) intercepts the click. `pnpm build &&
 * pnpm start` (what CI runs, per `playwright.config.ts`) has no such indicator and the same test
 * passes there — this is the same class of environment-only gap `CLAUDE.md` already documents for
 * the calendar's own MONTH toggle. Not fixed here, for the same reason that one was not: CI is
 * unaffected, and reshaping this footer to dodge one corner of one local dev tool is not worth
 * doing until it costs something real.
 */
export function EventFormSheet({
  open,
  onOpenChange,
  eventType,
  initialEvent,
  defaultDate,
  defaultTripId,
  onSaved,
  onDeleted,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly eventType: TravelEventType;
  readonly initialEvent?: TravelEvent;
  readonly defaultDate?: DateOnly;
  readonly defaultTripId?: number | null;
  readonly onSaved: () => void;
  readonly onDeleted?: () => void;
}) {
  const titleId = useId();
  const errorId = useId();

  const [title, setTitle] = useState(initialEvent?.title ?? "");
  const [date, setDate] = useState(initialEvent?.event_date ?? defaultDate ?? "");
  const [time, setTime] = useState(toTimeInputValue(initialEvent?.start_time ?? null));
  const [location, setLocation] = useState(initialEvent?.location ?? "");
  const [fromLocation, setFromLocation] = useState(initialEvent?.from_location ?? "");
  const [toLocation, setToLocation] = useState(initialEvent?.to_location ?? "");
  const [bookingReference, setBookingReference] = useState(initialEvent?.booking_reference ?? "");
  const [category, setCategory] = useState(initialEvent?.category ?? "");
  const [notes, setNotes] = useState(initialEvent?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmedTitle = title.trim();
  const valid = trimmedTitle !== "" && date !== "";

  async function save(): Promise<void> {
    if (!valid || saving) return;

    setSaving(true);
    setError(null);

    const body = {
      event_type: eventType,
      title: trimmedTitle,
      event_date: date,
      start_time: time === "" ? null : `${time}:00`,
      location: blankToNull(location),
      from_location: blankToNull(fromLocation),
      to_location: blankToNull(toLocation),
      booking_reference: blankToNull(bookingReference),
      category: blankToNull(category),
      notes: blankToNull(notes),
    };

    try {
      if (initialEvent) {
        await updateTravelEvent(initialEvent.id, body);
      } else {
        await createTravelEvent({ ...body, trip_id: defaultTripId ?? null });
      }
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : "Could not save that entry. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (!initialEvent || saving) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTravelEvent(initialEvent.id);
      onOpenChange(false);
      onDeleted?.();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : "Could not delete that entry. Try again.");
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="bg-surface-1 border-hairline max-h-[85dvh] gap-0 overflow-y-auto p-0 shadow-e2"
        aria-describedby={errorId}
      >
        <div className="flex items-center gap-2.5 px-4 pt-4">
          <span className="bg-ink-lo/50 h-[3px] w-[34px] rounded-sm" aria-hidden="true" />
          <SheetTitle className="text-ink leading-none tracking-[0.18em]">
            {EVENT_TYPE_SYMBOL[eventType]} {initialEvent ? "Edit" : "New"} {EVENT_TYPE_LABEL[eventType]}
          </SheetTitle>
        </div>

        <div className="flex flex-col gap-3 px-4 pt-3.5">
          <Field label="Title">
            <input
              id={titleId}
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder={placeholderTitleFor(eventType)}
              className="border-hairline bg-surface-3 text-ink placeholder:text-ink-lo focus-ring h-12 w-full rounded-sm border px-3 text-base"
              data-testid="event-form-title"
            />
          </Field>

          {eventType === "transport" ? (
            <div className="flex gap-3">
              <Field label="From" className="flex-1">
                <input
                  value={fromLocation}
                  onChange={(event) => setFromLocation(event.target.value)}
                  maxLength={120}
                  className="border-hairline bg-surface-3 text-ink focus-ring h-12 w-full rounded-sm border px-3 text-base"
                  data-testid="event-form-from"
                />
              </Field>
              <Field label="To" className="flex-1">
                <input
                  value={toLocation}
                  onChange={(event) => setToLocation(event.target.value)}
                  maxLength={120}
                  className="border-hairline bg-surface-3 text-ink focus-ring h-12 w-full rounded-sm border px-3 text-base"
                  data-testid="event-form-to"
                />
              </Field>
            </div>
          ) : null}

          {eventType === "stay" || eventType === "activity" || eventType === "food" ? (
            <Field label={eventType === "stay" ? "Location" : "Place"}>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                maxLength={200}
                className="border-hairline bg-surface-3 text-ink focus-ring h-12 w-full rounded-sm border px-3 text-base"
                data-testid="event-form-location"
              />
            </Field>
          ) : null}

          {eventType === "activity" ? (
            <Field label="Category">
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                maxLength={60}
                placeholder="Photography"
                className="border-hairline bg-surface-3 text-ink placeholder:text-ink-lo focus-ring h-12 w-full rounded-sm border px-3 text-base"
                data-testid="event-form-category"
              />
            </Field>
          ) : null}

          <div className="flex gap-3">
            <Field label={eventType === "stay" ? "Check-in" : "Date"} className="flex-1">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="border-hairline bg-surface-3 text-ink focus-ring h-12 w-full rounded-sm border px-3 text-base"
                data-testid="event-form-date"
              />
            </Field>
            <Field label="Time" className="flex-1">
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="border-hairline bg-surface-3 text-ink focus-ring h-12 w-full rounded-sm border px-3 text-base"
                data-testid="event-form-time"
              />
            </Field>
          </div>

          {eventType === "transport" || eventType === "stay" ? (
            <Field label="Booking reference">
              <input
                value={bookingReference}
                onChange={(event) => setBookingReference(event.target.value)}
                maxLength={120}
                placeholder="Optional"
                className="border-hairline bg-surface-3 text-ink placeholder:text-ink-lo focus-ring h-12 w-full rounded-sm border px-3 text-base"
                data-testid="event-form-booking-reference"
              />
            </Field>
          ) : null}

          <Field label={eventType === "note" ? "Content" : "Notes"}>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Optional"
              className="border-hairline bg-surface-3 text-ink placeholder:text-ink-lo focus-ring w-full resize-none rounded-sm border px-3 py-2 text-base"
              data-testid="event-form-notes"
            />
          </Field>

          <SheetDescription
            id={errorId}
            role={error !== null ? "alert" : undefined}
            className={error !== null ? "text-danger-hi text-xs leading-relaxed" : "sr-only"}
          >
            {error ?? ""}
          </SheetDescription>
        </div>

        <div className="flex gap-2.5 px-4 pt-4 pb-4.5">
          {initialEvent ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={saving}
              className="border-hairline text-danger-hi focus-ring h-12 flex-none rounded-sm border px-4.5 text-xs font-semibold tracking-[0.16em] uppercase disabled:opacity-50"
              data-testid="event-form-delete"
            >
              Delete
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="border-hairline text-ink-mid focus-ring h-12 flex-none rounded-sm border px-4.5 text-xs font-semibold tracking-[0.16em] uppercase"
              data-testid="event-form-cancel"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || saving}
            className="bg-brand focus-ring h-12 flex-1 rounded-none text-sm font-semibold tracking-[0.16em] text-white uppercase shadow-e1 disabled:opacity-50"
            data-testid="event-form-save"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="text-ink-mid mb-1.5 block text-xs leading-none font-semibold tracking-[0.16em] uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function placeholderTitleFor(eventType: TravelEventType): string {
  switch (eventType) {
    case "transport":
      return "SGN → NRT";
    case "stay":
      return "Hotel check-in";
    case "activity":
      return "Shibuya";
    case "food":
      return "Sushi dinner";
    case "note":
      return "Pack bags";
  }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `HH:MM:SS \| null` (the API) to `HH:MM` (an `<input type="time">`'s own value shape). */
function toTimeInputValue(startTime: string | null): string {
  return startTime === null ? "" : startTime.slice(0, 5);
}
