"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { logout, updatePreferences, type Theme } from "@/lib/api";
import { isSoundEnabled, isSoundEnabledOnServer, setSoundEnabled, subscribeSoundEnabled } from "@/lib/sound";
import { applyTheme, readThemeCookie, writeThemeCookie } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The one place navigation and settings live (T029–T030, FR-015, FR-016, FR-017).
 *
 * Built as its own overlay rather than folding into `BacklogDrawer`, because FR-019 requires this to
 * sit **above** that drawer without either trapping the person or cancelling the other. The two are
 * independent pieces of state (this component owns its own `open`), each with its own scrim, and —
 * like the backlog's own expanded panel — neither is a focus trap. A trap here would fight
 * `CaptureSheet`: FR-018 requires dismissing this drawer to leave a capture in progress exactly as it
 * was, and a trap would have first pulled focus away from it.
 *
 * ## What lives here, and when
 *
 * FR-015 requires one place that lists every screen the product has. It grew a second entry at
 * 003-travel-map T018: both `Content Calendar` and `Travel Map` are now real links, each marked
 * `aria-current="page"` on the surface it points to, via Next's own `usePathname()` — unlike this
 * file's cookie and sound-flag reads below, that hook needs no `useSyncExternalStore` wrapper: the
 * server render already knows the actual requested URL, so there is no hydration mismatch for it
 * to prevent. FR-016 also puts the presentation choice and the sound choice here — **not yet**:
 * the theme control lands at T034, the sound control at T040, each its own task so this drawer is
 * never wired to a control that does not work yet.
 *
 * **Sign-out moved in at T030**, self-contained here rather than threaded down as a prop from
 * `CalendarShell` — the same reason this component takes no props at all: every screen that will ever
 * mount `NavDrawer` gets a working sign-out for free, with nothing for a future screen to wire up.
 * The behaviour is carried over unchanged from T077's header control: `logout()` already swallows a
 * 401 (the session was already over, which is where sign-out was going), so anything reaching the
 * `catch` below is a session that is still genuinely open, and only the proxy can clear that httpOnly
 * cookie — so a refused sign-out leaves the creator here, on the calendar, told why, rather than
 * bounced to `/login` with a session that never actually ended.
 *
 * **FR-017 ("further from the resting position of a thumb than the actions used frequently")**: two
 * taps deep now rather than one — open the drawer, then sign out — where the header control was a
 * single tap. It sits in a footer **below** the screen list, the drawer's own "far end", rather than
 * beside it.
 *
 * ## Slides from the side, not the bottom
 *
 * Every other overlay in the product — `CaptureSheet`, `ItemSheet`, `DeleteConfirm`, the backlog's own
 * expanded panel — rises from the bottom, because each is about the content underneath it. This one is
 * not about any item or day; it is the product's one navigation surface, so a different edge keeps it
 * from reading as a fifth content sheet.
 *
 * ## It has to out-rank `z-50`, not just the backlog's `z-10`/`z-20`
 *
 * `CaptureSheet`, `ItemSheet` and `DeleteConfirm` all share the shadcn `Sheet`/`AlertDialog`
 * primitives, whose backdrop and content both sit at `z-50` — and, being portalled to `document.body`
 * with `position: fixed`, that backdrop paints over the *entire* viewport, including this drawer's own
 * trigger sitting quietly in the header at no explicit stacking level at all. T031's FR-018 scenario
 * ("dismissing the nav drawer over an open capture sheet keeps the typed text") is not just a state
 * assertion — it requires the trigger to still be **reachable** while that backdrop is up, which a
 * `z-40` panel cannot do against a `z-50` one. `z-[60]`/`z-[70]`/`z-[80]` below are deliberately past
 * every sheet in the product, not merely past the one non-modal overlay (the backlog drawer) T029's
 * task line names.
 *
 * ## The presentation control (T034, research.md R-002)
 *
 * `theme` below is **not** the value `app/layout.tsx` rendered `<html>` with — it is only this
 * button's own "which option is selected" indicator, read from the `ch_theme` cookie via
 * `useSyncExternalStore` (the same pattern `CalendarShell` uses for the browser's clock: a server
 * snapshot of `"dark"` avoids a hydration mismatch, since the server cannot read a cookie value into
 * a client hook). A tap on either option applies the class and rewrites the cookie **synchronously**
 * — R-002's "the visible result never waits for the request" — then fires `PATCH /preferences`
 * without being awaited first. The request's outcome does not gate the UI at all: a failure is logged
 * and nothing more, because the cookie this device now shows is already correct for this device, and
 * R-002's own accepted weakness is that a *different* device corrects on its own next load rather than
 * live.
 *
 * ## The sound control (T040, FR-020–FR-022)
 *
 * Same shape as the presentation control — a two-option toggle, applied locally and immediately, a
 * `PATCH /preferences` fired unawaited — but reading its **current** value works differently, because
 * there is no cookie to read it from (FR-022 gives sound no first-paint obligation, so `lib/sound.ts`
 * keeps no cookie the way `lib/theme.ts` does). Instead `lib/sound.ts` is the one module that ever
 * writes its own `enabled` flag, so it can offer a real subscription rather than the
 * `subscribeToNothing` no-op the theme read above uses — `useSyncExternalStore` re-renders this
 * control the moment `CalendarShell`'s mount-time reconciliation (or a tap here) changes it, with no
 * polling and no prop threaded down from the shell that loaded the account's preference in the first
 * place.
 */
export function NavDrawer() {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  /**
   * The cookie's own value, read once per mount via the R-006-addendum pattern (`getServerSnapshot`
   * returns a value rather than null here, unlike `CalendarShell`'s `today`, because "dark" — FR-012's
   * default — is always a *correct* guess for the server render, never a wrong-but-plausible one).
   */
  const cookieTheme = useSyncExternalStore(subscribeToNothing, readTheme, readServerTheme);
  /** Set the instant a tap picks a theme, so the button reflects it before any request resolves. */
  const [pickedTheme, setPickedTheme] = useState<Theme | null>(null);
  const theme = pickedTheme ?? cookieTheme;

  function selectTheme(next: Theme): void {
    if (next === theme) return;
    setPickedTheme(next);
    applyTheme(next);
    writeThemeCookie(next);
    void updatePreferences({ theme: next }).catch((error: unknown) => {
      // Fire-and-forget, deliberately: see the docstring's "presentation control" section for why
      // this device does not wait on, or roll back for, the request's outcome.
      console.error("[theme] failed to save the account's preference", error);
    });
  }

  /**
   * The sound control's own current value (T040) — `lib/sound.ts`'s cached `enabled`, real
   * subscription and all, unlike the theme's cookie read above. See the docstring's "sound control"
   * section for why the two mechanisms differ.
   */
  const soundEnabled = useSyncExternalStore(subscribeSoundEnabled, isSoundEnabled, isSoundEnabledOnServer);

  function selectSound(next: boolean): void {
    if (next === soundEnabled) return;
    // Applied immediately (T040, "off is immediate") — the same rule the theme control follows, and
    // for the same reason: the request's outcome does not gate what this device already shows.
    setSoundEnabled(next);
    void updatePreferences({ sound_enabled: next }).catch((error: unknown) => {
      console.error("[sound] failed to save the account's preference", error);
    });
  }

  /**
   * Set only when sign-out is refused, and it keeps the creator here — carried over verbatim from
   * T077's header control, only the surface it renders in has moved.
   */
  const [signOutError, setSignOutError] = useState<string | null>(null);
  /** Disables the control for the moment before the page swaps, as `login-form.tsx` does on submit. */
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!open) return;

    // Escape closes, same as the backlog's own expanded panel — cheap, and the alternative is an
    // overlay a keyboard user can only leave by tabbing all the way to the close button.
    //
    // **Capture phase, plus `stopPropagation` (T044 hand-walk, FR-018).** `CaptureSheet`/`ItemSheet`/
    // `DeleteConfirm` are `@base-ui/react` Dialogs, each arming its own document-level Escape
    // listener the moment it opens — and this drawer is deliberately *not* one of those (see this
    // file's own header comment on why it must not be a focus trap), so nothing here is "on top" of
    // that listener the way z-index puts this panel on top visually. A same-phase (bubble) listener
    // registered later does not run first; it runs in *registration order*, which put the sheet's own
    // handler first every time — Escape closed the sheet before this handler ever ran, discarding a
    // capture in progress in exactly the case FR-018 exists to prevent. Capture phase runs before any
    // bubble-phase listener regardless of registration order, so intercepting here and stopping
    // propagation is what keeps the sheet untouched.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open]);

  async function signOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);

    try {
      await logout();
    } catch {
      setSignOutError("Could not sign you out. Your session is still open — try again.");
      setSigningOut(false);
      return;
    }

    // `window.location.replace`, never a router push: the `(app)` guard is a server component and
    // App Router layouts are not re-executed on soft navigations, so a client-side push could land
    // on `/login` with the server never re-reading the now-cleared cookie. `replace` also keeps the
    // signed-in page out of history, where going back would only bounce off the guard.
    window.location.replace("/login");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        // `relative z-[60]`: stays in the header's normal flow (unlike the fixed panel/scrim below)
        // but still out-ranks any `z-50` sheet backdrop that would otherwise cover it — see the
        // docstring's "It has to out-rank z-50" section.
        className="border-hairline bg-surface-2 text-ink-mid focus-ring relative z-[60] h-11 flex-none rounded-sm border px-2.5 text-xs font-semibold tracking-[0.14em] whitespace-nowrap uppercase"
        data-testid="nav-drawer-trigger"
      >
        {/* T053 (comic-tech brief §12, "[ + ] MENU"): personality on the trigger text only —
            the control's size, position and every other behaviour are unchanged. */}
        [ + ] Menu
      </button>

      {open ? (
        <>
          {/*
           * Its own scrim, stacked above the backlog drawer's (`z-10`/`z-20`) **and** above any open
           * sheet's (`z-50`) — FR-019 forbids either overlay cancelling the other, and a shared scrim
           * click would have to guess which one a tap meant.
           */}
          <div
            className="fixed inset-0 z-[70] bg-black/40"
            aria-hidden="true"
            onClick={() => setOpen(false)}
            data-testid="nav-drawer-scrim"
          />

          <nav
            id={panelId}
            aria-label="Navigation and settings"
            // T053 (comic-tech brief §12, "border/offset layer nhẹ"): the panel's one edge — where it
            // meets the rest of the screen — carries the brand red rather than the neutral hairline,
            // 2px rather than 1px. `shadow-e2` already gives the panel its elevation; this is the
            // colour half of the treatment, not a second shadow layered on top of it.
            className="bg-surface-1 fixed inset-y-0 right-0 z-[80] flex w-[260px] max-w-[80vw] flex-col border-l-2 border-l-brand shadow-e2"
            data-testid="nav-drawer-panel"
          >
            <header className="border-hairline flex items-center justify-between gap-2 border-b px-4 pt-5 pb-3">
              <span className="text-ink text-xs leading-none font-semibold tracking-[0.18em] uppercase">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="border-hairline bg-surface-2 text-ink-mid focus-ring h-11 flex-none rounded-sm border px-2.5 text-xs font-semibold tracking-[0.14em] uppercase"
                data-testid="nav-drawer-close"
              >
                Close
              </button>
            </header>

            {/*
             * FR-015's screen list. Real links as of 003-travel-map T018 — the first time this
             * product has had somewhere else to go, so a link now has somewhere to go and a
             * button that went nowhere (`Frame.tsx`'s own rule) is no longer the right shape.
             * Both entries share one style; only `aria-current` (and, visually, the surface
             * token) distinguishes the one matching `pathname`.
             */}
            <ul className="flex-1 space-y-2 overflow-y-auto p-4" data-testid="nav-drawer-screens">
              {SCREENS.map((screen) => {
                const current = pathname === screen.href;
                return (
                  <li key={screen.href}>
                    <Link
                      href={screen.href}
                      aria-current={current ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "focus-ring flex h-11 items-center rounded-sm border px-3 text-sm font-semibold",
                        current
                          ? "border-hairline bg-surface-2 text-ink"
                          : "border-hairline bg-surface-1 text-ink-mid",
                      )}
                      data-testid={`nav-drawer-screen-${screen.slug}`}
                    >
                      {screen.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/*
             * The presentation control (T034, FR-016, SC-005). A two-option toggle group, the same
             * visual language `PeriodNav`'s MONTH/WEEK control already uses, rather than a single
             * button that flips — the current choice should be legible without tapping to find out.
             */}
            <div className="border-hairline border-t p-4">
              <p className="text-ink-mid mb-2 text-xs leading-none font-semibold tracking-[0.18em] uppercase">
                Presentation
              </p>
              <div
                role="radiogroup"
                aria-label="Presentation"
                className="border-hairline flex overflow-hidden rounded-sm border"
              >
                {THEME_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={theme === value}
                    onClick={() => selectTheme(value)}
                    className={cn(
                      "focus-ring-inset h-11 flex-1 text-xs font-semibold tracking-[0.1em] uppercase",
                      theme === value ? "bg-brand text-white" : "bg-surface-2 text-ink-mid",
                    )}
                    data-testid={`theme-option-${value}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/*
             * The sound control (T040, FR-016, FR-020–FR-022). Same visual language as Presentation
             * above — a two-option toggle group rather than a single flipping button, so the current
             * choice is legible without tapping to find out.
             */}
            <div className="border-hairline border-t p-4">
              <p className="text-ink-mid mb-2 text-xs leading-none font-semibold tracking-[0.18em] uppercase">
                Sound
              </p>
              <div
                role="radiogroup"
                aria-label="Sound"
                className="border-hairline flex overflow-hidden rounded-sm border"
              >
                {SOUND_OPTIONS.map(({ value, label }) => (
                  <button
                    key={String(value)}
                    type="button"
                    role="radio"
                    aria-checked={soundEnabled === value}
                    onClick={() => selectSound(value)}
                    className={cn(
                      "focus-ring-inset h-11 flex-1 text-xs font-semibold tracking-[0.1em] uppercase",
                      soundEnabled === value ? "bg-brand text-white" : "bg-surface-2 text-ink-mid",
                    )}
                    data-testid={`sound-option-${label.toLowerCase()}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/*
             * The drawer's far end (T030, FR-017) — a footer below the flex-1 screen list, so it sits
             * at the bottom of the panel whatever that list's length, separated from it by its own
             * rule rather than sitting in the same block.
             */}
            <div className="border-hairline border-t p-4">
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
                className="border-hairline bg-surface-2 text-ink-mid focus-ring h-11 w-full flex-none rounded-sm border text-xs font-semibold tracking-[0.14em] whitespace-nowrap uppercase disabled:opacity-40"
                data-testid="sign-out-action"
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>

              {signOutError === null ? null : (
                <p
                  role="alert"
                  className="text-danger-hi mt-2 text-xs leading-relaxed"
                  data-testid="sign-out-message"
                >
                  {signOutError}
                </p>
              )}
            </div>
          </nav>
        </>
      ) : null}
    </>
  );
}

/**
 * FR-015's screen list, in the order they were built. Content Calendar first — it is this
 * product's original surface and the one a returning creator expects at the top.
 */
const SCREENS: ReadonlyArray<{ readonly href: string; readonly slug: string; readonly label: string }> = [
  { href: "/map", slug: "map", label: "Travel Map" },
  // Module 02 (Travel Schedule), added the same way `/map` was at 003-travel-map T018 — see
  // `Module_02_Travel_Schedule_Spec.md`. `/calendar` (Content Calendar) removed from this list at
  // the owner's request rather than deleted outright — the route, its component tree and its
  // whole test suite are untouched, only the link here is gone.
  { href: "/schedule", slug: "schedule", label: "Travel Schedule" },
  // Module 03 (Travel Intelligence) — added outside this session by the owner. `/intel` does not
  // exist on `main` yet (it is on the local-only branch `spike/module-02-03-prototype-2026-08-21`),
  // so this link 404s for real until that surface is actually built here. Left as-is rather than
  // removed, since it was not this session's change to make silently.
  { href: "/intel", slug: "intel", label: "Travel Intelligence" },
];

/** The two options, in the order the toggle group draws them. Dark first — it is FR-012's default. */
const THEME_OPTIONS: ReadonlyArray<{ readonly value: Theme; readonly label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

/** Off first — it is FR-020's default, matching `THEME_OPTIONS`' own default-first ordering. */
const SOUND_OPTIONS: ReadonlyArray<{ readonly value: boolean; readonly label: string }> = [
  { value: false, label: "Off" },
  { value: true, label: "On" },
];

/**
 * `useSyncExternalStore`'s subscribe argument. Nothing subscribes: `document.cookie` has no change
 * event a component could listen for, and this store's job is only to supply a hydration-safe
 * *initial* read — every update after that goes through `pickedTheme`, ordinary React state, which is
 * what actually re-renders the button on a tap. Same shape as `CalendarShell`'s `subscribeToNothing`,
 * kept local here rather than shared: a two-line function is not worth a cross-file import.
 */
function subscribeToNothing(): () => void {
  return () => {};
}

/** `getSnapshot`. `readThemeCookie` already defaults an absent/invalid cookie to nothing — "dark" is
 * this call site's own fallback, matching FR-012. */
function readTheme(): Theme {
  return readThemeCookie() ?? "dark";
}

/** `getServerSnapshot`. Always `"dark"` rather than `null`: unlike `CalendarShell`'s clock read,
 * where any guess could be wrong, FR-012 makes "dark" the *correct* answer whenever the real cookie
 * cannot be read yet, so there is no "not known" state worth representing here. */
function readServerTheme(): Theme {
  return "dark";
}
