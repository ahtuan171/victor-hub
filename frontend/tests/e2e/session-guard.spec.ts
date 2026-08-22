import { expect, test } from "@playwright/test";

/**
 * The `(app)` session guard (T027, FR-002, SC-006, quickstart V1).
 *
 * ---
 *
 * ## These ran skipped from T027 to T033, and now they run
 *
 * The guard lives in `app/(app)/layout.tsx`. A route group's layout **does not execute when no page
 * exists inside the group**, and the first route to live in `(app)` was the calendar page at T033.
 * So through Phase 2 there was nothing to navigate to and nothing to assert against — not because
 * the guard was untested by choice, but because the surface it guards had not been built, and
 * building it early is what "nothing outside the current phase gets built" forbids.
 *
 * They were therefore written in full and skipped, rather than described in a comment and written
 * later. T033 created `/calendar` and deleted the `.skip` — the one-line change this docstring
 * promised, made in the same commit as the page.
 *
 * ## They were not unverified in the meantime
 *
 * Two of the three things this file covers were already exercised continuously elsewhere:
 * `hasSessionCookie` — the actual decision — is unit-tested in `tests/proxy/session.spec.ts`, and
 * the identical cookie-reading path is covered end to end by `tests/e2e/root-redirect.spec.ts`,
 * because `app/page.tsx` reads the same cookie through the same two helpers.
 *
 * What was *not* covered was the wiring: that a route group layout actually runs, and runs before
 * its children. That was verified once by hand at T027 by standing up a throwaway page inside
 * `(app)`, running this file un-skipped, and removing the page — recorded in `.claude/build-log.md`
 * so the evidence is not just this sentence. From T033 it is a standing gate instead.
 *
 * ## What this file does *not* cover, and where that lives
 *
 * Every assertion here is about the **layout**, which runs on a full page load. T033 added a second
 * check in `app/(app)/calendar/page.tsx` for the case a full load cannot reach: App Router layouts
 * are not re-executed on soft navigations, so a client-side route change reuses the layout's result.
 * Both checks call the same helper and a full load exercises both at once, so nothing here can tell
 * them apart — which is why removing the page-level check would leave this file green.
 */

/** Any route inside `(app)` — `/calendar` (the first, at T033) was removed 2026-08-22 along with
 * the rest of Content Calendar; `/map` carries the identical page-level check now. */
const GUARDED_PATH = "/map";

/** Matches `sessionCookieName()`'s default and `.env.example`. Unset in the test environment. */
const SESSION_COOKIE = "ch_session";

test.describe("the (app) session guard", () => {
  test("a signed-out visitor is redirected to /login", async ({ page }) => {
    await page.goto(GUARDED_PATH);
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("no content markup reaches a signed-out visitor (SC-006)", async ({ request }) => {
    const response = await request.get(GUARDED_PATH, { maxRedirects: 0 });

    // SC-006 is stronger than "no content on screen": a layout that rendered its children and then
    // hid them would put the data in the HTML, where quickstart V1's View Source step finds it.
    // A 3xx is generated instead of markup, so there is nothing to find.
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(response.headers()["location"]).toContain("/login");
  });

  test("an empty session cookie does not pass the guard", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: SESSION_COOKIE, value: "", url: baseURL! }]);

    await page.goto(GUARDED_PATH);

    // `cookies().has()` would let this through. `hasSessionCookie` checks the value.
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("a visitor holding a session cookie reaches the page", async ({ page, context, baseURL }) => {
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        // Not a real JWT, and it does not need to be: the guard is a presence check, because the
        // signing secret never leaves Render (R-001). A test that minted a valid token would be
        // asserting something this layout does not do.
        value: "any-non-empty-value",
        url: baseURL!,
      },
    ]);

    const response = await page.goto(GUARDED_PATH);

    // The status matters as much as the path, and this is not hypothetical: during T027's one-time
    // verification the throwaway route was briefly named `__probe`, which App Router treats as a
    // *private folder* and excludes from routing. It 404'd, the layout never ran — and a
    // path-only assertion passed anyway, because a 404 leaves the browser at the address it asked
    // for. Asserting 200 is what turns "did not redirect" into "actually rendered".
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(GUARDED_PATH);
  });
});
