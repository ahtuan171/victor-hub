import type { Metadata } from "next";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { IntelConsole } from "@/components/intel/IntelConsole";
import { hasSessionCookie, sessionCookieName } from "@/lib/session";

/**
 * The Travel Intelligence surface — the same structure as `map/page.tsx` and `calendar/page.tsx`,
 * including the re-asserted guard: `(app)/layout.tsx` runs once per hard load, and a soft
 * navigation from `/map` would otherwise reuse whatever credential check happened at tab open.
 */
export const metadata: Metadata = {
  title: "Travel Intelligence · Victor Tracker",
};

export default async function IntelPage() {
  const store = await cookies();

  if (!hasSessionCookie(store.get(sessionCookieName())?.value)) {
    redirect("/login");
  }

  return <IntelConsole />;
}
