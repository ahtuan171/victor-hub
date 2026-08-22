"use client";

import { SCHEDULE_FILTERS, type ScheduleFilterId } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/** §9's compact filter row. `ALL`/`TRIPS`/`FLIGHTS`/`STAYS`/`ACTIVITIES` plus `FOOD`/`NOTES` — §9
 * allows the last two "if implemented as first-class event types", which they are here. */
export function ScheduleFilters({
  active,
  onChange,
}: {
  readonly active: ScheduleFilterId;
  readonly onChange: (filter: ScheduleFilterId) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Status"
      // `flex-none` is load-bearing, not decoration: `ScheduleShell`'s outer container is
      // `flex flex-col`, and a flex item whose own `overflow-x` is non-`visible` gets its
      // automatic minimum size reset to 0 on the main (vertical, in a column) axis — CSS
      // Flexbox's "automatic minimum size" rule. Without `flex-none`, whenever the page's total
      // content is taller than the viewport, this row was the one the browser chose to shrink,
      // down to ~20px — shorter than its own 36px-tall buttons. Because `overflow-x` was
      // non-visible, the CSS overflow spec also forced the *other* axis's computed `overflow-y`
      // to `auto` (never `visible` unless both axes are), so the squashed row grew its own
      // vertical scrollbar instead of simply flowing with the rest of the page — the "boxed-in,
      // scrolls on its own" look reported against a real screenshot. `flex-none` fixes this row
      // to its content size on the vertical axis, so it never shrinks and never needs a
      // scrollbar of its own; the horizontal scroll (`overflow-x-auto`, for when the seven
      // filters do not fit one row) is unaffected.
      className="flex flex-none gap-2 overflow-x-auto px-4 py-2.5"
      data-testid="schedule-filters"
    >
      {SCHEDULE_FILTERS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={active === id}
          onClick={() => onChange(id)}
          className={cn(
            "border-hairline focus-ring h-9 flex-none rounded-sm border px-3 text-xs font-semibold tracking-[0.1em] whitespace-nowrap uppercase",
            active === id ? "bg-brand border-brand text-white" : "bg-surface-2 text-ink-mid",
          )}
          data-testid={`schedule-filter-${id}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
