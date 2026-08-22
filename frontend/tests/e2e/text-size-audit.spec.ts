import { expect, test, type Page } from "@playwright/test";

/**
 * The text-size audit (T009, SC-014, FR-032–FR-034) — every route and every overlay surface,
 * mirroring `viewport-audit.spec.ts`'s coverage and its reason for existing: a hand-written list of
 * testids goes stale the day a surface grows a text node, so this sweeps the DOM instead.
 *
 * **Expected to be red until Phase 3 restyles a surface onto the new type scale — that is the test
 * working, not a bug in the test.** VT323 is loaded (T002) but nothing renders in it yet; every
 * surface here still carries the outgoing Barlow/Oswald sizes, several of which sit under both
 * floors this file checks. `tasks.md`'s "Predicted two-task merge requests" names this pairing
 * (T009 with T014) for exactly this reason.
 *
 * ## Three checks, and why content text needs a bounded list where a control does not
 *
 * - **FR-033, everywhere, no exceptions**: no visible text renders below 12px. Checked the same way
 *   `viewport-audit.spec.ts` checks controls — every element in the DOM, filtered by visibility, not
 *   by a maintained list.
 * - **FR-032, content text only**: an item's title, its hook, and any value shown inside a cell or
 *   row must be at least 16px. Unlike a *control*, which can appear anywhere and in any number,
 *   FR-032 names a **closed, bounded set** — title, hook, cell/row values, nothing else — so the
 *   testids that carry them are named directly rather than inferred from tag or role. This does not
 *   go stale the way a hand-written control list would, because the requirement itself is closed.
 * - **FR-034**: any text below 16px must use the more legible face (VT323), never the display face
 *   (Silkscreen) reserved for headings and labels.
 */

const SESSION_COOKIE = "ch_session";
const MARCH_2026 = Date.UTC(2026, 2, 12, 3, 0, 0);

test.use({ timezoneId: "Asia/Ho_Chi_Minh" });

async function signedIn(page: Page, baseURL: string | undefined): Promise<void> {
  await page.context().addCookies([{ name: SESSION_COOKIE, value: "stub-session", url: baseURL! }]);
}

/** `/map` and `/schedule` fixtures — Content Calendar (`/calendar`) was removed 2026-08-22, the
 * owner's instruction, and these are its replacements as the product's busy surfaces. */
function destination(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    trip_id: null,
    name: "Porto",
    latitude: 41.1579,
    longitude: -8.6291,
    start_date: null,
    end_date: null,
    status: "wishlist",
    note: null,
    photographs: [],
    created_at: "2026-03-01T09:00:00Z",
    updated_at: "2026-03-01T09:00:00Z",
    outside_trip_range: false,
    ...overrides,
  };
}

async function openMap(page: Page, baseURL: string | undefined, destinations: unknown[]): Promise<void> {
  await signedIn(page, baseURL);
  await page.route("**/api/destinations", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(destinations) });
  });
  await page.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.clock.setFixedTime(MARCH_2026);
  await page.goto("/map");
  await expect(page.getByTestId("map-eyebrow")).toBeVisible();
}

function travelEvent(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    trip_id: 1,
    event_type: "activity",
    title: `Event ${id}`,
    event_date: "2026-03-11",
    start_time: null,
    location: null,
    from_location: null,
    to_location: null,
    booking_reference: null,
    category: null,
    notes: null,
    created_at: "2026-03-01T09:00:00Z",
    updated_at: "2026-03-01T09:00:00Z",
    ...overrides,
  };
}

const SCHEDULE_TRIP = {
  id: 1,
  name: "Japan Summer 2026",
  destination: "Tokyo, Japan",
  start_date: "2026-03-11",
  end_date: "2026-03-20",
  status: "planned",
  notes: null,
  created_at: "2026-03-01T09:00:00Z",
  updated_at: "2026-03-01T09:00:00Z",
};

async function openSchedule(
  page: Page,
  baseURL: string | undefined,
  { trips = [SCHEDULE_TRIP], events = [travelEvent(1)] }: { trips?: unknown[]; events?: unknown[] } = {},
): Promise<void> {
  await signedIn(page, baseURL);
  await page.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(trips) });
  });
  await page.route("**/api/travel-events*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(events) });
  });
  await page.route("**/api/destinations*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.clock.setFixedTime(MARCH_2026);
  await page.goto("/schedule");
  await expect(page.getByTestId("schedule-shell")).toBeVisible();
}

/**
 * Every visible text violation on the current screen, as `label: Npx <reason>`.
 *
 * Two passes: text nodes (chip titles, labels, counts — everything rendered as static text) and
 * form-field elements separately, because a typed or placeholder value in an `<input>`/`<textarea>`
 * is never a DOM text node and a tree-walker would silently skip every field on the item sheet.
 */
async function textSizeViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    /*
     * FR-032's closed set: a place's name, a Trip's name/destination, a travel event's title — the
     * content a creator typed, not the chrome around it. `destination-name-input`, `trip-form-name`/
     * `trip-form-destination` and `event-form-title` are the editable forms of those values, the
     * same role `item-title-input`/`item-hook-input` played for Content Calendar before it was
     * removed 2026-08-22.
     */
    const CONTENT_ANCESTOR_TESTIDS = [
      "destination-name-input",
      "trip-form-name",
      "trip-form-destination",
      "event-form-title",
    ];

    function isContentText(el: Element): boolean {
      return CONTENT_ANCESTOR_TESTIDS.some(
        (testid) => el.closest(`[data-testid="${testid}"]`) !== null,
      );
    }

    function isVisible(el: Element): boolean {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (el.closest('[aria-hidden="true"]') !== null) return false;
      // `sr-only` (Tailwind's screen-reader-only utility: clipped to 1x1px, not display:none) is
      // visible to `getBoundingClientRect` but not to anyone reading the screen — FR-032/033/034 are
      // about what a person can see, not what a screen reader announces. `ItemChip`'s `micro` chip
      // relies on exactly this pattern for its accessible title.
      if (el.closest(".sr-only") !== null) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function labelFor(el: Element, sample: string): string {
      return el.getAttribute("data-testid") ?? `${el.tagName.toLowerCase()}:${sample.slice(0, 24)}`;
    }

    function checkElement(el: Element, size: number, family: string, sample: string): string[] {
      const found: string[] = [];
      const label = labelFor(el, sample);

      if (size < 12) {
        found.push(`${label}: ${size}px < 12px absolute floor (FR-033)`);
      } else if (isContentText(el) && size < 16) {
        found.push(`${label}: ${size}px < 16px content floor (FR-032)`);
      }

      if (size < 16 && family.includes("Silkscreen")) {
        found.push(`${label}: ${size}px uses the display face below 16px, not VT323 (FR-034)`);
      }

      return found;
    }

    const violations: string[] = [];

    // Pass 1: static text nodes.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (!text) continue;
      const parent = node.parentElement;
      if (parent === null || !isVisible(parent)) continue;
      // Form fields are covered in pass 2, from their own font-size — a placeholder is not a text
      // node, and double-counting a field's ordinary label text here is harmless but redundant.
      if (parent.tagName === "INPUT" || parent.tagName === "TEXTAREA") continue;

      const style = getComputedStyle(parent);
      const size = Math.round(parseFloat(style.fontSize) * 100) / 100;
      violations.push(...checkElement(parent, size, style.fontFamily, text));
    }

    // Pass 2: form fields, checked by their own font-size regardless of whether they hold a value.
    for (const el of Array.from(document.querySelectorAll("input, textarea"))) {
      if (!isVisible(el)) continue;
      const style = getComputedStyle(el);
      const size = Math.round(parseFloat(style.fontSize) * 100) / 100;
      const sample = (el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || "";
      violations.push(...checkElement(el, size, style.fontFamily, sample));
    }

    return violations;
  });
}

async function auditSurface(page: Page, surface: string): Promise<void> {
  expect(await textSizeViolations(page), `${surface}: text-size violations`).toEqual([]);
}

/**
 * 002 T028 (Phase 3 checkpoint) ran this sweep against a fabricated light presentation — the real
 * theme switch (Phase 5, T032–T037) did not exist yet, and this file forced light with a
 * `page.evaluate` token override reapplied after every navigation, because hydration silently
 * discarded anything written before it. **T037 replaces that with the real mechanism**: `ch_theme`
 * set once before the test's first navigation, read server-side by `app/layout.tsx` (T033), correct
 * from the first response and surviving every later `goto`/`reload` in the same test on its own —
 * `viewport-audit.spec.ts` carries the fuller history of the two mechanisms this one replaced.
 */
async function setThemeCookie(page: Page, baseURL: string | undefined, theme: "dark" | "light"): Promise<void> {
  if (theme !== "light") return;
  await page.context().addCookies([{ name: "ch_theme", value: "light", url: baseURL! }]);
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`[${theme}]`, () => {
    test.beforeEach(async ({ page, baseURL }) => {
      await setThemeCookie(page, baseURL, theme);
    });

    test.describe("the routes", () => {
      test("/login", async ({ page }) => {
        await page.goto("/login");
        await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
        await auditSurface(page, "/login");
      });

      test("/map, populated", async ({ page, baseURL }) => {
        await openMap(page, baseURL, [
          destination({ id: 1, name: "Porto", status: "visited", note: "Loved every minute." }),
          destination({ id: 2, name: "Kyoto", status: "planned" }),
        ]);
        await expect(page.getByTestId("destination-strip-list")).toBeVisible();
        await auditSurface(page, "/map populated");
      });

      test("/schedule, month view, busy", async ({ page, baseURL }) => {
        await openSchedule(page, baseURL, {
          events: [travelEvent(1, { event_type: "transport" }), travelEvent(2, { event_type: "stay" })],
        });
        await expect(page.getByTestId("schedule-month-grid")).toBeVisible();
        await auditSurface(page, "/schedule month");
      });

      test("/schedule, the filtered-to-nothing state", async ({ page, baseURL }) => {
        await openSchedule(page, baseURL);
        await page.getByTestId("schedule-filter-note").click();
        await expect(page.getByTestId("upcoming-empty")).toBeVisible();
        await auditSurface(page, "/schedule filtered to nothing");
      });

      test("/schedule, the empty state (no Trips, no events)", async ({ page, baseURL }) => {
        await openSchedule(page, baseURL, { trips: [], events: [] });
        await expect(page.getByTestId("trip-timeline-empty")).toBeVisible();
        await auditSurface(page, "/schedule empty");
      });
    });

    test.describe("the overlay surfaces", () => {
      test("the Destination sheet, every field filled", async ({ page, baseURL }) => {
        const porto = destination({ status: "visited", note: "Loved every minute of it." });
        await openMap(page, baseURL, [porto]);
        await page.route(new RegExp(`/api/destinations/${porto["id"] as number}$`), async (route) => {
          if (route.request().method() !== "GET") return route.fallback();
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(porto) });
        });
        await page.getByTestId("destination-pin").click();
        await page.getByTestId("place-confirm-open").click();
        await expect(page.getByTestId("destination-save")).toBeInViewport();
        await auditSurface(page, "Destination sheet");
      });

      test("the Trip panel, open", async ({ page, baseURL }) => {
        await openMap(page, baseURL, []);
        await page.getByTestId("open-trips").click();
        await expect(page.getByTestId("trip-panel")).toBeVisible();
        await auditSurface(page, "Trip panel");
      });

      test("the new-entry picker", async ({ page, baseURL }) => {
        await openSchedule(page, baseURL, { trips: [], events: [] });
        await page.getByTestId("schedule-cta").click();
        await expect(page.getByTestId("new-entry-trip")).toBeInViewport();
        await auditSurface(page, "new-entry picker");
      });

      test("the Trip form, every field filled", async ({ page, baseURL }) => {
        await openSchedule(page, baseURL, { trips: [], events: [] });
        await page.getByTestId("schedule-cta").click();
        await page.getByTestId("new-entry-trip").click();
        await expect(page.getByTestId("trip-form-name")).toBeInViewport();
        await auditSurface(page, "Trip form");
      });

      test("the event form, every field filled", async ({ page, baseURL }) => {
        await openSchedule(page, baseURL, { trips: [], events: [] });
        await page.getByTestId("schedule-cta").click();
        await page.getByTestId("new-entry-transport").click();
        await expect(page.getByTestId("event-form-title")).toBeInViewport();
        await auditSurface(page, "event form");
      });

      test("Day Detail, with an event", async ({ page, baseURL }) => {
        await openSchedule(page, baseURL);
        await page.locator('[data-testid="schedule-day-cell"][data-date="2026-03-11"]').click();
        await expect(page.getByTestId("day-detail-list")).toBeInViewport();
        await auditSurface(page, "Day Detail");
      });
    });
  });
}
