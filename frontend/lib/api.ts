/**
 * The typed API client (research.md R-007).
 *
 * Seven operations — login, logout, list, create, and the three by-id ones added at T051 for US3.
 * The eighth, `/health`, is Render's liveness probe and no screen reads it; `lib/proxy-allowlist.ts`
 * records that decision rather than leaving it implied.
 *
 * **The types below are hand-written from `specs/001-content-calendar/contracts/openapi.yaml`.**
 * This project installs no codegen tool: the contract has eight operations and four schemas, which
 * is smaller than the toolchain that would generate it. When the contract changes, this file is
 * edited by hand — `tests/client/api.spec.ts` asserts the enums still match the contract on disk,
 * so the two cannot drift silently.
 *
 * Three things about the transport, all decided at T021/T022 and none of them optional:
 *
 *   1. **Every request goes to `/api/...` on this origin.** The browser never speaks to the Render
 *      origin, so there is no base URL to configure and none should be added. The proxy at
 *      `app/api/[...path]/route.ts` attaches the credential server-side.
 *   2. **There is no token here, and nothing should look for one.** The JWT lives in an httpOnly
 *      cookie the browser's JavaScript cannot read (R-001), and the proxy strips `access_token`
 *      out of the login response before it reaches this code. `login()` returns `expires_at`
 *      alone, and that is the whole credential surface available to the client.
 *   3. **No `Authorization` header is set.** The cookie rides along on a same-origin request and
 *      the proxy turns it into a bearer. Setting one here would be setting a header we cannot
 *      read the value of.
 *
 * `lib/session.ts` must never be imported from this module or anything that reaches it: it reads
 * non-`NEXT_PUBLIC_` variables and a client bundle would get silent fallbacks.
 *
 * **003-travel-map (T009) adds every `/trips`, `/destinations`, `/locations` and per-destination
 * photograph operation from `specs/003-travel-map/contracts/openapi.yaml`** below the 002
 * operations above — a new, standalone resource space. Same rules: hand-written from the
 * contract, same transport, same 401 handling.
 */

/** Everything this client talks to. Same-origin by construction — see note 1 above. */
const API_PREFIX = "/api";

/** Where an expired session lands. Also the one route that must never redirect to itself. */
const LOGIN_PATH = "/login";

/**
 * The two operations whose 401 is **not** an expired session, so neither triggers the redirect.
 *
 * `/auth/login` — a 401 here is a wrong password. Redirecting to `/login` from `/login` would
 * discard the very message the form has to show, and look like the page silently reloading.
 * `/auth/logout` — a 401 here means the session was already over, which is where logout was going
 * anyway. Its caller owns the navigation; see `logout()`.
 */
const SESSION_LIFECYCLE_PATHS = ["/auth/login", "/auth/logout"] as const;

// --- Contract schemas -----------------------------------------------------------------------
// Written as `as const` arrays rather than TypeScript enums so the runtime values exist for the
// contract test to compare against openapi.yaml, and so a set of them is iterable for the UI.

/**
 * `Theme` in `specs/002-pixel-arcade-skin/contracts/openapi.yaml`. FR-010 — exactly two, `dark`
 * before any choice (FR-012). Declared here alongside the 001 enums above rather than in a second
 * file: one place for "the closed sets this client trusts", same reasoning as R-007's typed fetch
 * wrapper being enough without a second toolchain.
 */
export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * `Preferences` in `specs/002-pixel-arcade-skin/contracts/openapi.yaml` — both fields always
 * present, never omitted: they are `NOT NULL` with a default, so there is no absent state to
 * normalise on the way in.
 */
export interface Preferences {
  readonly theme: Theme;
  readonly sound_enabled: boolean;
}

/**
 * `PreferencesUpdate` — at least one key, per the contract's `minProperties: 1`, which TypeScript
 * has no way to express here (the backend answers 422 rather than treating an empty body as a
 * silent no-op). Neither field is nullable — clearing a theme or a sound choice has no meaning —
 * so there is no `| null` to keep apart from an omitted key.
 */
export interface PreferencesUpdate {
  readonly theme?: Theme;
  readonly sound_enabled?: boolean;
}

// --- 003-travel-map ---------------------------------------------------------------------------

/**
 * `DestinationStatus` in `specs/003-travel-map/contracts/openapi.yaml`. FR-002, FR-026 — drives a
 * map pin's fill. Free-form in every direction (FR-028): no value is reachable only from another
 * specific one.
 */
export const DESTINATION_STATUSES = ["visited", "planned", "wishlist"] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

/**
 * `TripStatus` in the same contract. FR-014 — descriptive only, drives no pin and nothing here
 * branches on its exact value beyond "a status exists".
 */
export const TRIP_STATUSES = [
  "wishlist",
  "planned",
  "booked",
  "upcoming",
  "traveling",
  "completed",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/**
 * `Trip` in the contract. `destination` and `notes` are Module 02 (Travel Schedule) additions —
 * built from `Module_02_Travel_Schedule_Spec.md` rather than a ratified `spec.md`, both nullable
 * so a Trip created before this iteration reads back with both null, not broken.
 */
export interface Trip {
  readonly id: number;
  readonly name: string;
  readonly destination: string | null;
  /** `YYYY-MM-DD`. Never hand this to `new Date` — see `lib/dates.ts`. */
  readonly start_date: string;
  readonly end_date: string;
  readonly status: TripStatus;
  readonly notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** `TripCreate` in the contract. `name`/`start_date`/`end_date` are required (FR-014). */
export interface TripCreate {
  readonly name: string;
  readonly destination?: string | null;
  readonly start_date: string;
  readonly end_date: string;
  readonly status?: TripStatus;
  readonly notes?: string | null;
}

/**
 * `TripUpdate` in the contract: every field optional. `name`/`start_date`/`end_date`/`status`
 * back `NOT NULL` columns (data-model.md) and have no null spelling — the backend refuses an
 * explicit `null` on any of those with a 422. `destination`/`notes` are the exception: both are
 * genuinely nullable columns, so either may be sent as `null` to clear it.
 */
export interface TripUpdate {
  readonly name?: string;
  readonly destination?: string | null;
  readonly start_date?: string;
  readonly end_date?: string;
  readonly status?: TripStatus;
  readonly notes?: string | null;
}

/**
 * `Destination` in the contract. `trip_id`/`start_date`/`end_date` are the contract's
 * optional-but-nullable trio — typed present-and-nullable here, with `toDestination` making that
 * true on the way in.
 */
export interface Destination {
  readonly id: number;
  readonly trip_id: number | null;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly status: DestinationStatus;
  readonly created_at: string;
  readonly updated_at: string;
  /**
   * FR-017. True when this Destination's own dates fall outside its Trip's — computed by the
   * backend on every response, never stored. Always `false` with no `trip_id` or with either of
   * this Destination's own dates null.
   */
  readonly outside_trip_range: boolean;
}

/**
 * `DestinationDetail` in the contract: `Destination` plus `note` and `photographs`, always both
 * present (FR-005) — `getDestination` is the only operation that returns this shape.
 */
export interface DestinationDetail extends Destination {
  readonly note: string | null;
  readonly photographs: readonly Photograph[];
}

/**
 * `DestinationCreate` in the contract. `name`/`latitude`/`longitude` are required — this call is
 * reached after `searchLocations` has already resolved a name to coordinates (FR-011); it does not
 * itself geocode. `trip_id` is optional (FR-020).
 */
export interface DestinationCreate {
  readonly trip_id?: number | null;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly start_date?: string | null;
  readonly end_date?: string | null;
  readonly status?: DestinationStatus;
  readonly note?: string | null;
}

/**
 * `DestinationUpdate` in the contract — a **mixed** null-spelling rule. `trip_id` (FR-020's
 * detach), `start_date`, `end_date` and `note` may be sent as explicit `null` to clear them;
 * `name`, `latitude`, `longitude` and `status` back `NOT NULL` columns and have no null spelling —
 * the backend refuses one with a 422.
 */
export interface DestinationUpdate {
  readonly trip_id?: number | null;
  readonly name?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly start_date?: string | null;
  readonly end_date?: string | null;
  readonly status?: DestinationStatus;
  readonly note?: string | null;
}

/** Query parameters on `GET /destinations`. */
export interface ListDestinationsParams {
  /** Narrow to one Trip's Destinations (User Story 3). */
  readonly trip_id?: number;
  /** FR-010's map filter. */
  readonly status?: DestinationStatus;
}

/** `Photograph` in the contract. `url` is a presigned GET, minted fresh on every response. */
export interface Photograph {
  readonly id: number;
  readonly url: string;
  readonly created_at: string;
}

/**
 * `PhotographCreate` in the contract. Sent after the browser has already `PUT` the image bytes to
 * the presigned URL from `createPhotoUploadUrl` — never image bytes here, only the key that upload
 * already used (FR-023, FR-025).
 */
export interface PhotographCreate {
  readonly object_key: string;
}

/**
 * `PhotoUploadUrl` in the contract. `upload_url` is a presigned `PUT` the browser uploads directly
 * to R2 — this product's own backend never receives the image bytes.
 */
export interface PhotoUploadUrl {
  readonly upload_url: string;
  readonly object_key: string;
  readonly expires_at: string;
}

/** `LocationCandidate` in the contract — one geocoding match from `searchLocations`. */
export interface LocationCandidate {
  readonly name: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
}

// --- Module 02 (Travel Schedule) -------------------------------------------------------------
//
// Built from `Module_02_Travel_Schedule_Spec.md` rather than a ratified `spec.md` — see the
// owner's explicit instruction recorded in this iteration's history to bypass the speckit
// workflow for this module.

/**
 * `TravelEventType` in `app/models.py`. The five kinds of dated entry a Trip carries (§8/§15).
 * Deliberately excludes `trip`: a Trip is its own resource with its own date range, and the
 * calendar's `◆` marker is drawn from that range directly — see `lib/schedule.ts`.
 */
export const TRAVEL_EVENT_TYPES = ["transport", "stay", "activity", "food", "note"] as const;
export type TravelEventType = (typeof TRAVEL_EVENT_TYPES)[number];

/**
 * `TravelEvent` in `app/schemas.py`'s `TravelEventRead`. The type-specific fields are a fixed
 * set of nullable columns rather than a JSON blob (§14 — transport uses `from_location`/
 * `to_location`, stay/transport use `booking_reference`, activity uses `category`, and so on);
 * which fields a given `event_type` actually uses is a form-layer concern, not something this
 * type enforces.
 */
export interface TravelEvent {
  readonly id: number;
  readonly trip_id: number | null;
  readonly event_type: TravelEventType;
  readonly title: string;
  /** `YYYY-MM-DD`. Never hand this to `new Date` — see `lib/dates.ts`. */
  readonly event_date: string;
  /** `HH:MM:SS`, advisory display only — no timezone, no ordering derived from it. */
  readonly start_time: string | null;
  readonly location: string | null;
  readonly from_location: string | null;
  readonly to_location: string | null;
  readonly booking_reference: string | null;
  readonly category: string | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** `TravelEventCreate`. `event_type`/`title`/`event_date` are required; everything else optional. */
export interface TravelEventCreate {
  readonly trip_id?: number | null;
  readonly event_type: TravelEventType;
  readonly title: string;
  readonly event_date: string;
  readonly start_time?: string | null;
  readonly location?: string | null;
  readonly from_location?: string | null;
  readonly to_location?: string | null;
  readonly booking_reference?: string | null;
  readonly category?: string | null;
  readonly notes?: string | null;
}

/**
 * `TravelEventUpdate`: every field optional and every field nullable — unlike `TripUpdate`,
 * `travel_event` has no `NOT NULL` column beyond `event_type`/`title`/`event_date`, and the
 * backend's `TravelEventUpdate` places no "no null spelling" restriction on any of them.
 */
export interface TravelEventUpdate {
  readonly trip_id?: number | null;
  readonly event_type?: TravelEventType;
  readonly title?: string;
  readonly event_date?: string;
  readonly start_time?: string | null;
  readonly location?: string | null;
  readonly from_location?: string | null;
  readonly to_location?: string | null;
  readonly booking_reference?: string | null;
  readonly category?: string | null;
  readonly notes?: string | null;
}

/** Query parameters on `GET /travel-events`. */
export interface ListTravelEventsParams {
  readonly trip_id?: number;
  readonly event_type?: TravelEventType;
  /** Inclusive lower bound on `event_date`. */
  readonly date_from?: string;
  /** Inclusive upper bound on `event_date`. */
  readonly date_to?: string;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

/**
 * What login returns **through the proxy** — which is not what the contract's `/auth/login`
 * returns, and the difference is deliberate.
 *
 * FastAPI answers with `{access_token, token_type, expires_at}`. The proxy captures the token into
 * the httpOnly cookie and forwards `expires_at` alone, because handing a 30-day credential to
 * browser JavaScript would undo the whole of R-001. The contract still describes the FastAPI
 * origin truthfully; this type describes the Vercel origin, which is deliberately not transparent
 * about credentials.
 */
export interface LoginResult {
  /** ISO 8601 timestamp, roughly 30 days out (FR-002a). A string — do not parse it into a Date. */
  readonly expires_at: string;
}

// --- Errors ---------------------------------------------------------------------------------

/**
 * Any non-2xx response.
 *
 * `detail` is safe to show verbatim: the contract makes every error body `{"detail": "<string>"}`
 * and the backend installs a handler that flattens FastAPI's validation array into one, so this
 * never renders `[object Object]`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

// --- Operations -----------------------------------------------------------------------------

/**
 * Exchange credentials for a session.
 *
 * On success the session cookie has already been set by the proxy on this response — there is
 * nothing for the caller to store. Navigate; do not try to persist anything.
 */
export function login(credentials: LoginRequest): Promise<LoginResult> {
  return request<LoginResult>("POST", "/auth/login", { body: credentials });
}

/**
 * End the session.
 *
 * The cookie is cleared by the proxy on the way back, and it clears it on a 401 too — so this
 * resolves rather than throwing when the token has already expired, which is what makes sign-out
 * work from a dead session (SC-006).
 */
export async function logout(): Promise<void> {
  try {
    await request<void>("POST", "/auth/logout");
  } catch (error) {
    // The one swallowed error in this client, and only this one: a 401 here means the credential
    // was already finished, which is the state logout is trying to reach. The proxy has cleared
    // the cookie either way, so the caller's next step — navigate to /login — is correct.
    if (error instanceof ApiError && error.status === 401) return;
    throw error;
  }
}

/**
 * Read the account's own presentation and sound choices (002 US3/US4).
 *
 * **No happy-path caller needs this on first paint** — `app/layout.tsx` reads the `ch_theme` cookie
 * server-side for that (research.md R-002), specifically so the first document does not wait on a
 * round trip. This exists for the mount-time reconciliation step R-002 also asks for: read the
 * account's value once after the app is up, and if it disagrees with the cookie, the account wins.
 */
export function getPreferences(): Promise<Preferences> {
  return request<Preferences>("GET", "/preferences");
}

/**
 * Change one or both choices. Returns the **full** object, not the diff — a caller never has to
 * reconstruct the new state from what it sent.
 */
export function updatePreferences(changes: PreferencesUpdate): Promise<Preferences> {
  return request<Preferences>("PATCH", "/preferences", { body: changes });
}

// --- 003-travel-map ---------------------------------------------------------------------------

/** List every Trip. No pagination — a personal number of trips is the only volume (FR-014). */
export function listTrips(): Promise<Trip[]> {
  return request<Trip[]>("GET", "/trips");
}

/** Create a Trip. `status` defaults to `wishlist` when omitted. */
export function createTrip(trip: TripCreate): Promise<Trip> {
  return request<Trip>("POST", "/trips", { body: trip });
}

/** Read one Trip. Throws `ApiError` with `status === 404` for an id that does not exist. */
export function getTrip(id: number): Promise<Trip> {
  return request<Trip>("GET", `/trips/${id}`);
}

/** Change one or more fields of a Trip (FR-016). */
export function updateTrip(id: number, changes: TripUpdate): Promise<Trip> {
  return request<Trip>("PATCH", `/trips/${id}`, { body: changes });
}

/**
 * Delete a Trip and every Destination that belongs to it (FR-018, `ON DELETE CASCADE`). The
 * confirmation naming what will be lost happens before this call — the API performs the delete
 * unconditionally once called.
 */
export async function deleteTrip(id: number): Promise<void> {
  await request<void>("DELETE", `/trips/${id}`);
}

// --- Module 02 (Travel Schedule) -------------------------------------------------------------

/**
 * List TravelEvents, optionally narrowed by Trip, type, or date range. No pagination — the same
 * personal-volume reasoning `listTrips` states.
 */
export function listTravelEvents(params: ListTravelEventsParams = {}): Promise<TravelEvent[]> {
  return request<TravelEvent[]>("GET", `/travel-events${travelEventsQueryString(params)}`);
}

/** Create a TravelEvent. `trip_id` is optional — an event may exist unattached to any Trip. */
export function createTravelEvent(event: TravelEventCreate): Promise<TravelEvent> {
  return request<TravelEvent>("POST", "/travel-events", { body: event });
}

/** Read one TravelEvent. Throws `ApiError` with `status === 404` for an id that does not exist. */
export function getTravelEvent(id: number): Promise<TravelEvent> {
  return request<TravelEvent>("GET", `/travel-events/${id}`);
}

/** Change one or more fields of a TravelEvent. */
export function updateTravelEvent(id: number, changes: TravelEventUpdate): Promise<TravelEvent> {
  return request<TravelEvent>("PATCH", `/travel-events/${id}`, { body: changes });
}

/** Delete a TravelEvent. */
export async function deleteTravelEvent(id: number): Promise<void> {
  await request<void>("DELETE", `/travel-events/${id}`);
}

/** `?trip_id=1&event_type=note&date_from=...` for the parameters that are set. */
function travelEventsQueryString(params: ListTravelEventsParams): string {
  const search = new URLSearchParams();
  if (params.trip_id !== undefined) search.set("trip_id", String(params.trip_id));
  if (params.event_type !== undefined) search.set("event_type", params.event_type);
  if (params.date_from !== undefined) search.set("date_from", params.date_from);
  if (params.date_to !== undefined) search.set("date_to", params.date_to);
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * List Destinations, optionally narrowed by Trip or status. With no parameters, returns every
 * Destination regardless of Trip membership — the map's own read (FR-001, FR-019).
 */
export async function listDestinations(
  params: ListDestinationsParams = {},
): Promise<Destination[]> {
  const rows = await request<unknown[]>("GET", `/destinations${destinationsQueryString(params)}`);
  return rows.map(toDestination);
}

/**
 * Create a Destination. `latitude`/`longitude` must already be resolved (FR-011) — this call does
 * not itself geocode a free-text name; see `searchLocations`.
 */
export async function createDestination(destination: DestinationCreate): Promise<Destination> {
  return toDestination(await request<unknown>("POST", "/destinations", { body: destination }));
}

/**
 * Read one Destination, with its note and photograph URLs. Always includes both regardless of
 * `status` (FR-005) — each photograph's `url` is a presigned GET minted fresh on this call
 * (FR-024), never a stored or cached link.
 */
export async function getDestination(id: number): Promise<DestinationDetail> {
  return toDestinationDetail(await request<unknown>("GET", `/destinations/${id}`));
}

/**
 * Change one or more fields of a Destination (FR-016, FR-006, FR-028). Changing `name` does not
 * re-geocode — a location change is a new `searchLocations` call followed by sending the new
 * `latitude`/`longitude` here explicitly.
 */
export async function updateDestination(
  id: number,
  changes: DestinationUpdate,
): Promise<Destination> {
  return toDestination(
    await request<unknown>("PATCH", `/destinations/${id}`, { body: changes }),
  );
}

/** Delete a Destination and its photographs (FR-016, cascades). Does not touch its Trip. */
export async function deleteDestination(id: number): Promise<void> {
  await request<void>("DELETE", `/destinations/${id}`);
}

/**
 * Resolve a typed place name to zero or more candidate coordinates (FR-011, FR-012). Zero results
 * is a resolved empty array, not a thrown error — "no matches" is an ordinary outcome. A `502`
 * (Nominatim unreachable) still throws `ApiError`, which the caller renders as "search failed,
 * retry", never as an empty result set.
 */
export function searchLocations(query: string): Promise<LocationCandidate[]> {
  return request<LocationCandidate[]>(
    "GET",
    `/locations/search?q=${encodeURIComponent(query)}`,
  );
}

/**
 * Mint a short-lived presigned URL for uploading one photograph (FR-023). The caller `PUT`s image
 * bytes to `upload_url` **directly against R2** — never through this product's own backend — then
 * calls `createPhotograph` with the returned `object_key` to confirm.
 */
export function createPhotoUploadUrl(destinationId: number): Promise<PhotoUploadUrl> {
  return request<PhotoUploadUrl>("POST", `/destinations/${destinationId}/photos/upload-url`);
}

/**
 * Confirm a photograph upload and record it against a Destination (FR-023, FR-025). Called after
 * the browser's own direct `PUT` to R2 has already finished — this never carries image bytes.
 */
export function createPhotograph(
  destinationId: number,
  photo: PhotographCreate,
): Promise<Photograph> {
  return request<Photograph>("POST", `/destinations/${destinationId}/photos`, { body: photo });
}

/** Remove one photograph from a Destination. Deletes the database row, not the R2 object. */
export async function deletePhotograph(destinationId: number, photoId: number): Promise<void> {
  await request<void>("DELETE", `/destinations/${destinationId}/photos/${photoId}`);
}

// --- Transport ------------------------------------------------------------------------------

interface RequestOptions {
  readonly body?: unknown;
}

/**
 * The one place a request is made and the one place a failure becomes an `ApiError`.
 *
 * Single by design: the 401 redirect below (T024) is the reason. Do not grow a second fetch path —
 * a surface that bypasses this one also bypasses the session handling, and nothing will say so.
 */
async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      // The session cookie rides on this. `same-origin` is already fetch's default; stating it
      // means a future edit has to delete a line rather than forget one.
      credentials: "same-origin",
      // The proxy is `force-dynamic`, but a browser or bfcache replay of a list response would
      // still show one creator's stale data after an edit.
      cache: "no-store",
    });
  } catch {
    // A network failure, not an HTTP one — offline, or the proxy unreachable. Given a status so
    // callers have one error type to handle rather than two.
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    if (response.status === 401) redirectToLogin(path);
    throw await toApiError(response);
  }

  // 204 is the contract's answer for logout and delete. `.json()` on an empty body throws, and
  // the caller's `Promise<void>` has nothing to receive anyway.
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/**
 * The single 401 handler (T024, spec Edge Cases, FR-002, SC-006).
 *
 * A 401 on any content operation means the session ended underneath an open page — the token
 * expired, or it was signed out from another device. FR-002 says an unauthenticated visitor sees no
 * content at any address, and a page that stays put showing yesterday's calendar while its requests
 * quietly fail is exactly that violation, just slower.
 *
 * **Clearing the cookie is not part of this.** T024 originally owned that too; T022 moved it,
 * because an `httpOnly` cookie is by design unreachable from browser JavaScript (research.md R-001).
 * The proxy clears it on *every* 401, which is the only place that can. Do not add a cookie write
 * here — it would be a no-op that reads like a safeguard.
 *
 * Four conditions, each of which has a way of biting if dropped:
 *
 *   1. **Browser only.** `window` is absent in the Playwright runner and in any server context. A
 *      bare `window.location` would turn an expected 401 into a `ReferenceError`.
 *   2. **Not the session-lifecycle endpoints.** See `SESSION_LIFECYCLE_PATHS`.
 *   3. **Not when already on `/login`.** The login page's own failed request must not reload it.
 *   4. **A full navigation, not a router push.** The session guard at T027 is a server component,
 *      and App Router layouts are not re-executed on soft navigations — a client-side push could
 *      land on `/login` without the server ever re-reading the cookie. `lib/api.ts` is also not a
 *      React module, so there is no router to reach for.
 *
 * `replace` rather than `assign`: the page that just 401'd must not sit in history, because going
 * back to it would 401 again and bounce the creator straight back here.
 *
 * The caller still receives the thrown `ApiError`. Navigation is not instantaneous, so a surface
 * that swallowed the error would keep rendering for a beat — every caller should still handle it.
 */
function redirectToLogin(path: string): void {
  if (typeof window === "undefined") return;
  if (SESSION_LIFECYCLE_PATHS.some((exempt) => path.startsWith(exempt))) return;
  if (window.location.pathname === LOGIN_PATH) return;

  window.location.replace(LOGIN_PATH);
}

/**
 * Read an error body without trusting it to be the shape the contract promises.
 *
 * A 502 from the proxy's own failure path, or an upstream that returns HTML, must still produce a
 * sentence a human can read rather than a parse exception thrown from a catch block.
 */
async function toApiError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);

  const detail =
    isRecord(body) && typeof body["detail"] === "string" && body["detail"].length > 0
      ? body["detail"]
      : `Request failed with status ${response.status}.`;

  return new ApiError(response.status, detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fill `Destination`'s optional-but-nullable trio so the type is true as declared.
 */
function toDestination(value: unknown): Destination {
  const row = value as Destination & Partial<Record<keyof Destination, unknown>>;

  return {
    ...row,
    trip_id: row.trip_id ?? null,
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
  };
}

/** `toDestination`, plus `DestinationDetail`'s own `note`/`photographs` pair. */
function toDestinationDetail(value: unknown): DestinationDetail {
  const detail = value as DestinationDetail & Partial<Record<keyof DestinationDetail, unknown>>;

  return {
    ...toDestination(detail),
    note: detail.note ?? null,
    photographs: detail.photographs ?? [],
  };
}

/** `?trip_id=1&status=visited` for the parameters that are set, empty string when none are. */
function destinationsQueryString(params: ListDestinationsParams): string {
  const search = new URLSearchParams();

  if (params.trip_id !== undefined) search.set("trip_id", String(params.trip_id));
  if (params.status !== undefined) search.set("status", params.status);

  const query = search.toString();
  return query === "" ? "" : `?${query}`;
}
