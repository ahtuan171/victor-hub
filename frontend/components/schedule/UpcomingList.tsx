"use client";

import { formatDateOnlyShort } from "@/lib/period";
import { EVENT_TYPE_SYMBOL, TRIP_SYMBOL, type ScheduleEntry } from "@/lib/schedule";

/**
 * §11's Upcoming section: a compact chronological list below the Trip Timeline. §11 also asks a
 * useful empty state rather than invented placeholder data — met here by rendering nothing but the
 * empty state itself when `entries` is empty.
 */
export function UpcomingList({ entries }: { readonly entries: readonly ScheduleEntry[] }) {
  if (entries.length === 0) {
    return (
      <section aria-label="Upcoming" className="px-4 py-6 text-center" data-testid="upcoming-empty">
        <p className="text-ink text-sm font-semibold">No upcoming travel events</p>
      </section>
    );
  }

  return (
    <section aria-label="Upcoming" className="flex flex-col pb-4" data-testid="upcoming-list">
      <h2 className="text-ink-mid px-4 pt-4 pb-2 text-xs leading-none font-semibold tracking-[0.18em] uppercase">
        Upcoming
      </h2>
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li
            key={`${entry.kind}-${entry.refId}`}
            className="border-hairline flex items-center gap-3 border-t px-4 py-2.5"
          >
            <span className="text-ink-lo w-12 flex-none text-xs font-semibold tracking-[0.04em]">
              {formatDateOnlyShort(entry.date)}
            </span>
            <span aria-hidden="true" className="text-ink-mid flex-none">
              {entry.kind === "trip" ? TRIP_SYMBOL : EVENT_TYPE_SYMBOL[entry.kind]}
            </span>
            <span className="text-ink truncate text-sm">{entry.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
