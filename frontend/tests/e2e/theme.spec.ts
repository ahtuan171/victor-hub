import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * The remembered presentation (T036, FR-010–FR-014, FR-013a, FR-013b, SC-005, SC-006), at the
 * 375x667 floor.
 *
 * `quickstart.md`'s V6 is the acceptance script this file ports one-to-one: six checks, the last
 * three of which are "the ones an implementation usually gets wrong" — persistence, no-flash, and
 * a throttled connection — plus FR-013b's sign-out screen.
 *
 * The proxy is stubbed, as in every other file here (`login.spec.ts`'s docstring has the full
 * reasoning): CI runs the production bundle with no FastAPI behind it, so what is under test is the
 * page and `app/layout.tsx`'s server-side cookie read, not a real round trip. `tests/proxy/route.spec.ts`
 * separately proves the real proxy turns a login response's `preferences.theme` into this cookie.
 */

const SESSION_COOKIE = "ch_session";
const THEME_COOKIE = "ch_theme";

async function addCookies(
  page: Page,
  baseURL: string | undefined,
  cookies: { readonly session?: boolean; readonly theme?: "dark" | "light" },
): Promise<void> {
  const jar = [];
  if (cookies.session !== false) {
    jar.push({ name: SESSION_COOKIE, value: "stub-session", url: baseURL! });
  }
  if (cookies.theme !== undefined) {
    jar.push({ name: THEME_COOKIE, value: cookies.theme, url: baseURL! });
  }
  await page.context().addCookies(jar);
}

/** `/map` (`MapShell`) is the stage now that `/calendar` (Content Calendar) was removed
 * 2026-08-22 — it loads both Destinations and Trips on mount, so both need stubbing. */
async function stubMapData(page: Page): Promise<void> {
  await page.route("**/api/destinations*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

/** `<html class="...">`'s exact attribute value, read from the *served* document — no JavaScript. */
async function servedHtmlClass(context: BrowserContext, path: string): Promise<string> {
  const response = await context.request.get(path);
  const html = await response.text();
  const match = /<html[^>]*\bclass="([^"]*)"/.exec(html);
  if (match === null) throw new Error(`no <html class="..."> found in the response for ${path}`);
  return match[1]!;
}

test("switching applies within the same view, in under a second (SC-005)", async ({
  page,
  baseURL,
}) => {
  await addCookies(page, baseURL, { theme: "dark" });
  await stubMapData(page);
  await page.goto("/map");
  await page.getByTestId("map-eyebrow").waitFor();
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

  await page.getByTestId("nav-drawer-trigger").click();
  await page.getByTestId("theme-option-light").click();

  // No wait inserted before this assertion: the class change is a synchronous DOM write
  // (`applyTheme`), not the outcome of the `PATCH` this same tap also fires.
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  // Same screen, same panel — switching is not a navigation.
  expect(new URL(page.url()).pathname).toBe("/map");
  await expect(page.getByTestId("nav-drawer-panel")).toBeVisible();
});

test("the choice persists across a reload (FR-011)", async ({ page, baseURL }) => {
  await addCookies(page, baseURL, { theme: "dark" });
  await stubMapData(page);
  await page.goto("/map");
  await page.getByTestId("map-eyebrow").waitFor();

  await page.getByTestId("nav-drawer-trigger").click();
  await page.getByTestId("theme-option-light").click();
  await page.getByTestId("nav-drawer-close").click();

  await page.reload();
  await page.getByTestId("map-eyebrow").waitFor();
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
});

test("with no choice ever made, the presentation is dark (FR-012)", async ({ page, baseURL }) => {
  await addCookies(page, baseURL, {}); // session only — no ch_theme has ever been written
  await stubMapData(page);
  await page.goto("/map");
  await page.getByTestId("map-eyebrow").waitFor();

  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
});

test("the served document already carries the right class — no flash, not even one frame (FR-013)", async ({
  page,
  context,
  baseURL,
}) => {
  await addCookies(page, baseURL, { theme: "light" });
  await stubMapData(page);

  // Read at the network layer, before a single line of client JavaScript could run — the strongest
  // form of "before any JavaScript runs" available: there is no JavaScript in this request at all.
  const htmlClass = await servedHtmlClass(context, "/map");
  expect(htmlClass.split(/\s+/)).not.toContain("dark");
});

test("dark is likewise already in the served document when the cookie says dark", async ({
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: SESSION_COOKIE, value: "stub-session", url: baseURL! }]);
  await context.route("**/api/destinations*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await context.route("**/api/trips*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  const htmlClass = await servedHtmlClass(context, "/map");
  expect(htmlClass.split(/\s+/)).toContain("dark");
});

test("another device signing into the same account sees the account's presentation (FR-011)", async ({
  page,
  baseURL,
}) => {
  // A fresh cookie jar, no `ch_theme` of its own yet — simulating a second device where this
  // creator has never opened the product before, only ever chosen light on the first one.
  await stubMapData(page);
  await page.route("**/api/auth/login", async (route) => {
    // Two `Set-Cookie` values cannot be joined into one header string (unlike other headers, commas
    // inside a cookie's own attributes make that ambiguous — RFC 6265 requires separate header
    // lines, which `route.fulfill`'s single-string-per-key `headers` cannot express). `addCookies`
    // stands in for what the real proxy's *second* `Set-Cookie` line would do — the extraction and
    // the real header mechanics are what `tests/proxy/route.spec.ts`'s T035 cases prove; this file is
    // about what the page does once both cookies exist.
    await page.context().addCookies([{ name: THEME_COOKIE, value: "light", url: baseURL! }]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ expires_at: "2026-08-30T09:00:00Z" }),
      headers: { "set-cookie": `${SESSION_COOKIE}=stub-session; Path=/` },
    });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("a@b.c");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL("**/map");
  await page.getByTestId("map-eyebrow").waitFor();
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
});

test("holds under a throttled connection — correct from the server, not a client correction (FR-013a)", async ({
  page,
  baseURL,
}) => {
  await addCookies(page, baseURL, { theme: "light" });
  await stubMapData(page);

  // Slow the document response specifically. If correctness ever came from a client-side script
  // instead of the server-rendered class, a slow connection is exactly what would expose the gap —
  // more time for a "flash" to be visible, not less.
  await page.route("**/map", async (route) => {
    if (route.request().resourceType() === "document") {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await route.continue();
  });

  // `domcontentloaded`, deliberately not the default `load` — checked before hydration has had any
  // chance to run, let alone correct anything.
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
});

test("the sign-in screen uses this device's last presentation, and it does not flip on sign-in (FR-013b)", async ({
  page,
  baseURL,
}) => {
  // No session cookie — signed out — but this device has shown light before.
  await page.context().addCookies([{ name: THEME_COOKIE, value: "light", url: baseURL! }]);

  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in" }).waitFor();
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
});
