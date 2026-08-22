import { expect, test, type Page } from "@playwright/test";

/**
 * Visible focus states on every interactive element (T067), at the 375x667 floor.
 *
 * **Structural, not decoration.** `.claude/rules/design.md` puts focus states in the short list of
 * things v0.1 may not defer — "Polish is deferred, structure is not ... That licenses skipping
 * decoration — not skipping responsive behaviour, focus states, or confirmation on destructive
 * actions. Those are structural and cost more to retrofit than to build."
 *
 * **Rewritten 2026-08-22** against `/map` and `/schedule` — Content Calendar (`/calendar`, the
 * original stage for every scenario here) was removed entirely, the owner's instruction. The
 * mapping: the calendar's month/week grid → the map surface and `/schedule`'s own month grid; the
 * expanded backlog drawer → `TripPanel`; the capture sheet → `QuickAdd`'s status step; the item
 * sheet → `DestinationSheet`; the delete confirmation → `DestinationSheet`'s own; the day-cell chip
 * whose outline a tight container could clip → `DestinationStrip`'s card, the equivalent "small
 * control in a narrow, scrolling container" shape.
 *
 * ## The elements are enumerated by the browser, not by hand
 *
 * A hand-written list of testids is a list that goes stale the next time a surface grows a control —
 * which is exactly how this requirement came to be missing on fourteen elements across seven
 * components while six others had it. So each test **walks the surface with the Tab key** and checks
 * whatever it lands on. A new control is covered the day it is added, and one that cannot be tabbed
 * to is a finding rather than a silent omission.
 *
 * ## Why Tab rather than `element.focus()`
 *
 * `:focus-visible` is a browser heuristic about *modality*, not a synonym for `:focus`. Chromium does
 * not match it for a programmatic `.focus()` on a button — so a test built on `locator.focus()` would
 * report every button as unstyled, and "fixing" that by styling `:focus` instead would put a ring on
 * every mouse tap. Pressing Tab is the interaction the requirement is actually about.
 */

const SESSION_COOKIE = "ch_session";

function aDestination(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    created_at: "2026-08-01T09:00:00Z",
    updated_at: "2026-08-01T09:00:00Z",
    outside_trip_range: false,
    ...overrides,
  };
}

async function signedIn(page: Page, baseURL: string | undefined): Promise<void> {
  await page.context().addCookies([{ name: SESSION_COOKIE, value: "stub-session", url: baseURL! }]);
}

async function openMap(
  page: Page,
  baseURL: string | undefined,
  destinations: Record<string, unknown>[],
): Promise<void> {
  await page.route("**/api/destinations", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(destinations) });
  });
  for (const detail of destinations) {
    await page.route(new RegExp(`/api/destinations/${detail["id"]}$`), async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
    });
  }
  await page.route("**/api/trips*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/locations/search*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: "Kyoto", address: "Kyoto, Japan", latitude: 35.0116, longitude: 135.7681 }]),
    });
  });
  await signedIn(page, baseURL);
  await page.clock.setFixedTime(Date.UTC(2026, 7, 3, 3, 0, 0));
  await page.goto("/map");
  await page.getByTestId("map-eyebrow").waitFor();
}

async function openSchedule(page: Page, baseURL: string | undefined): Promise<void> {
  await page.route("**/api/travel-events*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/destinations*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await signedIn(page, baseURL);
  await page.clock.setFixedTime(Date.UTC(2026, 7, 3, 3, 0, 0));
  await page.goto("/schedule");
  await page.getByTestId("schedule-shell").waitFor();
}

/**
 * What the currently focused element is, and whether it draws **the product's** focus indicator.
 *
 * ## "Has some outline" is not the assertion, and the first version of this file proved it
 *
 * Written as `outlineStyle !== "none" || boxShadow !== "none"`, all eight tests passed against the
 * codebase T067 exists to fix — because **Chromium draws its own focus ring** and the base layer's
 * `* { outline-ring/50 }` tints it. Measured on the production build, the fourteen unstyled controls
 * reported `outline: auto 1px oklab(… / 0.5)`: a one-pixel, half-transparent ring, and on the two
 * brand-filled controls (`+ CAPTURE`, the selected platform option) that is **red on red**.
 *
 * So the check is for the designed indicator specifically — `outline-style: solid` at 2px or more,
 * which is `.focus-ring` and nothing else. `auto` is the UA default and fails. This is the same
 * shape as the finding recorded under T077: an assertion can pass while the requirement it names is
 * unmet, and the way to find out is to run it against the broken state first.
 */
async function focusReport(page: Page): Promise<{
  readonly id: string;
  readonly visible: boolean;
}> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return { id: "<body>", visible: false };

    /*
     * The focus trap's own sentinels are skipped, and the criterion is `aria-hidden` rather than a
     * vendor attribute. `AlertDialog` (base-ui) wraps its content in
     * `<span data-base-ui-focus-guard aria-hidden="true" tabindex="0">` clipped to 1px — a tab stop
     * that exists to bounce focus back into the dialog, never something a creator lands on. An
     * element hidden from assistive technology cannot be a control by definition, so this excludes
     * exactly the machinery and nothing a requirement could be hiding behind. Matching on
     * `data-base-ui-*` instead would have to be rewritten the next time the primitive changes.
     */
    if (el.getAttribute("aria-hidden") === "true") return { id: "<aria-hidden>", visible: true };

    /*
     * Only *controls* are checked, and the filter is what an element **is** rather than a list of
     * testids — so a control added later is covered on the day it is added, which was the point of
     * walking with Tab in the first place.
     *
     * The exemption this exists for is real and was found by a flaky run: **Chromium makes a
     * scrolling container keyboard-focusable** so it can be scrolled with the arrow keys, and any
     * `overflow-y-auto` main region is one. It is therefore a genuine tab stop while being nobody's
     * idea of an interactive element, and giving the whole page body a 2px brand outline would be
     * wrong. It keeps the browser's own faint ring, which is the right answer for a scroll region.
     */
    const INTERACTIVE_TAGS = ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"];
    const INTERACTIVE_ROLES = [
      "button",
      "link",
      "radio",
      "checkbox",
      "switch",
      "tab",
      "menuitem",
      "option",
      "combobox",
      "slider",
      "textbox",
    ];
    const role = el.getAttribute("role");
    const isControl =
      INTERACTIVE_TAGS.includes(el.tagName) || (role !== null && INTERACTIVE_ROLES.includes(role));
    if (!isControl) return { id: "<not-a-control>", visible: true };

    const style = getComputedStyle(el);
    // `solid` rather than "not none": `auto` is Chromium's own ring, which is what every unstyled
    // control in this product already had.
    const designed = style.outlineStyle === "solid" && parseFloat(style.outlineWidth) >= 2;

    const label =
      el.getAttribute("data-testid") ??
      `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 24)}`;

    return { id: label, visible: designed };
  });
}

/**
 * Tab through a surface and return every element that took focus without showing it.
 *
 * Stops when focus returns somewhere already seen, so a focus trap (the delete dialog) terminates
 * rather than spinning for `steps` presses.
 */
async function tabForUnstyled(page: Page, steps: number): Promise<string[]> {
  const unstyled: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press("Tab");
    const { id, visible } = await focusReport(page);
    if (id === "<body>") continue;
    if (seen.has(id)) break;
    seen.add(id);
    if (!visible) unstyled.push(id);
  }

  return unstyled;
}

test("every control on the map shows focus when tabbed to", async ({ page, baseURL }) => {
  await openMap(page, baseURL, [aDestination({ id: 1 }), aDestination({ id: 2, name: "Kyoto" })]);

  // Long enough to reach the whole surface: the nav drawer trigger, the status filter options, the
  // destination strip's cards, and QuickAdd's own search input and submit.
  expect(await tabForUnstyled(page, 30)).toEqual([]);
});

test("every control on the schedule shows focus when tabbed to", async ({ page, baseURL }) => {
  await openSchedule(page, baseURL);

  expect(await tabForUnstyled(page, 30)).toEqual([]);
});

test("every control in the nav drawer shows focus when tabbed to", async ({ page, baseURL }) => {
  await openMap(page, baseURL, [aDestination()]);
  await page.getByTestId("nav-drawer-trigger").click();
  await page.getByTestId("nav-drawer-panel").waitFor();

  // Close and sign-out, both added at 002 T029/T030 — the screen-list entry is a `<span>`, not a
  // control, so it is not part of this walk.
  expect(await tabForUnstyled(page, 30)).toEqual([]);
});

test("every control in the Trip panel shows focus when tabbed to", async ({ page, baseURL }) => {
  await openMap(page, baseURL, [aDestination()]);
  await page.getByTestId("open-trips").click();
  await page.getByTestId("trip-panel").waitFor();

  expect(await tabForUnstyled(page, 30)).toEqual([]);
});

test("every control in QuickAdd's status step shows focus when tabbed to", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL, []);
  await page.getByTestId("quick-add-search-input").fill("Kyoto");
  await page.getByTestId("quick-add-search-input").press("Enter");
  await page.getByTestId("quick-add-search-add").first().click();
  await page.getByTestId("quick-add-status-step").waitFor();

  expect(await tabForUnstyled(page, 12)).toEqual([]);
});

test("every control in the Destination sheet shows focus when tabbed to", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL, [aDestination({ status: "visited", note: "Loved it." })]);
  await page.getByTestId("destination-pin").click();
  await page.getByTestId("place-confirm-open").click();
  await page.getByTestId("destination-save").waitFor();

  // A dense surface: name, status options, a note field (visited), save, delete, close.
  expect(await tabForUnstyled(page, 40)).toEqual([]);
});

test("every control in the Destination delete confirmation shows focus when tabbed to", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL, [aDestination()]);
  await page.getByTestId("destination-pin").click();
  await page.getByTestId("place-confirm-open").click();
  await page.getByTestId("destination-delete").waitFor();
  await page.getByTestId("destination-delete").click();
  await page.getByTestId("destination-delete-confirm").waitFor();

  expect(await tabForUnstyled(page, 12)).toEqual([]);
});

test("the login form shows focus on every control", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in" }).waitFor();

  expect(await tabForUnstyled(page, 10)).toEqual([]);
});

/**
 * Is the indicator actually **painted**? Screenshot the control twice and compare the bytes.
 *
 * The computed-style sweep above cannot answer this, and the gap is not hypothetical — it shipped
 * twice in this task. `.notch-card` is a `clip-path`, and a clip-path clips the element's outline, so
 * `+ CAPTURE` reported a perfect `outline: 2px solid` while drawing **nothing at all**; the view
 * toggle's `overflow-hidden` wrapper left a 2px sliver on one edge. Both passed every assertion about
 * which class was applied, and both were found by looking at a screenshot.
 *
 * No baseline file, so nothing to re-bless: it compares the same region of the same page against
 * itself, focused and unfocused. Identical bytes mean the browser painted no difference, which is the
 * definition of an invisible focus state.
 */
async function paintsAFocusRing(page: Page, testId: string): Promise<boolean> {
  const target = page.getByTestId(testId).first();
  const box = (await target.boundingBox())!;
  const viewport = page.viewportSize()!;

  // Padded to take in an outset ring (2px offset + 2px width), clamped so the clip stays on screen.
  const pad = 6;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(viewport.width - Math.max(0, box.x - pad), box.width + pad * 2),
    height: Math.min(viewport.height - Math.max(0, box.y - pad), box.height + pad * 2),
  };

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const blurred = await page.screenshot({ clip });

  // Focus is driven the way the requirement is written — by keyboard — because `:focus-visible` is a
  // modality heuristic and `.focus()` alone does not satisfy it on a button.
  await target.evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const focused = await page.screenshot({ clip });

  return !blurred.equals(focused);
}

test("the focus ring is painted, not merely declared", async ({ page, baseURL }) => {
  await openMap(page, baseURL, [aDestination()]);

  for (const testId of [
    "nav-drawer-trigger", // plain, on a dark surface
    "status-filter-all", // brand-filled: the red-on-red case the offset solves
    "open-trips",
    "quick-add-search-input",
  ]) {
    expect(await paintsAFocusRing(page, testId), `${testId} draws no focus ring`).toBe(true);
  }
});

test("the focus ring is painted on the nav drawer's own controls", async ({ page, baseURL }) => {
  await openMap(page, baseURL, [aDestination()]);
  await page.getByTestId("nav-drawer-trigger").click();
  await page.getByTestId("nav-drawer-panel").waitFor();

  // Checked here rather than in the sweep above because both controls exist only once the drawer is
  // open, and opening it would put the scrim over every control that sweep already checks, breaking
  // those screenshots' clip regions.
  for (const testId of ["nav-drawer-close", "sign-out-action"]) {
    expect(await paintsAFocusRing(page, testId), `${testId} draws no focus ring`).toBe(true);
  }
});

test("the focus indicator is not clipped away by a strip card", async ({ page, baseURL }) => {
  await openMap(page, baseURL, [aDestination()]);

  // The tightest container on this surface: a card inside `DestinationStrip`'s own horizontally
  // scrolling row, itself inset over the map. An indicator drawn *outside* the element's box is
  // exactly what an ancestor's overflow clips, and a focus ring nobody can see fails FR-021's
  // sibling requirement in `.claude/rules/design.md` while satisfying every assertion about which
  // class is applied.
  const card = page.getByTestId(/^destination-card-/).first();
  await card.focus();

  const box = (await card.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  // The indicator is drawn within 4px of the card's own box, so a container that clips at its
  // border still shows it. Asserted as a number rather than by eye because the alternative is a
  // screenshot nobody re-takes.
  const offset = await card.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      width: parseFloat(style.outlineWidth) || 0,
      offset: parseFloat(style.outlineOffset) || 0,
    };
  });
  expect(offset.width + Math.max(offset.offset, 0)).toBeLessThanOrEqual(4);
});
