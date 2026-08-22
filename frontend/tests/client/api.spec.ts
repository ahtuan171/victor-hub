import { expect, test } from "@playwright/test";

import { ApiError, createTrip, listTrips, login, logout } from "../../lib/api";

/**
 * The API client driven against a stubbed `fetch`.
 *
 * Browserless, like tests/proxy: what matters here is the shape of the request that leaves the
 * client and the shape of the value that comes back, both of which are invisible from a page. The
 * proxy is not involved — these assertions are about the browser side of the boundary, and
 * tests/proxy already covers the other side.
 *
 * Everything below is an R-007 or R-001 consequence rather than a taste: same-origin `/api`, no
 * credential in the client's hands, and one error type callers can catch.
 */

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

const recorded: Recorded[] = [];
let originalFetch: typeof globalThis.fetch;

/**
 * A stand-in for `window`, because the runner has none.
 *
 * `lib/api.ts` guards on `typeof window === "undefined"` so it is inert on the server, which also
 * makes the redirect invisible to a test that does nothing. Defining the two members the handler
 * touches is enough, and far less machinery than a browser would be for asserting one call.
 */
interface FakeWindow {
  readonly location: { pathname: string; replace: (url: string) => void };
}

const replaced: string[] = [];

function fakeWindowAt(pathname: string): void {
  const fake: FakeWindow = {
    location: {
      pathname,
      replace: (url) => {
        replaced.push(url);
      },
    },
  };
  (globalThis as { window?: unknown }).window = fake;
}

/** The one call the stub saw. Fails loudly rather than returning undefined into an assertion. */
function onlyCall(): Recorded {
  expect(recorded).toHaveLength(1);
  const call = recorded[0];
  if (call === undefined) throw new Error("unreachable: length asserted above");
  return call;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Replaces `fetch` for one test. Restored in afterEach whatever the test does. */
function stub(responder: () => Response | Promise<Response>): void {
  globalThis.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    recorded.push({ url: String(input), init });
    return Promise.resolve(responder());
  };
}

test.beforeEach(() => {
  recorded.length = 0;
  replaced.length = 0;
  originalFetch = globalThis.fetch;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  // The runner has no `window` of its own; leaving one behind would make the *next* file's view of
  // "am I in a browser" wrong.
  delete (globalThis as { window?: unknown }).window;
});

test.describe("the transport", () => {
  test("every request is same-origin under /api and carries no Authorization header", async () => {
    stub(() => json([]));
    await listTrips();

    const { url, init } = onlyCall();

    // Relative, so it resolves against the Vercel origin. An absolute backend URL here would be
    // the browser talking to Render directly, which is the whole thing R-001 forbids.
    expect(url).toBe("/api/trips");
    expect(url.startsWith("http")).toBe(false);

    // The cookie is the credential and the proxy turns it into a bearer. A header set here would
    // be one the client cannot read the value of.
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain("authorization");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  test("a GET sends no body and no content-type", async () => {
    stub(() => json([]));
    await listTrips();

    const { init } = onlyCall();
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("content-type");
  });

  test("a network failure becomes an ApiError, not a raw TypeError", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));

    const error = await login({ email: "a@b.com", password: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    // Callers get one error type to handle. Two would mean every surface writing two catch arms.
    expect((error as ApiError).detail).toContain("connection");
  });

  test("an error body that is not the contract's shape still yields a readable sentence", async () => {
    stub(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    const error = (await listTrips().catch((caught: unknown) => caught)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.detail).toContain("502");
  });
});

const TRIP_DRAFT = { name: "x", start_date: "2026-09-01", end_date: "2026-09-02" };

test.describe("the 401 handler (T024)", () => {
  test("a 401 on a read sends the browser to /login", async () => {
    fakeWindowAt("/map");
    stub(() => json({ detail: "Not authenticated" }, 401));

    // The error still reaches the caller: navigation is not instantaneous, so a surface that
    // ignored it would keep rendering for a beat.
    await expect(listTrips()).rejects.toThrow(ApiError);

    // `replace`, not `assign` — the page that just 401'd must not sit in history, or going back
    // would 401 again and bounce straight here.
    expect(replaced).toEqual(["/login"]);
  });

  test("it fires on create too — one handler, not one per operation (FR-002)", async () => {
    fakeWindowAt("/map");
    stub(() => json({ detail: "Not authenticated" }, 401));

    await expect(createTrip(TRIP_DRAFT)).rejects.toThrow(ApiError);
    expect(replaced).toEqual(["/login"]);
  });

  test("a failed sign-in does not redirect — that 401 is a wrong password, not a dead session", async () => {
    fakeWindowAt("/login");
    stub(() => json({ detail: "Email or password is incorrect." }, 401));

    await expect(login({ email: "a@b.com", password: "no" })).rejects.toThrow(ApiError);

    // Redirecting would reload /login and discard the message the form has to show.
    expect(replaced).toEqual([]);
  });

  test("logout does not redirect — its caller owns where to go next", async () => {
    fakeWindowAt("/map");
    stub(() => json({ detail: "Not authenticated" }, 401));

    await expect(logout()).resolves.toBeUndefined();
    expect(replaced).toEqual([]);
  });

  test("a page already on /login does not reload itself", async () => {
    fakeWindowAt("/login");
    stub(() => json({ detail: "Not authenticated" }, 401));

    await expect(listTrips()).rejects.toThrow(ApiError);
    expect(replaced).toEqual([]);
  });

  test("no other status redirects", async () => {
    fakeWindowAt("/map");

    for (const status of [403, 404, 409, 422, 500, 502]) {
      stub(() => json({ detail: "nope" }, status));
      await expect(listTrips()).rejects.toThrow(ApiError);
    }

    expect(replaced).toEqual([]);
  });

  test("it is inert with no window, so a server-side import cannot throw a ReferenceError", async () => {
    // No fakeWindowAt() — this is the runner's natural state, and the server's.
    stub(() => json({ detail: "Not authenticated" }, 401));

    await expect(listTrips()).rejects.toThrow(ApiError);
    expect(replaced).toEqual([]);
  });
});

test.describe("login", () => {
  test("returns expires_at and nothing resembling a credential", async () => {
    // Exactly what the proxy forwards: it captured `access_token` into the httpOnly cookie.
    stub(() => json({ expires_at: "2026-08-30T02:00:00Z" }));

    const result = await login({ email: "creator@example.com", password: "hunter2" });

    expect(result).toEqual({ expires_at: "2026-08-30T02:00:00Z" });
    // The client must never grow a token field. If this fails, someone re-added one to the proxy.
    expect(Object.keys(result)).toEqual(["expires_at"]);

    const { url, init } = onlyCall();
    expect(init.method).toBe("POST");
    expect(url).toBe("/api/auth/login");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "creator@example.com",
      password: "hunter2",
    });
  });

  test("a 401 surfaces the backend's message, which does not say which field was wrong", async () => {
    stub(() => json({ detail: "Email or password is incorrect." }, 401));

    const error = (await login({ email: "a@b.com", password: "no" }).catch(
      (caught: unknown) => caught,
    )) as ApiError;

    expect(error.status).toBe(401);
    expect(error.detail).toBe("Email or password is incorrect.");
  });
});

test.describe("logout", () => {
  test("resolves on the contract's 204, which carries no body to parse", async () => {
    stub(() => new Response(null, { status: 204 }));

    await expect(logout()).resolves.toBeUndefined();
    expect(onlyCall().url).toBe("/api/auth/logout");
  });

  test("resolves on a 401 too — signing out of an already-expired session must work (SC-006)", async () => {
    stub(() => json({ detail: "Not authenticated" }, 401));

    // The proxy clears the cookie on any 401, so the session really is over. Throwing here would
    // strand the creator in a signed-out state that the UI still believes is signed in.
    await expect(logout()).resolves.toBeUndefined();
  });

  test("still throws on any other failure", async () => {
    stub(() => json({ detail: "boom" }, 500));
    await expect(logout()).rejects.toThrow(ApiError);
  });
});

