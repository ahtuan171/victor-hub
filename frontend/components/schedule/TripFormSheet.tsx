"use client";

import { useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ApiError, createTrip, deleteTrip, updateTrip, type Trip } from "@/lib/api";
import type { DateOnly } from "@/lib/dates";

/** §14.1's Trip form: name, destination, start/end date, notes — one instance for both create
 * (`initialTrip` absent) and edit (`initialTrip` present), the same split `EventFormSheet` draws. */
export function TripFormSheet({
  open,
  onOpenChange,
  initialTrip,
  defaultStartDate,
  onSaved,
  onDeleted,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initialTrip?: Trip;
  readonly defaultStartDate?: DateOnly;
  readonly onSaved: () => void;
  readonly onDeleted?: () => void;
}) {
  const [name, setName] = useState(initialTrip?.name ?? "");
  const [destination, setDestination] = useState(initialTrip?.destination ?? "");
  const [startDate, setStartDate] = useState(initialTrip?.start_date ?? defaultStartDate ?? "");
  const [endDate, setEndDate] = useState(initialTrip?.end_date ?? defaultStartDate ?? "");
  const [notes, setNotes] = useState(initialTrip?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const valid = trimmedName !== "" && startDate !== "" && endDate !== "" && startDate <= endDate;

  async function save(): Promise<void> {
    if (!valid || saving) return;

    setSaving(true);
    setError(null);

    const body = {
      name: trimmedName,
      destination: destination.trim() === "" ? null : destination.trim(),
      start_date: startDate,
      end_date: endDate,
      notes: notes.trim() === "" ? null : notes.trim(),
    };

    try {
      if (initialTrip) {
        await updateTrip(initialTrip.id, body);
      } else {
        await createTrip(body);
      }
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : "Could not save that trip. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (!initialTrip || saving) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTrip(initialTrip.id);
      onOpenChange(false);
      onDeleted?.();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : "Could not delete that trip. Try again.");
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="bg-surface-1 border-hairline max-h-[85dvh] gap-0 overflow-y-auto p-0 shadow-e2"
      >
        <div className="flex items-center gap-2.5 px-4 pt-4">
          <span className="bg-ink-lo/50 h-[3px] w-[34px] rounded-sm" aria-hidden="true" />
          <SheetTitle className="text-ink leading-none tracking-[0.18em]">
            ◆ {initialTrip ? "Edit" : "New"} trip
          </SheetTitle>
        </div>

        <div className="flex flex-col gap-3 px-4 pt-3.5">
          <label className="block">
            <span className="text-ink-mid mb-1.5 block text-xs leading-none font-semibold tracking-[0.16em] uppercase">
              Trip name
            </span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              placeholder="Summer Getaway"
              className="border-hairline bg-surface-3 text-ink placeholder:text-ink-lo focus-ring h-12 w-full rounded-sm border px-3 text-base"
              data-testid="trip-form-name"
            />
          </label>

          <label className="block">
            <span className="text-ink-mid mb-1.5 block text-xs leading-none font-semibold tracking-[0.16em] uppercase">
              Destination
            </span>
            <input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              maxLength={200}
              placeholder="Tokyo, Japan"
              className="border-hairline bg-surface-3 text-ink placeholder:text-ink-lo focus-ring h-12 w-full rounded-sm border px-3 text-base"
              data-testid="trip-form-destination"
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-ink-mid mb-1.5 block text-xs leading-none font-semibold tracking-[0.16em] uppercase">
                Start date
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="border-hairline bg-surface-3 text-ink focus-ring h-12 w-full rounded-sm border px-3 text-base"
                data-testid="trip-form-start-date"
              />
            </label>
            <label className="block flex-1">
              <span className="text-ink-mid mb-1.5 block text-xs leading-none font-semibold tracking-[0.16em] uppercase">
                End date
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="border-hairline bg-surface-3 text-ink focus-ring h-12 w-full rounded-sm border px-3 text-base"
                data-testid="trip-form-end-date"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-ink-mid mb-1.5 block text-xs leading-none font-semibold tracking-[0.16em] uppercase">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Optional"
              className="border-hairline bg-surface-3 text-ink placeholder:text-ink-lo focus-ring w-full resize-none rounded-sm border px-3 py-2 text-base"
              data-testid="trip-form-notes"
            />
          </label>

          <SheetDescription
            role={error !== null ? "alert" : undefined}
            className={error !== null ? "text-danger-hi text-xs leading-relaxed" : "sr-only"}
          >
            {error ?? ""}
          </SheetDescription>
        </div>

        <div className="flex gap-2.5 px-4 pt-4 pb-4.5">
          {initialTrip ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={saving}
              className="border-hairline text-danger-hi focus-ring h-12 flex-none rounded-sm border px-4.5 text-xs font-semibold tracking-[0.16em] uppercase disabled:opacity-50"
              data-testid="trip-form-delete"
            >
              Delete
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="border-hairline text-ink-mid focus-ring h-12 flex-none rounded-sm border px-4.5 text-xs font-semibold tracking-[0.16em] uppercase"
              data-testid="trip-form-cancel"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || saving}
            className="bg-brand focus-ring h-12 flex-1 rounded-none text-sm font-semibold tracking-[0.16em] text-white uppercase shadow-e1 disabled:opacity-50"
            data-testid="trip-form-save"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
