import type { Metadata } from "next";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ScheduleShell } from "@/components/schedule/ScheduleShell";
import { hasSessionCookie, sessionCookieName } from "@/lib/session";

/**
 * The Travel Schedule surface (Module 02) — `calendar/page.tsx` and `map/page.tsx`'s exact twin
 * in every structural way, including the re-asserted session check: `app/(app)/layout.tsx` guards
 * this route group once, but App Router layouts are not re-executed on soft navigations, so a
 * client-side route change between screens would reuse a credential check from whenever the tab
 * was opened. Page segments *are* re-fetched on a soft navigation, which is why this file carries
 * its own check through the same `hasSessionCookie` helper rather than a second inline cookie read.
 */
export const metadata: Metadata = {
  title: "Travel Schedule · Victor Tracker",
};

export default async function SchedulePage() {
  const store = await cookies();

  if (!hasSessionCookie(store.get(sessionCookieName())?.value)) {
    redirect("/login");
  }

  return <ScheduleShell />;
}
