"use client";

/**
 * TravelEvent state for `ScheduleShell` — Module 02 (Travel Schedule).
 *
 * Same shape as `lib/trips.ts`'s own `useTrips`: one unparameterised read (a personal number of
 * travel events is the only volume this has to handle) plus a `reload()` the shell calls after
 * every create, update, or delete.
 */

import { useEffect, useState } from "react";

import { ApiError, listTravelEvents, type TravelEvent } from "./api";

export type TravelEventsStatus = "loading" | "ready" | "error";

export interface TravelEventsState {
  readonly events: readonly TravelEvent[];
  readonly status: TravelEventsStatus;
  readonly error: string | null;
}

export const INITIAL_TRAVEL_EVENTS_STATE: TravelEventsState = {
  events: [],
  status: "loading",
  error: null,
};

export interface TravelEventsStore extends TravelEventsState {
  readonly reload: () => void;
}

/** Load every TravelEvent and hold it in state. */
export function useTravelEvents(): TravelEventsStore {
  const [state, setState] = useState<TravelEventsState>(INITIAL_TRAVEL_EVENTS_STATE);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let current = true;

    listTravelEvents()
      .then((events) => {
        if (current) setState({ events, status: "ready", error: null });
      })
      .catch((error: unknown) => {
        if (current) {
          setState((previous) => ({
            events: previous.events,
            status: "error",
            error: messageFor(error),
          }));
        }
      });

    return () => {
      current = false;
    };
  }, [reloadCount]);

  return {
    ...state,
    reload: () => setReloadCount((count) => count + 1),
  };
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong loading your travel events. Try again.";
}
