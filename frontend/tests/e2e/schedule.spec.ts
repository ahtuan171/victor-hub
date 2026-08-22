import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * The Travel Schedule surface (Module 02) at the 375x667 floor — built from
 * `Module_02_Travel_Schedule_Spec.md` rather than a ratified `spec.md`; see the owner's explicit
 * instruction recorded in this iteration's history to bypass the speckit workflow.
 *
 * The proxy is stubbed, as every other e2e file here does — CI has no FastAPI behind the bundle.
 * `backend/tests/test_travel_events.py` and `test_trips.py` cover the CRUD contract itself; this
 * file walks §31's Definition of Done through the browser: open the schedule, create a Trip, add
 * an event, see both on the calendar and in the Trip Timeline, open a day, edit and delete an
 * event, and filter.
 */

const SESSION_COOKIE = "ch_session";
const NOW = Date.UTC(2026, 7, 4, 9, 0, 0); // 2026-08-04

test.use({ timezoneId: "Asia/Bangkok" });

interface StubTrip {
  id: number;
  name: string;
  destination: string | null;
  start_date: string;
  end_date: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface StubEvent {
  id: number;
  trip_id: number | null;
  event_type: string;
  title: string;
  event_date: string;
  start_time: string | null;
  location: string | null;
  from_location: string | null;
  to_location: string | null;
  booking_reference: string | null;
  category: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Stubs `/api/trips*`, `/api/travel-events*`, and `/api/destinations*`, holding state across
 * requests in one test the way `item-sheet.spec.ts`'s own `stubApi` does. */
async function stubApi(
  page: Page,
  { trips = [], events = [] }: { trips?: StubTrip[]; events?: StubEvent[] } = {},
): Promise<void> {
  let nextTripId = trips.reduce((max, trip) => Math.max(max, trip.id), 0) + 1;
  let nextEventId = events.reduce((max, event) => Math.max(max, event.id), 0) + 1;

  const tripsHandle = async (route: Route): Promise<void> => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(trips) });
      return;
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Partial<StubTrip>;
      const created: StubTrip = {
        id: nextTripId++,
        name: body.name ?? "",
        destination: body.destination ?? null,
        start_date: body.start_date ?? "",
        end_date: body.end_date ?? "",
        status: body.status ?? "wishlist",
        notes: body.notes ?? null,
        created_at: "2026-08-04T09:00:00Z",
        updated_at: "2026-08-04T09:00:00Z",
      };
      trips = [...trips, created];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
      return;
    }
    const idMatch = /\/trips\/(\d+)$/.exec(request.url());
    const id = idMatch ? Number(idMatch[1]) : -1;
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as Partial<StubTrip>;
      trips = trips.map((trip) => (trip.id === id ? { ...trip, ...body } : trip));
      const updated = trips.find((trip) => trip.id === id)!;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(updated) });
      return;
    }
    if (request.method() === "DELETE") {
      trips = trips.filter((trip) => trip.id !== id);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.continue();
  };

  const eventsHandle = async (route: Route): Promise<void> => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(events) });
      return;
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Partial<StubEvent>;
      const created: StubEvent = {
        id: nextEventId++,
        trip_id: body.trip_id ?? null,
        event_type: body.event_type ?? "note",
        title: body.title ?? "",
        event_date: body.event_date ?? "",
        start_time: body.start_time ?? null,
        location: body.location ?? null,
        from_location: body.from_location ?? null,
        to_location: body.to_location ?? null,
        booking_reference: body.booking_reference ?? null,
        category: body.category ?? null,
        notes: body.notes ?? null,
        created_at: "2026-08-04T09:00:00Z",
        updated_at: "2026-08-04T09:00:00Z",
      };
      events = [...events, created];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
      return;
    }
    const idMatch = /\/travel-events\/(\d+)$/.exec(request.url());
    const id = idMatch ? Number(idMatch[1]) : -1;
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as Partial<StubEvent>;
      events = events.map((event) => (event.id === id ? { ...event, ...body } : event));
      const updated = events.find((event) => event.id === id)!;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(updated) });
      return;
    }
    if (request.method() === "DELETE") {
      events = events.filter((event) => event.id !== id);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.continue();
  };

  await page.route("**/api/trips", tripsHandle);
  await page.route("**/api/trips/*", tripsHandle);
  await page.route("**/api/travel-events", eventsHandle);
  // A trailing `*` with no `/` before it does not match a path segment in Playwright's glob
  // syntax (`*` excludes `/`; only `**` crosses one) — `**/api/travel-events*` therefore never
  // matched `.../travel-events/1`, and that PATCH silently fell through to the real dev server,
  // which 404'd. Found the hard way chasing a "the edit never round-trips" failure.
  await page.route("**/api/travel-events/*", eventsHandle);
  await page.route("**/api/destinations*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function openSchedule(page: Page, baseURL: string | undefined): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.context().addCookies([{ name: SESSION_COOKIE, value: "stub-session", url: baseURL! }]);
  await page.goto("/schedule");
  await page.getByTestId("schedule-shell").waitFor();
}

test("the empty state names what to do next (§21)", async ({ page, baseURL }) => {
  await stubApi(page);
  await openSchedule(page, baseURL);

  await expect(page.getByTestId("trip-timeline-empty")).toContainText("No trips scheduled");
  await expect(page.getByTestId("upcoming-empty")).toContainText("No upcoming travel events");
});

test("creating a Trip shows it in the Trip Timeline and on the calendar", async ({ page, baseURL }) => {
  await stubApi(page);
  await openSchedule(page, baseURL);

  await page.getByTestId("schedule-cta").click();
  await page.getByTestId("new-entry-trip").click();

  await page.getByTestId("trip-form-name").fill("Japan Summer 2026");
  await page.getByTestId("trip-form-destination").fill("Tokyo, Japan");
  await page.getByTestId("trip-form-start-date").fill("2026-08-22");
  await page.getByTestId("trip-form-end-date").fill("2026-08-28");
  await page.getByTestId("trip-form-save").click();

  await expect(page.getByTestId("trip-timeline")).toContainText("Tokyo, Japan");
  await expect(page.getByTestId("upcoming-list")).toContainText("Tokyo, Japan");
});

test("adding a travel event to a day shows it on that day, editable and deletable", async ({
  page,
  baseURL,
}) => {
  await stubApi(page, {
    trips: [
      {
        id: 1,
        name: "Japan Summer 2026",
        destination: "Tokyo, Japan",
        start_date: "2026-08-22",
        end_date: "2026-08-28",
        status: "planned",
        notes: null,
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
    ],
  });
  await openSchedule(page, baseURL);

  // Open the 23rd via the month grid's own cell — August 2026 draws in the current month by
  // default since the clock is pinned to 2026-08-04.
  await page.locator('[data-testid="schedule-day-cell"][data-date="2026-08-23"]').click();
  await expect(page.getByTestId("day-detail-title")).toHaveText("2026-08-23");

  await page.getByTestId("day-detail-add-entry").click();
  await page.getByTestId("new-entry-activity").click();

  await page.getByTestId("event-form-title").fill("Shibuya");
  await page.getByTestId("event-form-location").fill("Shibuya, Tokyo");
  await page.getByTestId("event-form-date").fill("2026-08-23");
  await page.getByTestId("event-form-save").click();

  // Saving closes only the event form — the Day Detail drawer underneath stays open and now
  // shows the new entry, so the rest of this flow works inside it rather than re-opening the day
  // through the calendar cell (which the drawer's own overlay still covers).
  await expect(page.getByTestId("day-detail-list")).toContainText("Shibuya");
  await expect(page.locator('[data-testid="schedule-day-cell"][data-date="2026-08-23"]')).toContainText(
    "Shibuya",
  );

  // Edit the title, and confirm the change round-trips back into the still-open drawer.
  await page.getByTestId(/^day-detail-event-/).click();
  await page.getByTestId("event-form-title").fill("Shibuya Crossing");
  await page.getByTestId("event-form-save").click();
  await expect(page.getByTestId("day-detail-list")).toContainText("Shibuya Crossing");

  // Delete it, and the day goes empty.
  await page.getByTestId(/^day-detail-event-/).click();
  await page.getByTestId("event-form-delete").click();
  await expect(page.getByTestId("day-detail-empty")).toBeVisible();
});

test("the filter row narrows the calendar and the Upcoming list to one kind of entry", async ({
  page,
  baseURL,
}) => {
  await stubApi(page, {
    trips: [
      {
        id: 1,
        name: "Japan Summer 2026",
        destination: "Tokyo, Japan",
        start_date: "2026-08-22",
        end_date: "2026-08-28",
        status: "planned",
        notes: null,
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
    ],
    events: [
      {
        id: 1,
        trip_id: 1,
        event_type: "food",
        title: "Sushi dinner",
        event_date: "2026-08-23",
        start_time: null,
        location: null,
        from_location: null,
        to_location: null,
        booking_reference: null,
        category: null,
        notes: null,
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
    ],
  });
  await openSchedule(page, baseURL);

  await expect(page.getByTestId("upcoming-list")).toContainText("Sushi dinner");
  await expect(page.getByTestId("upcoming-list")).toContainText("Tokyo, Japan");

  await page.getByTestId("schedule-filter-trips").click();

  await expect(page.getByTestId("upcoming-list")).toContainText("Tokyo, Japan");
  await expect(page.getByTestId("upcoming-list")).not.toContainText("Sushi dinner");
});

test("the drawer's Travel Schedule link lands here and marks it current", async ({ page, baseURL }) => {
  await stubApi(page);
  await page.context().addCookies([{ name: SESSION_COOKIE, value: "stub-session", url: baseURL! }]);
  // `/calendar` (Content Calendar) was removed entirely 2026-08-22, the owner's instruction —
  // `/map` is the landing screen the drawer is opened from now.
  await page.goto("/map");
  await page.getByTestId("map-eyebrow").waitFor();

  await page.getByTestId("nav-drawer-trigger").click();
  await page.getByTestId("nav-drawer-screen-schedule").click();

  await expect(page).toHaveURL(/\/schedule$/);
  await page.getByTestId("nav-drawer-trigger").click();
  await expect(page.getByTestId("nav-drawer-screen-schedule")).toHaveAttribute("aria-current", "page");
});
