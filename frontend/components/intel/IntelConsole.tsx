"use client";

import { useEffect, useRef, useState } from "react";

/**
 * TRAVEL INTELLIGENCE — the console surface.
 *
 * Level 1: a conversation and nothing else. It knows nothing about the owner's destinations, and
 * says so when asked, because nothing on this side reads them yet.
 *
 * Conversation state is local and deliberately not persisted: there is no history table behind
 * this, so pretending otherwise across a reload would be a lie the next session has to unpick.
 */

interface Turn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** Starter commands. They fill the input rather than sending, so nothing is spent by a stray tap. */
const QUICK_COMMANDS = [
  { label: "PLAN", text: "Plan a 5-day trip in " },
  { label: "RECOMMEND", text: "Recommend three destinations for " },
  { label: "ANALYZE", text: "Analyze this destination for a first visit: " },
] as const;

export function IntelConsole() {
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;

    const next: readonly Turn[] = [...turns, { role: "user", content: message }];
    setTurns(next);
    setDraft("");
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const detail =
          payload !== null && typeof payload === "object" && "detail" in payload
            ? String((payload as { detail: unknown }).detail)
            : `The console request failed (${response.status}).`;
        setError(detail);
        return;
      }

      const reply =
        payload !== null && typeof payload === "object" && "reply" in payload
          ? String((payload as { reply: unknown }).reply)
          : "";

      if (!reply) {
        setError("The analyst returned an empty response.");
        return;
      }

      setTurns((current) => [...current, { role: "assistant", content: reply }]);
    } catch {
      setError("Could not reach the console endpoint.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-4">
        <h1 className="font-display text-sm tracking-wide">TRAVEL INTELLIGENCE</h1>
        <span
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid="intel-status"
        >
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full bg-primary ${busy ? "animate-pulse" : ""}`}
          />
          {busy ? "WORKING" : "ONLINE"}
        </span>
      </header>

      <div ref={logRef} className="flex-1 space-y-4 overflow-y-auto p-4" data-testid="intel-log">
        {turns.length === 0 && (
          <div className="space-y-2 text-muted-foreground">
            <p className="font-display text-xs">SYSTEM</p>
            <p className="text-sm">
              Travel Intelligence initialized. Ask about a destination, a route, or a duration.
            </p>
            <p className="text-xs">
              No saved destinations are connected yet — this analyst reasons about places, not about
              your map.
            </p>
          </div>
        )}

        {turns.map((turn, index) => (
          <div key={index} data-testid={`intel-turn-${turn.role}`}>
            <p className="font-display mb-1 text-xs text-muted-foreground">
              {turn.role === "user" ? "COMMAND" : "ANALYST"}
            </p>
            <p
              className={
                turn.role === "user"
                  ? "border-l-2 border-primary pl-3 text-sm"
                  : "text-sm whitespace-pre-wrap"
              }
            >
              {turn.content}
            </p>
          </div>
        ))}

        {busy && (
          <p className="font-display animate-pulse text-xs text-muted-foreground">ANALYSING...</p>
        )}

        {error !== null && (
          <p
            className="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
            data-testid="intel-error"
          >
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {QUICK_COMMANDS.map((command) => (
            <button
              key={command.label}
              type="button"
              onClick={() => {
                setDraft(command.text);
                inputRef.current?.focus();
              }}
              className="focus-ring font-display min-h-[44px] shrink-0 rounded-sm border border-border px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              {command.label}
            </button>
          ))}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="TYPE COMMAND..."
            aria-label="Command"
            data-testid="intel-input"
            className="focus-ring min-h-[44px] flex-1 rounded-sm border border-border bg-secondary px-3 text-sm"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            data-testid="intel-send"
            className="focus-ring font-display min-h-[44px] min-w-[44px] rounded-sm bg-primary px-4 text-xs text-primary-foreground disabled:opacity-40"
          >
            {busy ? "..." : ">"}
          </button>
        </form>
      </div>
    </div>
  );
}
