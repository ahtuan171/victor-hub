import { expect, test, type Page } from "@playwright/test";

/**
 * The nav drawer (002 T029–T031, FR-015, FR-016, FR-018, FR-019, SC-007), at the 375x667 floor.
 *
 * The proxy is stubbed, as in every other file here — CI runs the production bundle with no FastAPI
 * behind it.
 *
 * **Rewritten 2026-08-22** against `/map` — Content Calendar (`/calendar`, the original stage for
 * every scenario here) was removed entirely, the owner's instruction. Two substitutions carry the
 * scenarios that named calendar-only surfaces, the same ones `sound.spec.ts` and
 * `focus-states.spec.ts` already made: the capture sheet's role (an overlay holding typed text that
 * must survive the nav drawer opening over it) is played by `QuickAdd`'s always-on search input; the
 * backlog drawer's role (a second overlay that must stay open, and must not have its own trap
 * confused with this drawer's) is played by `TripPanel`.
 */

const SESSION_COOKIE = "ch_session";

async function signedIn(page: Page, baseURL: string | undefined): Promise<void> {
  await page.context().addCookies([{ name: SESSION_COOKIE, value: "stub-session", url: baseURL! }]);
}

async function openMap(page: Page, baseURL: string | undefined): Promise<void> {
  await page.route("**/api/destinations*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/locations/search*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "Kyoto", address: "Kyoto, Japan", latitude: 35.0116, longitude: 135.7681 },
      ]),
    });
  });
  await signedIn(page, baseURL);
  await page.goto("/map");
  await page.getByTestId("map-eyebrow").waitFor();
}

test("the drawer is reachable from the map in a single tap", async ({ page, baseURL }) => {
  await openMap(page, baseURL);

  await page.getByTestId("nav-drawer-trigger").click();
  await expect(page.getByTestId("nav-drawer-panel")).toBeVisible();
});

test("every screen the product has is listed, and the current one is marked (FR-015, SC-007)", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL);
  await page.getByTestId("nav-drawer-trigger").click();

  // Two at 003-travel-map T018, three with Module 02 (Travel Schedule). SC-007 asks every screen be
  // reachable in at most two interactions from any other: opening the drawer (one interaction) plus
  // tapping the other screen's link (a second) reaches it, which is the ceiling SC-007 sets.
  const screens = page.getByTestId("nav-drawer-screens").getByRole("listitem");
  await expect(screens).toHaveCount(3);

  const current = page.getByTestId("nav-drawer-screen-map");
  await expect(current).toHaveText("Travel Map");
  await expect(current).toHaveAttribute("aria-current", "page");

  const schedule = page.getByTestId("nav-drawer-screen-schedule");
  await expect(schedule).toHaveText("Travel Schedule");
  await expect(schedule).not.toHaveAttribute("aria-current");

  // Content Calendar's link was removed from the drawer along with the rest of the surface
  // 2026-08-22 — the owner's instruction.
  await expect(page.getByTestId("nav-drawer-screen-calendar")).toHaveCount(0);
});

test("the other screen's link is reachable in two interactions and lands there marked current (SC-007)", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL);
  await page.getByTestId("nav-drawer-trigger").click();

  await page.getByTestId("nav-drawer-screen-schedule").click();
  await expect(page).toHaveURL(/\/schedule$/);

  await page.getByTestId("nav-drawer-trigger").click();
  const current = page.getByTestId("nav-drawer-screen-schedule");
  await expect(current).toHaveAttribute("aria-current", "page");
});

test("dismissing the drawer over an open QuickAdd search keeps the typed text (FR-018)", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL);

  const search = page.getByTestId("quick-add-search-input");
  await search.fill("Rooftop cutdown, take two");

  // The drawer opens **over** QuickAdd rather than being unreachable behind it — see
  // `NavDrawer.tsx`'s "It has to out-rank z-50" note.
  await page.getByTestId("nav-drawer-trigger").click();
  await expect(page.getByTestId("nav-drawer-panel")).toBeVisible();

  await page.getByTestId("nav-drawer-close").click();
  await expect(page.getByTestId("nav-drawer-panel")).not.toBeVisible();

  // QuickAdd was never touched by any of this — the search text is still there.
  await expect(search).toHaveValue("Rooftop cutdown, take two");
});

test("dismissing the drawer with Escape also keeps the QuickAdd search intact (T044 hand-walk, FR-018)", async ({
  page,
  baseURL,
}) => {
  // Found by T044's hand-walk, not by this suite: the test above only ever dismissed via the CLOSE
  // button. Escape is a second, equally natural dismiss path, and it used to close both overlays at
  // once when the capture sheet was a real `@base-ui/react` Dialog with its own Escape listener —
  // see `NavDrawer.tsx`'s capture-phase comment for the fix. QuickAdd is a plain panel with no
  // listener of its own, so this scenario now proves the drawer's Escape handler does not touch it
  // rather than proving the two listeners don't race.
  await openMap(page, baseURL);

  const search = page.getByTestId("quick-add-search-input");
  await search.fill("Rooftop cutdown, take three");

  await page.getByTestId("nav-drawer-trigger").click();
  await expect(page.getByTestId("nav-drawer-panel")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("nav-drawer-panel")).not.toBeVisible();

  await expect(search).toHaveValue("Rooftop cutdown, take three");
});

test("opening the drawer does not cancel an open Trip panel, and dismissing it leaves the panel open (FR-019)", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL);

  await page.getByTestId("open-trips").click();
  await expect(page.getByTestId("trip-panel")).toBeVisible();

  // Independent state, not a shared one — opening the nav drawer must not close the Trip panel out
  // from under the owner.
  await page.getByTestId("nav-drawer-trigger").click();
  await expect(page.getByTestId("nav-drawer-panel")).toBeVisible();
  await expect(page.getByTestId("trip-panel")).toBeVisible();

  await page.getByTestId("nav-drawer-close").click();
  await expect(page.getByTestId("nav-drawer-panel")).not.toBeVisible();
  // Dismissing the nav drawer is not what closed it either — the Trip panel is exactly where it was.
  await expect(page.getByTestId("trip-panel")).toBeVisible();
});

test("the drawer does not trap keyboard focus when the Trip panel is open behind it (FR-019)", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL);

  await page.getByTestId("open-trips").click();
  await expect(page.getByTestId("trip-panel")).toBeVisible();

  await page.getByTestId("nav-drawer-trigger").click();
  await page.getByTestId("nav-drawer-panel").waitFor();

  // Tab from the trigger. A focus trap would keep every one of these landing inside the nav panel;
  // this drawer is deliberately not one, so the walk must escape it within a handful of presses.
  let escaped = false;
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Tab");
    const insidePanel = await page.evaluate(
      () => document.activeElement?.closest('[data-testid="nav-drawer-panel"]') !== null,
    );
    if (!insidePanel) {
      escaped = true;
      break;
    }
  }
  expect(escaped).toBe(true);
});

test("the scrim dismisses the drawer without touching the Trip panel underneath (FR-019)", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL);

  await page.getByTestId("open-trips").click();
  await expect(page.getByTestId("trip-panel")).toBeVisible();
  await page.getByTestId("nav-drawer-trigger").click();
  await page.getByTestId("nav-drawer-panel").waitFor();

  // The scrim covers the whole viewport, but the panel sits on top of its right-hand two-thirds
  // (`w-[260px]` of a 375px screen) — clicking the scrim locator's default centre would actually
  // land on the panel above it. Click near the scrim's own top-left corner instead, which the panel
  // does not cover.
  await page.getByTestId("nav-drawer-scrim").click({ position: { x: 10, y: 10 } });

  await expect(page.getByTestId("nav-drawer-panel")).not.toBeVisible();
  await expect(page.getByTestId("trip-panel")).toBeVisible();
});

test("Escape dismisses the drawer", async ({ page, baseURL }) => {
  await openMap(page, baseURL);

  await page.getByTestId("nav-drawer-trigger").click();
  await page.getByTestId("nav-drawer-panel").waitFor();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("nav-drawer-panel")).not.toBeVisible();
});
