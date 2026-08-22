import { expect, test, type Page } from "@playwright/test";

/**
 * Sign-out (T077, FR-002a), at the 375x667 floor.
 *
 * **This surface exists because a checkpoint found a requirement with no product behind it.** The
 * Phase 7 checkpoint's finding C1: FR-002a says a session "MUST end only on expiry or an explicit
 * sign-out", the backend route has existed since T014, `lib/api.ts` has exported `logout()` since
 * T023 and the proxy has cleared the cookie on the way back since T021 — and for 76 tasks nothing
 * called any of it. Citation-based coverage read 100% because FR-002a *is* cited: by T018, a backend
 * test. So the assertions here are deliberately about the **surface**, which is the half that was
 * missing; the transport underneath is covered by `tests/client/api.spec.ts` and
 * `backend/tests/test_auth.py`.
 *
 * **002 T030 moved the control from the header into `arcade/NavDrawer.tsx`'s own footer (FR-017)**,
 * so every test here opens the drawer first — a single header tap is no longer enough to reach it,
 * which is the point: FR-017 asks that leaving the account sit further from a thumb's resting
 * position than the actions used frequently, and two taps deep is the mechanism that now gives it
 * that distance. The behaviour these tests pin (the 401 swallow, the refusal message, the redirect)
 * is unchanged from T077 — only the surface it lives in moved.
 *
 * The proxy is stubbed, as in every other file here — CI runs the production bundle with no FastAPI
 * behind it. What that costs is stated in `.claude/memory.md`: a green run says nothing about the
 * browser → proxy → FastAPI → Postgres seam, which is why quickstart V1.4 and V8.1 walk it by hand.
 */

const SESSION_COOKIE = "ch_session";

async function signedIn(page: Page, baseURL: string | undefined): Promise<void> {
  await page.context().addCookies([{ name: SESSION_COOKIE, value: "stub-session", url: baseURL! }]);
}

/**
 * Open the map with an empty list.
 *
 * `/map` is the stage since `/calendar` (Content Calendar) was removed 2026-08-22 — the owner's
 * instruction. The place list is irrelevant to signing out; an empty one is simplest.
 */
async function openMap(page: Page, baseURL: string | undefined): Promise<void> {
  await page.route("**/api/destinations*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await signedIn(page, baseURL);
  await page.goto("/map");
  await page.getByTestId("map-eyebrow").waitFor();
}

/** Open the nav drawer, the one place `sign-out-action` lives since T030. */
async function openDrawer(page: Page): Promise<void> {
  await page.getByTestId("nav-drawer-trigger").click();
  await page.getByTestId("nav-drawer-panel").waitFor();
}

/**
 * Stub `POST /api/auth/logout` and record every call.
 *
 * The real proxy also clears the session cookie on the way back, which a `route.fulfill` cannot do.
 * Where that matters — the creator must not be bounced straight back in — the test clears the cookie
 * itself and says so.
 */
function stubLogout(
  page: Page,
  status = 204,
): { readonly calls: { method: string }[] } {
  const calls: { method: string }[] = [];

  void page.route("**/api/auth/logout", async (route) => {
    calls.push({ method: route.request().method() });
    await route.fulfill({
      status,
      contentType: "application/json",
      body: status === 204 ? "" : JSON.stringify({ detail: "nope" }),
    });
  });

  return { calls };
}

test("sign-out is not reachable from the map in a single tap", async ({ page, baseURL }) => {
  await openMap(page, baseURL);

  // FR-017: not a single accidental tap. The control exists, but only inside the drawer this test
  // has not opened yet.
  await expect(page.getByTestId("sign-out-action")).not.toBeVisible();
});

test("the drawer carries a sign-out control, at its far end", async ({ page, baseURL }) => {
  await openMap(page, baseURL);
  await openDrawer(page);

  await expect(page.getByTestId("sign-out-action")).toBeVisible();
  // A label rather than a bare glyph: it is the one control in the product whose mis-tap costs the
  // creator their session, and every other control here is a written word.
  await expect(page.getByTestId("sign-out-action")).toHaveAccessibleName(/sign out/i);

  // "At its far end" (FR-017, T030's task line): below the screen list, not beside it.
  const screens = (await page.getByTestId("nav-drawer-screens").boundingBox())!;
  const signOut = (await page.getByTestId("sign-out-action").boundingBox())!;
  expect(signOut.y).toBeGreaterThanOrEqual(screens.y + screens.height);
});

test("signing out ends the session and lands on the login page", async ({ page, baseURL }) => {
  await openMap(page, baseURL);
  await openDrawer(page);
  const logout = stubLogout(page);

  await page.getByTestId("sign-out-action").click();

  await page.waitForURL("**/login");
  // The request is asserted, not just the navigation. Navigating to `/login` while leaving the
  // session alive is precisely the failure FR-002a describes — and it looks identical from the
  // address bar.
  expect(logout.calls).toEqual([{ method: "POST" }]);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("signing out of an already-dead session still reaches the login page", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL);
  await openDrawer(page);
  const logout = stubLogout(page, 401);

  await page.getByTestId("sign-out-action").click();

  // `logout()` is the one operation in `lib/api.ts` that swallows a 401, and this is the case it was
  // written for: the proxy clears the cookie on any 401, so by the time the client sees one the
  // session is genuinely over — which is where sign-out was going. Rethrowing would strand the
  // creator on a map backed by a credential that no longer exists.
  await page.waitForURL("**/login");
  expect(logout.calls).toEqual([{ method: "POST" }]);
});

test("a refused sign-out keeps the creator on the map and says so", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL);
  await openDrawer(page);
  stubLogout(page, 500);

  await page.getByTestId("sign-out-action").click();

  // The honest outcome, and the reason this branch exists at all: only the proxy can clear an
  // httpOnly cookie, so a refused logout leaves the session **alive**. Navigating to `/login`
  // anyway would report an ending that did not happen — FR-002a's "ends only on ... an explicit
  // sign-out" read backwards.
  await expect(page.getByTestId("sign-out-message")).toHaveText(/could not sign you out/i);
  expect(new URL(page.url()).pathname).toBe("/map");
  // Still offered, because the creator's next move is to try again — and the drawer stayed open
  // through the refusal rather than closing on it, which would have hidden the very message this
  // asserts.
  await expect(page.getByTestId("sign-out-action")).toBeEnabled();
});

test("the sign-out control meets the 44px tap floor and does not overflow", async ({
  page,
  baseURL,
}) => {
  await openMap(page, baseURL);
  await openDrawer(page);

  const viewport = page.viewportSize()!;
  const box = (await page.getByTestId("sign-out-action").boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

// The old "the header still fits its longest period title beside the drawer trigger" test is
// removed rather than ported: it pinned Content Calendar's `PeriodNav` title (`28 Dec 2026 – 3 Jan
// 2027`, the longest string that surface could produce next to the drawer trigger), and `/map`'s
// own header has no equivalent — `map-title`/`map-eyebrow` are static strings, not a navigated
// period. `/map`'s header overflow at 375px is covered by `viewport-audit.spec.ts` instead.
