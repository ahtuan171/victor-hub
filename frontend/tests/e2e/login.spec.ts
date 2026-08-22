import { expect, test, type Page } from "@playwright/test";

/**
 * The login page (T025), driven at the 375x667 design floor.
 *
 * **The proxy is stubbed, and it has to be.** `.gitlab-ci.yml`'s `test:e2e` job runs the production
 * bundle with no FastAPI and no Postgres behind it, so a test that performed a real sign-in would
 * be green only on a developer's machine — the exact "verified locally, red in CI" failure this
 * project has already paid for three times. What is under test here is the *page*: what it renders,
 * what it sends, where it goes. The proxy itself is covered by `tests/proxy/`, against its own stub.
 *
 * Note what the stub therefore cannot prove: that a real 401 from FastAPI carries a `detail`, or
 * that the cookie is actually set. Both are covered elsewhere — `backend/tests/test_auth.py` and
 * `tests/proxy/route.spec.ts` respectively — and the seam between them is what quickstart V1 walks
 * by hand.
 */

const LOGIN_RESPONSE = { expires_at: "2026-08-30T09:00:00Z" };

/** Matches `sessionCookieName()`'s default and `.env.example`. See `stubLogin`. */
const SESSION_COOKIE = "ch_session";

/**
 * Stub `POST /api/auth/login` with a given status and body, and record what the page sent.
 *
 * **A 2xx also sets the session cookie, because that is the other half of what the proxy does.**
 * Until T033 this stub returned only the body, and the two tests that follow a successful sign-in
 * passed anyway — `/calendar` did not exist, and a 404 leaves the browser at the address it asked
 * for. Now that the route exists it is guarded, so a stub that skipped the cookie would send a
 * correct sign-in straight back to `/login` and fail on a shortcoming of the stub rather than of the
 * page.
 *
 * The cookie is not `httpOnly` here and does not need to be: what is under test is where the page
 * goes next. The real attributes are asserted against the real proxy in `tests/proxy/route.spec.ts`,
 * which is the seam that owns them.
 */
async function stubLogin(
  page: Page,
  status: number,
  body: unknown,
): Promise<{ requests: unknown[] }> {
  const requests: unknown[] = [];

  await page.route("**/api/auth/login", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
      ...(status < 400 ? { headers: { "set-cookie": `${SESSION_COOKIE}=stub-session; Path=/` } } : {}),
    });
  });

  return { requests };
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

/**
 * `/map` (the landing screen since 2026-08-22) loads Destinations and Trips on mount. Stubbed here
 * so a real backend left running locally cannot 401 these requests and bounce the test back to
 * `/login` — the trap `frontend/AGENTS.md` already documents for other e2e files.
 */
async function stubMapData(page: Page): Promise<void> {
  await page.route("**/api/destinations*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

test("the page body does not scroll horizontally at 375px", async ({ page }) => {
  await page.goto("/login");

  // Constitution principle I and design.md: wide content scrolls inside its own container, the body
  // never does. Asserted on the element that actually overflows rather than by eyeballing a
  // screenshot.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("the submit button sits in the bottom half, within thumb reach", async ({ page }) => {
  await page.goto("/login");

  const button = page.getByRole("button", { name: /sign in/i });
  const box = await button.boundingBox();
  const viewport = page.viewportSize();

  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  // design.md: "Primary actions sit within thumb reach — bottom half of the screen, not a top-right
  // toolbar." That is a structural requirement, so it gets an assertion rather than a code review.
  expect(box!.y).toBeGreaterThan(viewport!.height / 2);
});

test("both fields clear the 44px minimum tap target", async ({ page }) => {
  await page.goto("/login");

  for (const label of ["Email", "Password"]) {
    const box = await page.getByLabel(label).boundingBox();
    expect(box).not.toBeNull();
    // Every shadcn size variant is desktop-scaled (`lg` is 36px), so this is an override that a
    // future refactor could silently drop.
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("a wrong password renders the error and stays on /login", async ({ page }) => {
  await stubLogin(page, 401, { detail: "Incorrect email or password." });

  await page.goto("/login");
  await signIn(page, "creator@example.com", "wrong");

  // The load-bearing half of T024's exemption list, asserted end to end: `lib/api.ts` redirects to
  // /login on a 401 for every operation *except* the two /auth/* ones. Remove that exemption and
  // this page reloads itself, discarding the message — so this test is what stops it being removed.
  await expect(page.locator("#login-error")).toHaveText("Incorrect email or password.");
  expect(new URL(page.url()).pathname).toBe("/login");
});

test("an unreachable server produces a readable message, not a stack trace", async ({ page }) => {
  await page.route("**/api/auth/login", (route) => route.abort("failed"));

  await page.goto("/login");
  await signIn(page, "creator@example.com", "hunter2");

  await expect(page.locator("#login-error")).toContainText(/could not reach the server/i);
  expect(new URL(page.url()).pathname).toBe("/login");
});

test("a successful sign-in sends the credentials and leaves for the landing screen", async ({
  page,
}) => {
  const stub = await stubLogin(page, 200, LOGIN_RESPONSE);
  await stubMapData(page);

  await page.goto("/login");
  await signIn(page, "creator@example.com", "hunter2");

  // Since T033 this lands on a real, guarded page rather than a 404 — which is why `stubLogin` now
  // sets the session cookie as well as returning the body. The landing screen moved from
  // `/calendar` to `/map` 2026-08-22, when Content Calendar was removed — the owner's instruction.
  await page.waitForURL("**/map");
  expect(new URL(page.url()).pathname).toBe("/map");

  expect(stub.requests).toEqual([{ email: "creator@example.com", password: "hunter2" }]);
});

test("signing in does not put a token anywhere the browser can read", async ({ page }) => {
  await stubLogin(page, 200, { ...LOGIN_RESPONSE, access_token: "leaked.jwt.value" });
  await stubMapData(page);

  await page.goto("/login");
  await signIn(page, "creator@example.com", "hunter2");
  await page.waitForURL("**/map");

  // R-001 in one assertion. The proxy is what strips the token in production; this guards the other
  // end — that the *page* never copies a credential into storage even when handed one. A future
  // "remember the session" change would trip this, which is the point.
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(stored.local).not.toContain("leaked.jwt.value");
  expect(stored.session).not.toContain("leaked.jwt.value");
});

test("the form cannot be submitted empty", async ({ page }) => {
  const stub = await stubLogin(page, 200, LOGIN_RESPONSE);

  await page.goto("/login");
  await page.getByRole("button", { name: /sign in/i }).click();

  // Native `required` validation blocks it before any request is made.
  expect(stub.requests).toEqual([]);
  expect(new URL(page.url()).pathname).toBe("/login");
});

/**
 * The pre-hydration window, found at T072 against the *deployed* product.
 *
 * `handleSubmit` calls `preventDefault()`, but only once React has attached it. Before that the
 * button is a plain `type="submit"` inside a `<form>` — and a `<form>` with no `method` defaults to
 * **GET**, so a tap in that window navigated to `/login?email=...&password=...`. The creator's
 * password reached the address bar, browser history, and the edge's access logs: constitution II
 * broken by a default nobody chose.
 *
 * **Nothing in this suite could have caught it before**, and that is the reusable lesson rather than
 * the bug. Every test here stubs the proxy *and* runs against a local server where hydration is
 * effectively instant, so the window never opens. It took the first load of the day on a free tier
 * that had spun down — a ~44s document, with hydration behind it — to make the window wide enough
 * to tap in.
 *
 * Two tests because there are two independent halves, and the second must keep working if the first
 * is ever removed.
 */
test("the form posts, so a submit before hydration cannot put credentials in the URL", async ({
  page,
}) => {
  await page.goto("/login");

  // A static attribute, asserted directly. `method` is the whole defence here: it decides whether a
  // native submit carries the password in a query string or in a request body. Do not relax this to
  // "not GET" — the value is the requirement.
  await expect(page.locator("form")).toHaveAttribute("method", "post");
});

test("the submit button is inert until React has hydrated", async ({ page }) => {
  // Block every script so hydration never happens. What is left is exactly what a creator sees
  // during the window: server-rendered markup with no handlers attached.
  //
  // Matched on `resourceType`, not on a `**/*.js` glob: Next serves chunks with cache-busting query
  // strings in dev, which a suffix glob misses — and a test that silently stopped blocking anything
  // would pass against a hydrated page and prove nothing.
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const button = page.getByRole("button", { name: /sign in/i });
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();

  // The fields still take text natively, so this is the real gesture: type a password, tap sign in.
  await page.locator("#email").fill("creator@example.com");
  await page.locator("#password").fill("hunter2");
  await button.click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);

  // The password must not have reached the URL by any route. Asserted on the whole href rather than
  // on a named parameter, because the failure this guards against is a *native form submission*
  // serialising every field it can find.
  expect(page.url()).not.toContain("hunter2");
  expect(new URL(page.url()).search).toBe("");
});
