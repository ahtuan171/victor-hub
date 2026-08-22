"use client";

import type { DateOnly } from "@/lib/dates";
import { periodDays, WEEKDAY_INITIALS } from "@/lib/period";
import { EVENT_TYPE_SYMBOL, TRIP_SYMBOL, groupEntriesByDate, type ScheduleEntry } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/**
 * The Travel Schedule's month grid (Module 02, §7). Built from `lib/period.ts` — the same pure
 * six-week span `components/calendar/MonthGrid.tsx` already uses, so this grid and the Content
 * Calendar's own never disagree about where a week starts. No drag-and-drop here (unlike that
 * grid): §22 asks this surface to feel like an instrument to scan, not a board to rearrange.
 */
export function ScheduleMonthGrid({
  period,
  today,
  entries,
  onOpenDay,
}: {
  readonly period: DateOnly;
  readonly today: DateOnly | null;
  readonly entries: readonly ScheduleEntry[];
  readonly onOpenDay: (date: DateOnly) => void;
}) {
  const byDay = groupEntriesByDate(entries);

  return (
    <section aria-label="Month" data-testid="schedule-month-grid">
      <div
        className="border-hairline/60 bg-surface-0 grid grid-cols-7 border-y"
        aria-hidden="true"
      >
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span
            key={index}
            className="text-ink-lo text-center text-xs leading-6 font-semibold tracking-[0.1em]"
          >
            {initial}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {periodDays(period, "month").map((day) => (
          <ScheduleDayCell
            key={day.date}
            date={day.date}
            dayNumber={day.dayOfMonth}
            inPeriod={day.inPeriod}
            isToday={today !== null && day.date === today}
            entries={byDay.get(day.date) ?? EMPTY}
            onOpen={onOpenDay}
          />
        ))}
      </div>
    </section>
  );
}

function ScheduleDayCell({
  date,
  dayNumber,
  inPeriod,
  isToday,
  entries,
  onOpen,
}: {
  readonly date: DateOnly;
  readonly dayNumber: number;
  readonly inPeriod: boolean;
  readonly isToday: boolean;
  readonly entries: readonly ScheduleEntry[];
  readonly onOpen: (date: DateOnly) => void;
}) {
  // §7.2: compact markers, never a full title per marker — a symbol plus, for at most the first
  // two entries, its own title. A 68px cell has room for two lines beyond the day number.
  const visible = entries.slice(0, 2);
  const hidden = entries.length - visible.length;

  return (
    <button
      type="button"
      onClick={() => onOpen(date)}
      className={cn(
        "border-hairline/60 relative flex min-h-[68px] flex-col gap-[3px] border-r border-b px-[3px] pt-4 pb-[3px] text-left last:border-r-0",
        inPeriod ? "bg-surface-1" : "bg-surface-0",
        isToday && "ring-brand ring-2 ring-inset",
      )}
      data-date={date}
      data-in-period={inPeriod ? "" : undefined}
      data-testid="schedule-day-cell"
    >
      <span
        className={cn(
          "absolute top-[3px] right-1 text-xs leading-none font-semibold",
          inPeriod ? "text-ink-mid" : "text-ink-lo/60",
        )}
        aria-hidden="true"
      >
        {dayNumber}
      </span>

      {visible.map((entry) => (
        <span
          key={`${entry.kind}-${entry.refId}`}
          className="text-ink-mid flex items-center gap-1 truncate text-[10px] leading-tight"
        >
          <span aria-hidden="true">{symbolFor(entry)}</span>
          <span className="truncate">{entry.title}</span>
        </span>
      ))}

      {hidden > 0 ? (
        <span className="text-ink-lo text-[10px] leading-none font-semibold" data-testid="schedule-day-overflow">
          +{hidden} more
        </span>
      ) : null}
    </button>
  );
}

function symbolFor(entry: ScheduleEntry): string {
  return entry.kind === "trip" ? TRIP_SYMBOL : EVENT_TYPE_SYMBOL[entry.kind];
}

const EMPTY: readonly ScheduleEntry[] = [];
