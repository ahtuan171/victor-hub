import { expect, test } from "@playwright/test";

/**
 * The root route (T026, SC-001, US1 scenario 1, quickstart V1 step 1).
 *
 * `/` carries no content, so what is under test is entirely *where it sends you and when*. The
 * "when" matters as much as the "where": quickstart V1 requires the redirect to happen before
 * markup is generated, so one assertion below inspects the raw response rather than where the
 * browser settles after following it — a page that rendered a shell and then bounced client-side
 * would satisfy `page.goto` and fail V1.
 */

/** Matches `sessionCookieName()`'s default and `.env.example`. Unset in the test environment. */
const SESSION_COOKIE = "ch_session";

test("a visitor with no session is sent to /login", async ({ page }) => {
  await page.goto("/");
  expect(new URL(page.url()).pathname).toBe("/login");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("the redirect is served as a redirect, before any markup exists", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });

  // quickstart V1: the redirect must happen before markup is generated, not after a shell renders
  // and bounces client-side. A 3xx with a Location is that property — the browser acts on the
  // header and never renders the body.
  //
  // **The body is deliberately not asserted, and the reason is worth keeping.** Next's dev server
  // answers a redirect with a full HTML debug page carrying a NEXT_REDIRECT digest; `next start`
  // answers with an empty body. CI runs the production server and local runs `pnpm dev`, so
  // `expect(body).not.toContain("<html")` is green in CI and red on every developer machine — the
  // usual "verified locally, red in CI" trap running backwards. V1's "view source" step stays a
  // manual check against a production build.
  expect([302, 303, 307, 308]).toContain(response.status());
  expect(response.headers()["location"]).toContain("/login");
});

test("a visitor holding a session cookie is sent to the map", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      // Deliberately not a real JWT. This route does not and cannot validate one — the signing
      // secret never leaves Render (R-001) — so presence is the entire input, and a test that
      // minted a valid token would be asserting something the code does not do.
      value: "any-non-empty-value",
      url: baseURL!,
    },
  ]);
  // `/map` loads Destinations and Trips on mount — stubbed so a real backend left running locally
  // cannot 401 these requests and bounce this test back to `/login`.
  await page.route("**/api/destinations*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/");

  // The signed-in landing target moved from `/calendar` to `/map` 2026-08-22, when Content
  // Calendar was removed entirely — the owner's instruction.
  expect(new URL(page.url()).pathname).toBe("/map");
});

test("an empty session cookie is not a session", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: SESSION_COOKIE, value: "", url: baseURL! }]);

  await page.goto("/");

  // `cookies().has()` would call this signed in and route to a calendar the creator cannot load.
  expect(new URL(page.url()).pathname).toBe("/login");
});
