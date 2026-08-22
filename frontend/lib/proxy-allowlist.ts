/**
 * The proxy's boundary (research.md R-008).
 *
 * `app/api/[...path]/route.ts` forwards requests to FastAPI with the creator's token attached
 * server-side. A catch-all that forwards *anything* would make every present and future backend
 * route browser-reachable with full credentials, which is precisely what constitution principle II
 * forbids ("MUST NOT become reachable as a side effect of an existing endpoint"). This module is
 * the list of what may cross; the proxy 404s everything else without a request leaving Vercel.
 *
 * Two rules keep the list honest, both asserted by tests/contract/proxy-allowlist.spec.ts:
 *
 *   1. Every entry here names a path and method that exist in contracts/openapi.yaml.
 *   2. Every operation in that contract is either allowed here or listed in NOT_PROXIED with a
 *      reason. There is no third option, so adding an endpoint to the API cannot silently expose
 *      it and cannot silently be forgotten either — the test goes red until someone decides.
 *
 * Path templates are written exactly as they appear in the contract so rule 1 is a string
 * comparison rather than an interpretation.
 */

export const PROXY_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
export type ProxyMethod = (typeof PROXY_METHODS)[number];

export interface AllowlistEntry {
  /** Contract path template, verbatim from openapi.yaml. */
  readonly path: string;
  readonly methods: readonly ProxyMethod[];
}

export const PROXY_ALLOWLIST: readonly AllowlistEntry[] = [
  { path: "/auth/login", methods: ["POST"] },
  { path: "/auth/logout", methods: ["POST"] },
  // From specs/002-pixel-arcade-skin/contracts/openapi.yaml — a second contract file, not a second
  // API. proxy-allowlist.spec.ts reads both, per that file's header comment.
  { path: "/preferences", methods: ["GET", "PATCH"] },
  // From specs/003-travel-map/contracts/openapi.yaml — unlike 002, a genuinely new, standalone
  // resource space (its own header comment says so), not a delta on an existing one. Every
  // operation below is called from the browser (frontend/lib/api.ts, T009), so all fourteen are
  // allowed rather than excluded.
  { path: "/trips", methods: ["GET", "POST"] },
  { path: "/trips/{trip_id}", methods: ["GET", "PATCH", "DELETE"] },
  { path: "/destinations", methods: ["GET", "POST"] },
  { path: "/destinations/{destination_id}", methods: ["GET", "PATCH", "DELETE"] },
  { path: "/locations/search", methods: ["GET"] },
  { path: "/destinations/{destination_id}/photos", methods: ["POST"] },
  { path: "/destinations/{destination_id}/photos/upload-url", methods: ["POST"] },
  { path: "/destinations/{destination_id}/photos/{photo_id}", methods: ["DELETE"] },
  // From specs/travel-schedule/contracts/openapi.yaml — Module 02, built outside the speckit
  // workflow (see that file's own header comment). Every operation below is called from the
  // browser (frontend/lib/api.ts's listTravelEvents/createTravelEvent/etc.).
  { path: "/travel-events", methods: ["GET", "POST"] },
  { path: "/travel-events/{event_id}", methods: ["GET", "PATCH", "DELETE"] },
];

export interface ExcludedOperation {
  readonly path: string;
  readonly method: ProxyMethod;
  readonly reason: string;
}

/**
 * Contract operations deliberately kept off the allowlist. Listing them is not bureaucracy: it is
 * what makes the allowlist a decision per operation rather than a restatement of the contract,
 * which would gate nothing.
 */
export const NOT_PROXIED: readonly ExcludedOperation[] = [
  {
    path: "/health",
    method: "GET",
    reason:
      "Render's liveness probe, not a browser surface. No screen in spec.md reads it, so proxying it would widen the boundary for nothing.",
  },
];

/**
 * Patterns for the `{param}` segments appearing in allowlisted templates.
 *
 * Anchored, and narrower than "any segment" on purpose. `trip_id` is `type: integer` in the
 * contract, so a digits-only pattern is both faithful and the thing that makes `..` or an encoded
 * slash structurally unable to reach the backend as a path — every other segment is matched
 * against a literal.
 *
 * The contract test asserts this table covers every parameter the contract declares.
 */
export const PARAM_PATTERNS: Readonly<Record<string, RegExp>> = {
  trip_id: /^[0-9]+$/,
  destination_id: /^[0-9]+$/,
  photo_id: /^[0-9]+$/,
  event_id: /^[0-9]+$/,
};

type SegmentMatcher = { readonly literal: string } | { readonly param: string; readonly pattern: RegExp };

interface CompiledRoute {
  readonly path: string;
  readonly methods: ReadonlySet<string>;
  readonly segments: readonly SegmentMatcher[];
}

function compile(entry: AllowlistEntry): CompiledRoute {
  const segments = entry.path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map<SegmentMatcher>((segment) => {
      const param = /^\{(.+)\}$/.exec(segment)?.[1];
      if (param === undefined) return { literal: segment };

      const pattern = PARAM_PATTERNS[param];
      if (pattern === undefined) {
        throw new Error(
          `No pattern for path parameter {${param}} in ${entry.path}. Add one to PARAM_PATTERNS — an unconstrained parameter is an unconstrained proxy.`,
        );
      }
      return { param, pattern };
    });

  return { path: entry.path, methods: new Set(entry.methods), segments };
}

const COMPILED: readonly CompiledRoute[] = PROXY_ALLOWLIST.map(compile);

function matches(route: CompiledRoute, segments: readonly string[]): boolean {
  if (route.segments.length !== segments.length) return false;

  return route.segments.every((matcher, index) => {
    const segment = segments[index];
    if (segment === undefined) return false;
    return "literal" in matcher ? matcher.literal === segment : matcher.pattern.test(segment);
  });
}

/**
 * Does this method and path pair cross the boundary?
 *
 * `segments` is the catch-all's `path` parameter — already URL-decoded and already split, which is
 * why nothing here re-parses a string. `method` is compared exactly: HTTP methods are
 * case-sensitive, and a lowercased `post` is a client we do not have.
 */
export function isAllowed(method: string, segments: readonly string[]): boolean {
  if (!(PROXY_METHODS as readonly string[]).includes(method)) return false;
  return COMPILED.some((route) => route.methods.has(method) && matches(route, segments));
}

/** The matching contract template, for logging and tests. Null when nothing matches. */
export function matchedRoute(method: string, segments: readonly string[]): string | null {
  const route = COMPILED.find((candidate) => candidate.methods.has(method) && matches(candidate, segments));
  return route?.path ?? null;
}
