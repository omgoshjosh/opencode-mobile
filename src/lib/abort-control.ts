// Being able to stop a run.
//
// The composer already had a stop button, but it was reachable only through a
// gap in four conditions:
//
//     isSending && !input.trim() && attachments.length === 0 && !speech.listening
//
// which produced three ways to be stuck watching a run you wanted to end:
//
//  1. **`isSending` is the optimistic *local* flag** — set when this client
//     sends. A run started from the TUI, the CLI, or another device never sets
//     it, so the session is visibly busy on this screen with no way to stop
//     it. Same after an app restart, since the flag does not survive.
//  2. **Typing hides the control.** The moment you draft your next message the
//     stop button is replaced by send, so stopping first requires clearing
//     what you just typed.
//  3. **An attachment or an active mic hides it too**, for the same reason.
//
// The fix is to drive the affordance from the authoritative busy state — the
// server's `session.status` over SSE — OR'd with the optimistic flag so the
// control still appears in the gap before the first event arrives.
//
// The two-tap arm/confirm mirrors the TUI's esc-esc: a stop is destructive and
// unrecoverable (the run's partial work is lost), so it should not be one
// stray tap away on a control that is always on screen.

/** How long an armed stop stays armed before it disarms itself. */
export const ABORT_CONFIRM_WINDOW_MS = 3_000

export interface AbortArmState {
  armed: boolean
  /** When it was armed; used to expire it. */
  at: number
}

export const DISARMED: AbortArmState = { armed: false, at: 0 }

/**
 * Can this session be stopped right now?
 *
 * `status` is the server's view (SSE `session.status`), `sending` the local
 * optimistic flag. Either alone is insufficient: the server's view misses the
 * window between tapping send and the first status event, and the local flag
 * misses every run this client did not start.
 */
export function isAbortable(input: { status?: string; sending?: boolean }): boolean {
  if (input.sending) return true
  return input.status === "busy" || input.status === "retry"
}

/**
 * Is an arm still live?
 *
 * Expiry matters: an arm left indefinitely means a tap minutes later — long
 * after the user forgot they armed it — would abort immediately.
 */
export function isArmed(state: AbortArmState | null | undefined, now: number): boolean {
  if (!state?.armed) return false
  return now - state.at < ABORT_CONFIRM_WINDOW_MS
}

export type AbortAction =
  /** First tap, or a tap after the window lapsed: arm and wait. */
  | { type: "arm"; state: AbortArmState }
  /** Second tap inside the window: actually stop. */
  | { type: "abort"; state: AbortArmState }

/**
 * Decide what a tap on the stop control means.
 *
 * A tap after expiry re-arms rather than aborting, so a stale arm can never
 * turn a single tap into a stop.
 */
export function pressAbort(state: AbortArmState | null | undefined, now: number): AbortAction {
  if (isArmed(state, now)) return { type: "abort", state: DISARMED }
  return { type: "arm", state: { armed: true, at: now } }
}

/**
 * Label for the control.
 *
 * The armed label states the consequence rather than repeating the verb —
 * "Stop again" says what to do but not that it is irreversible.
 */
export function abortLabel(armed: boolean): string {
  return armed ? "Tap again to stop the run" : "Stop"
}
