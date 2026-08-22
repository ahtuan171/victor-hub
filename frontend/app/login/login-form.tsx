"use client";

import { useState, useSyncExternalStore } from "react";

import { ApiError, login } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Where a signed-in creator lands (SC-001's "landing screen").
 *
 * `/map` since 2026-08-22 — Content Calendar (`/calendar`) was removed entirely, the owner's
 * instruction, and the travel map is the product's primary surface now.
 */
const LANDING_PATH = "/map";

/**
 * The error region's id, referenced by both fields through `aria-describedby`.
 *
 * Next.js renders its own `role="alert"` route announcer into every page, so "the alert on this
 * page" is ambiguous to a screen reader and to a test locator alike. Tying the message to the
 * inputs it describes resolves both at once.
 */
const ERROR_ID = "login-error";

/**
 * Has React hydrated yet?
 *
 * **This exists because of a real credential leak, found at T072 against the deployed product.**
 * `handleSubmit` calls `preventDefault()` — but only once React has attached it. Before hydration
 * the submit button is a plain `type="submit"` inside a `<form>`, and a `<form>` with no `method`
 * defaults to **GET** against the current URL. So a tap in that window navigated to
 * `/login?email=...&password=...`, putting the creator's password in the address bar, in browser
 * history, and in the edge's access logs. That is constitution II violated by a default nobody
 * chose.
 *
 * `method="post"` on the form is the other half of the fix and the more important one, because it
 * holds even if this guard is ever removed: a pre-hydration submit then carries the credentials in
 * a request body rather than a query string. This guard stops the stray submit from happening at
 * all.
 *
 * **The window is not theoretical on this deployment.** T072 measured the cold document at ~44s
 * (Render's free tier spins down and Neon's auto-suspends, stacked), and hydration lands after
 * that — so a creator who types and taps during the first load of the day is *in* the window. It
 * fired on the very first automated attempt.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState`, for the reason `frontend/AGENTS.md`
 * gives about reading the browser clock: `getServerSnapshot` covers the server render *and* the
 * hydration pass, so there is no state set from an effect and no first paint with the wrong value.
 * All three callbacks are module scope — an inline arrow is a new identity every render, which is
 * the subscription form of the unstable-params bug.
 */
const subscribeToNothing = (): (() => void) => () => {};
const hydratedSnapshot = (): boolean => true;
const serverSnapshot = (): boolean => false;

/**
 * The sign-in form.
 *
 * Three things about this component follow from decisions taken at T022–T024, and each of them
 * looks like an omission if you do not know why:
 *
 *   1. **Success stores nothing.** `login()` resolves to `{expires_at}` and no token — the session
 *      cookie was already set by the proxy on that very response, and it is `httpOnly`, so there is
 *      nothing here that could read or keep it (research.md R-001). Navigate and stop.
 *   2. **This form renders its own error.** `lib/api.ts` redirects to `/login` on a 401 for every
 *      operation *except* `/auth/login` and `/auth/logout`, precisely so that a wrong password
 *      lands here as a thrown `ApiError` instead of silently reloading the page and discarding the
 *      message. If a bad password ever starts reloading this page, that exemption was removed —
 *      restore it rather than working around it here.
 *   3. **Navigation is a full page load, not `router.push`.** The T027 guard is a server component,
 *      and Next's Router Cache can replay a previously fetched RSC payload for `/calendar` — which,
 *      on the common "deep link → bounced to /login → sign in" path, is the *redirect back to
 *      login*. A soft navigation would bounce the creator straight back to this form with correct
 *      credentials and no error to show. `replace` rather than `assign` keeps `/login` out of
 *      history, since going back to it after signing in is never what was meant.
 */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useSyncExternalStore(subscribeToNothing, hydratedSnapshot, serverSnapshot);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      await login({ email, password });
      // Deliberately not clearing `pending`: the navigation below is asynchronous, and re-enabling
      // the button for the moment before the page swaps invites a second submit.
      window.location.replace(LANDING_PATH);
    } catch (caught) {
      // `ApiError.detail` is safe to render verbatim — the contract makes every error body
      // `{"detail": "<string>"}` and the backend flattens FastAPI's validation array into one, so
      // this never shows `[object Object]`. A network failure arrives here as status 0 carrying a
      // sentence of its own.
      setError(
        caught instanceof ApiError ? caught.detail : "Something went wrong. Please try again.",
      );
      setPending(false);
    }
  }

  /**
   * The layout is the stage-2 export's login surface (`design/content-calendar/`, panel `1l`):
   * identity in the upper field, and every control in a bottom-anchored panel.
   *
   * That split is the mobile-first rule rather than a style choice — at 375x667 it puts both fields
   * and the submit button in the bottom half, within one-handed thumb reach (constitution I,
   * design.md), which `tests/e2e/login.spec.ts` asserts rather than leaves to review. The spacer
   * `div` is what pushes the panel down; on wider screens the whole thing stays capped at `max-w-sm`
   * and centres horizontally, because desktop is an enhancement and not the design target.
   */
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      {/* Web-line geometry plus halftone grain. Purely decorative, so it is a background layer that
          cannot take focus or be read out. */}
      <div className="web-grain pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col">
        <div className="flex-1 px-6 pt-24">
          <div className="mb-2.5 flex items-center gap-2.5">
            {/* The brand mark: an original geometric diamond, not a licensed emblem. */}
            <span
              aria-hidden="true"
              className="bg-brand size-3 [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]"
            />
            <span className="text-ink-mid text-xs leading-none font-semibold tracking-[0.28em] uppercase">
              Victor Tracker
            </span>
          </div>

          <h1 className="font-display text-ink text-[34px] leading-[0.95] font-bold tracking-[0.03em] uppercase skew-x-[-5deg]">
            Victor
            <br />
            Tracker
          </h1>
        </div>

        <div className="border-hairline bg-surface-1 shadow-e2 border-t px-6 pt-6 pb-8">
          {/* Native validation is left on: `required` plus `type="email"` is free, localised, and
              already the behaviour a phone browser gives. The backend still validates.

              `method="post"` is load-bearing and must not be removed as redundant-looking. Nothing
              in this app ever performs a native submit *once hydrated* — `handleSubmit` calls
              `preventDefault()` — but a `<form>` with no `method` defaults to **GET**, so the one
              case that does submit natively (a tap before hydration) put the password in the query
              string. See `hydratedSnapshot` above; T072 found this against the deployed product. */}
          <form className="flex flex-col gap-3.5" method="post" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-[7px]">
              <Label
                htmlFor="email"
                className="text-ink-lo text-xs leading-none font-semibold tracking-[0.2em] uppercase"
              >
                Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                // Every one of these matters on a phone: the right keyboard, no capitalisation of an
                // address, and a password manager that recognises the pair.
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                // 50px, from the export. Every shadcn size variant is desktop-scaled — even `lg` is
                // 36px — which is below the minimum comfortable tap target, and the 44px floor is
                // asserted in the suite. `text-base` is kept from the primitive for a second reason
                // the export cannot express: iOS zooms the page in on focusing any input under 16px,
                // so the design's 15px body size is deliberately not applied to form fields.
                className="bg-void focus-ring h-[50px] rounded-sm text-base"
                aria-invalid={error !== null}
                aria-describedby={error !== null ? ERROR_ID : undefined}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
              />
            </div>

            <div className="flex flex-col gap-[7px]">
              <Label
                htmlFor="password"
                className="text-ink-lo text-xs leading-none font-semibold tracking-[0.2em] uppercase"
              >
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="bg-void focus-ring h-[50px] rounded-sm text-base"
                aria-invalid={error !== null}
                aria-describedby={error !== null ? ERROR_ID : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
              />
            </div>

            {/*
              `role="alert"` so the failure is announced rather than only drawn — a wrong password is
              the one thing this screen exists to communicate. Rendered only when set, so the layout
              does not reserve a gap for a message that is usually absent.

              This is the one place the brand red carries meaning rather than chrome, and it is
              allowed precisely because it is prose: the "red is never meaning" rule exists to keep
              *status* off the red, and no status cue appears on this screen.
            */}
            {error !== null && (
              <p id={ERROR_ID} role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="font-display focus-ring shadow-e1 mt-1 h-[52px] w-full rounded-none text-base font-semibold tracking-[0.18em] uppercase"
              // `!hydrated` disables the one tap that could submit this form natively. The label is
              // deliberately unchanged: the window is short, and a creator who sees "Sign in" go
              // briefly inactive on a cold load learns nothing useful from a different word.
              disabled={pending || !hydrated}
            >
              {pending ? "Signing in…" : "Sign in"}
            </Button>

            <p className="text-ink-lo mt-1 text-center text-xs">One account, one calendar.</p>
          </form>
        </div>
      </div>
    </main>
  );
}
