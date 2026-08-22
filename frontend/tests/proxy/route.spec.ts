import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";

import { DELETE, GET, PATCH, POST } from "../../app/api/[...path]/route";

/**
 * The proxy, driven directly with a stubbed upstream.
 *
 * Everything asserted here is invisible from the browser — a stripped header, a cookie attribute, a
 * credential that must not appear in a body — so an end-to-end flow would confirm none of it. The
 * upstream is a stub rather than a live FastAPI for the same reason: several cases (a reissued
 * token, an unparseable login body) are states the backend produces rarely or never on demand.
 *
 * `tests/e2e` covers the other direction at T057.
 */

const UPSTREAM = "http://api.test";

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

let captured: Captured | null = null;
let reply: Response = new Response(null, { status: 204 });

test.beforeEach(() => {
  process.env.API_BASE_URL = UPSTREAM;
  process.env.SESSION_COOKIE_NAME = "ch_session";
  process.env.SESSION_COOKIE_SECURE = "true";

  captured = null;
  reply = new Response(null, { status: 204 });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input as string | URL, init);
    captured = {
      url: request.url,
      method: request.method,
      headers: new Headers(request.headers),
      body: await request.text(),
    };
    return reply;
  }) as typeof fetch;
});

/** A structurally valid JWT. Only the payload is ever read, and never verified — see lib/session.ts. */
function tokenExpiringIn(seconds: number): string {
  const payload = Buffer.from(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + seconds }))
    .toString("base64url");
  return `header.${payload}.signature`;
}

function requestFor(
  method: string,
  segments: string[],
  options: { cookie?: string; body?: string; search?: string } = {},
) {
  const headers = new Headers({ accept: "application/json" });
  if (options.cookie !== undefined) headers.set("cookie", `ch_session=${options.cookie}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");

  const url = `http://localhost/api/${segments.join("/")}${options.search ?? ""}`;
  const request = new NextRequest(url, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
  });

  return [request, { params: Promise.resolve({ path: segments }) }] as const;
}

test.describe("the allowlist gate", () => {
  test("an off-allowlist path returns 404 and never leaves Vercel", async () => {
    const response = await GET(...requestFor("GET", ["health"]));

    expect(response.status).toBe(404);
    expect(captured, "a request reached the upstream for a path that is not allowlisted").toBeNull();
    expect(await response.json()).toEqual({ detail: "Not Found" });
  });

  test("an unknown path returns 404", async () => {
    const response = await GET(...requestFor("GET", ["growth-metrics"]));

    expect(response.status).toBe(404);
    expect(captured).toBeNull();
  });

  test("a method the contract does not give that path returns 404", async () => {
    const response = await DELETE(...requestFor("DELETE", ["trips"]));

    expect(response.status).toBe(404);
    expect(captured).toBeNull();
  });

  test("a non-integer item id returns 404", async () => {
    const response = await GET(...requestFor("GET", ["trips", ".."]));

    expect(response.status).toBe(404);
    expect(captured).toBeNull();
  });
});

test.describe("attaching the credential", () => {
  test("the cookie becomes a bearer header and is not forwarded as a cookie", async () => {
    await GET(...requestFor("GET", ["trips"], { cookie: "the-token" }));

    expect(captured?.headers.get("authorization")).toBe("Bearer the-token");
    expect(captured?.headers.get("cookie"), "the session cookie must not reach the backend").toBeNull();
  });

  test("no cookie means no authorization header, and the 401 comes from the backend", async () => {
    reply = new Response(JSON.stringify({ detail: "Not authenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

    const response = await GET(...requestFor("GET", ["trips"]));

    expect(captured?.headers.get("authorization")).toBeNull();
    expect(response.status).toBe(401);
  });

  test("the query string and body survive the hop", async () => {
    await GET(...requestFor("GET", ["trips"], { search: "?scheduled=none&platform=tiktok" }));
    expect(captured?.url).toBe(`${UPSTREAM}/trips?scheduled=none&platform=tiktok`);

    await POST(...requestFor("POST", ["trips"], { body: '{"title":"an idea"}' }));
    expect(captured?.body).toBe('{"title":"an idea"}');
    expect(captured?.headers.get("content-type")).toBe("application/json");
  });

  test("a path parameter reaches the backend as written", async () => {
    await PATCH(...requestFor("PATCH", ["trips", "42"], { body: '{"status":"posted"}' }));
    expect(captured?.url).toBe(`${UPSTREAM}/trips/42`);
  });
});

test.describe("sliding reissue", () => {
  test("X-Access-Token is stripped and written into the cookie with a fresh Max-Age", async () => {
    const token = tokenExpiringIn(30 * 24 * 60 * 60);
    reply = new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json", "x-access-token": token },
    });

    const response = await GET(...requestFor("GET", ["trips"], { cookie: "the-old-token" }));

    expect(response.headers.get("x-access-token"), "the reissue header reached the browser").toBeNull();

    const cookie = response.cookies.get("ch_session");
    expect(cookie?.value).toBe(token);
    // Without Max-Age this is a session cookie and mobile Safari drops it on tab eviction, which is
    // the failure that looks like a token bug (research.md R-002).
    expect(cookie?.maxAge).toBeGreaterThan(29 * 24 * 60 * 60);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
  });

  test("no header means the cookie is left alone", async () => {
    reply = new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });

    const response = await GET(...requestFor("GET", ["trips"], { cookie: "the-token" }));

    expect(response.cookies.get("ch_session")).toBeUndefined();
  });
});

test.describe("login", () => {
  test("the token moves into the cookie and out of the body", async () => {
    const token = tokenExpiringIn(30 * 24 * 60 * 60);
    reply = new Response(
      JSON.stringify({ access_token: token, token_type: "bearer", expires_at: "2026-08-30T00:00:00Z" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    const response = await POST(
      ...requestFor("POST", ["auth", "login"], { body: '{"email":"a@b.c","password":"x"}' }),
    );

    const body = await response.text();
    expect(body, "a 30-day credential reached browser JavaScript — research.md R-001").not.toContain(token);
    expect(JSON.parse(body)).toEqual({ expires_at: "2026-08-30T00:00:00Z" });

    const cookie = response.cookies.get("ch_session");
    expect(cookie?.value).toBe(token);
    expect(cookie?.maxAge).toBeGreaterThan(29 * 24 * 60 * 60);
  });

  test("preferences in the login body become the ch_theme cookie (T035)", async () => {
    const token = tokenExpiringIn(30 * 24 * 60 * 60);
    reply = new Response(
      JSON.stringify({
        access_token: token,
        token_type: "bearer",
        expires_at: "2026-08-30T00:00:00Z",
        preferences: { theme: "light", sound_enabled: true },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    const response = await POST(
      ...requestFor("POST", ["auth", "login"], { body: '{"email":"a@b.c","password":"x"}' }),
    );

    const cookie = response.cookies.get("ch_theme");
    expect(cookie?.value).toBe("light");
    // Not httpOnly — the client rewrites this cookie on every toggle (research.md R-002).
    expect(cookie?.httpOnly).toBeFalsy();
    expect(cookie?.maxAge).toBeGreaterThan(300 * 24 * 60 * 60);
  });

  test("no preferences in the login body leaves ch_theme untouched", async () => {
    const token = tokenExpiringIn(30 * 24 * 60 * 60);
    reply = new Response(
      JSON.stringify({ access_token: token, token_type: "bearer", expires_at: "2026-08-30T00:00:00Z" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    const response = await POST(
      ...requestFor("POST", ["auth", "login"], { body: '{"email":"a@b.c","password":"x"}' }),
    );

    // `PreferencesRead` is optional in the contract on purpose — a login response that omits it must
    // not overwrite whatever presentation this device already had.
    expect(response.cookies.get("ch_theme")).toBeUndefined();
  });

  test("a value outside the two-member Theme enum is refused, not written as a third presentation", async () => {
    const token = tokenExpiringIn(30 * 24 * 60 * 60);
    reply = new Response(
      JSON.stringify({
        access_token: token,
        token_type: "bearer",
        expires_at: "2026-08-30T00:00:00Z",
        preferences: { theme: "solarized", sound_enabled: false },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    const response = await POST(
      ...requestFor("POST", ["auth", "login"], { body: '{"email":"a@b.c","password":"x"}' }),
    );

    expect(response.cookies.get("ch_theme")).toBeUndefined();
  });

  test("a 200 login body the contract does not describe is refused, not forwarded", async () => {
    reply = new Response(JSON.stringify({ token: "surprise-shape" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const response = await POST(
      ...requestFor("POST", ["auth", "login"], { body: '{"email":"a@b.c","password":"x"}' }),
    );

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("surprise-shape");
    expect(response.cookies.get("ch_session")).toBeUndefined();
  });

  test("bad credentials pass through untouched", async () => {
    reply = new Response(JSON.stringify({ detail: "Incorrect email or password" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

    const response = await POST(
      ...requestFor("POST", ["auth", "login"], { body: '{"email":"a@b.c","password":"x"}' }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ detail: "Incorrect email or password" });
  });
});

test.describe("clearing the session", () => {
  test("logout clears the cookie", async () => {
    reply = new Response(null, { status: 204 });

    const response = await POST(...requestFor("POST", ["auth", "logout"], { cookie: "the-token" }));

    expect(response.status).toBe(204);
    const cookie = response.cookies.get("ch_session");
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });

  test("logout clears the cookie even when the backend refuses", async () => {
    // T014 makes logout survive an expired token, but a request with no credential at all is a 401
    // — and the cookie still has to go, or the creator cannot sign out of a broken session.
    reply = new Response(JSON.stringify({ detail: "Not authenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

    const response = await POST(...requestFor("POST", ["auth", "logout"], { cookie: "stale" }));

    expect(response.cookies.get("ch_session")?.maxAge).toBe(0);
  });

  test("any 401 clears the cookie, because JavaScript cannot", async () => {
    reply = new Response(JSON.stringify({ detail: "Not authenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

    const response = await GET(...requestFor("GET", ["trips"], { cookie: "expired" }));

    expect(response.cookies.get("ch_session")?.maxAge).toBe(0);
  });
});

test.describe("upstream failures", () => {
  test("an unreachable API is a 502 in the contracted error shape", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch;

    const response = await GET(...requestFor("GET", ["trips"], { cookie: "the-token" }));

    expect(response.status).toBe(502);
    expect(Object.keys(await response.json())).toEqual(["detail"]);
  });

  test("a 204 is relayed without a body", async () => {
    reply = new Response(null, { status: 204 });

    const response = await DELETE(...requestFor("DELETE", ["trips", "42"], { cookie: "the-token" }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
