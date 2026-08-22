import { expect, test, type Page } from "@playwright/test";

/**
 * Reduced motion (T042, FR-025, SC-008), at the 375x667 floor.
 *
 * `app/globals.css`'s `@media (prefers-reduced-motion: reduce)` block collapses every
 * `animation-duration`, `animation-iteration-count`, `transition-duration` and `scroll-behavior` on
 * `*, *::before, *::after` to near-zero, `!important` — one rule rather than a per-animation branch,
 * per that block's own comment: "switched off wholesale rather than per-animation."
 *
 * **Rewritten 2026-08-22, and narrowed to one surface** — Content Calendar's ticker
 * (`arcade/Ticker.tsx`, `.ticker-scan`) and its `full`/`peek` `ItemChip`'s hover lift
 * (`.comic-panel`) were both removed along with the rest of Content Calendar (the owner's
 * instruction), and **neither had any other caller** — `grep`ping `.comic-panel`/`press-feedback`/
 * `.ticker-scan` across the codebase after the removal found them nowhere but `app/globals.css`
 * itself, so both scenarios are gone rather than ported; there is no surviving surface that plays
 * either animation to prove the reduced-motion rule against. What remains, and is real: the
 * shadcn `Sheet`/`AlertDialog` entrance transitions, which `DestinationSheet`'s own delete
 * confirmation still uses — proof the global rule reaches a third-party primitive's own transition
 * classes, which was always this file's point beyond the two hand-written animations it used to
 * also cover.
 *
 * The proxy is stubbed, as in every other file here.
 */

const SESSION_COOKIE = "ch_session";
const NOW = Date.UTC(2026, 2, 12, 3, 0, 0);

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

async function openMapWithDestination(page: Page, baseURL: string | undefined): Promise<void> {
  const porto = aDestination();
  await page.route("**/api/destinations", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([porto]) });
  });
  await page.route(new RegExp(`/api/destinations/${porto["id"]}$`), async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(porto) });
  });
  await page.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.context().addCookies([{ name: SESSION_COOKIE, value: "stub-session", url: baseURL! }]);
  await page.clock.setFixedTime(NOW);
  await page.goto("/map");
  await page.getByTestId("map-eyebrow").waitFor();
}

async function openDeleteConfirm(page: Page): Promise<void> {
  await page.getByTestId("destination-pin").click();
  await page.getByTestId("place-confirm-open").click();
  await page.getByTestId("destination-delete").click();
}

test("prefers-reduced-motion collapses the delete confirmation's entrance transition", async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMapWithDestination(page, baseURL);
  await openDeleteConfirm(page);

  const dialog = page.getByTestId("destination-delete-confirm");
  await expect(dialog).toBeVisible();
  // shadcn's own `duration-100` utility, applied through the `data-open:animate-in`/`data-closed:
  // animate-out` classes `components/ui/alert-dialog.tsx` sets.
  expect(await dialog.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("1e-05s");
});

test("without the preference, the same dialog has a real entrance duration", async ({
  page,
  baseURL,
}) => {
  await openMapWithDestination(page, baseURL);
  await openDeleteConfirm(page);

  const dialog = page.getByTestId("destination-delete-confirm");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0.1s");
});
