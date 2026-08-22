import { NextResponse, type NextRequest } from "next/server";

import {
  apiBaseUrl,
  maxAgeFromToken,
  sessionCookieAttributes,
  sessionCookieName,
} from "@/lib/session";

/**
 * Travel Intelligence's own proxy hop.
 *
 * Deliberately NOT routed through `app/api/[...path]/route.ts` and `lib/proxy-allowlist.ts`. That
 * allowlist is asserted against `contracts/openapi.yaml` by a contract test — every entry must
 * appear in a committed OpenAPI document — so putting `/ai/chat` on it would mean writing a
 * contract file before the endpoint can be called at all. A dedicated static route wins over the
 * catch-all in Next's matcher, so this file is the whole of the difference.
 *
 * The security property the allowlist exists for is unchanged and is restated here rather than
 * inherited: the session JWT lives in an httpOnly cookie, is attached server-side as a bearer
 * header, and never reaches browser JavaScript. The browser still speaks only to this origin.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieName = sessionCookieName();
  const token = request.cookies.get(cookieName)?.value;

  if (!token) {
    return NextResponse.json({ detail: "Not authenticated." }, { status: 401 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ detail: "Could not read the request body." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/ai/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body,
      cache: "no-store",
    });
  } catch {
    // The backend being down is the single most common cause while developing, and
    // "ApiError(0, ...)" has cost this project time before. Say which service is unreachable.
    return NextResponse.json(
      { detail: "The backend is unreachable. Is `docker compose up -d backend` running?" },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  const response = new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });

  // Sliding reissue (tech-defaults.md). The catch-all does this for every other route; a long
  // session spent only in the console would otherwise not slide, and would expire on day 30
  // looking like a token bug.
  const reissued = upstream.headers.get("x-access-token");
  if (reissued) {
    response.cookies.set(cookieName, reissued, sessionCookieAttributes(maxAgeFromToken(reissued)));
  }

  return response;
}
