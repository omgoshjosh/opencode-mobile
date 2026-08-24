/**
 * Scheduled-wakeup visibility — the OTHER wait mechanism.
 *
 * Monitors show up as running tool calls; a relay-scheduled wakeup is
 * invisible: the schedulewakeup call completes instantly and the session
 * just… will get a message later. The human's requirement is that every
 * wait, whatever the mechanism, is visible and interruptible — so the
 * client derives "expects a wake at T" from the schedulewakeup part itself:
 * wakeAt = the call's completion time + delaySeconds.
 *
 * HONESTY: this is a client-side expectation, not relay truth — the panel
 * says "expects wake", and entries expire once T (+ grace) passes whether
 * or not the wake actually fired. The server-side pendingWake field
 * (requested from the reliability team as part of the enriched-status
 * contract) replaces this inference when it ships.
 *
 * Rules learned from the harness's own semantics:
 * - the LATEST schedulewakeup in a session wins (each reschedules the next);
 * - stop:true cancels outright;
 * - any wake whose time has passed is history, not state.
 */

export interface PendingWake {
  sessionID: string
  wakeAt: number
  reason?: string
  /** When the scheduling call completed — newer always supersedes. */
  scheduledAt: number
}

export type PendingWakeMap = Record<string, PendingWake>

/** Entries linger this long past wakeAt so a just-fired wake doesn't blink out mid-glance. */
export const WAKE_GRACE_MS = 60_000

export function trackWakePart(
  map: PendingWakeMap,
  part: {
    sessionID?: string
    tool?: string
    state?: { status?: string; input?: unknown; time?: { end?: number } }
  },
  now: number,
): PendingWakeMap {
  if (part.tool !== "schedulewakeup") return map
  const sessionID = part.sessionID
  if (!sessionID) return map
  // Only completed calls scheduled anything.
  if (part.state?.status !== "completed") return map

  const input = (typeof part.state?.input === "object" && part.state.input !== null
    ? part.state.input
    : {}) as Record<string, unknown>
  const scheduledAt = part.state?.time?.end ?? now

  // Never let an OLDER call override a newer schedule.
  const existing = map[sessionID]
  if (existing && existing.scheduledAt > scheduledAt) return map

  if (input.stop === true) {
    if (!map[sessionID]) return map
    const next = { ...map }
    delete next[sessionID]
    return next
  }

  const delaySeconds = typeof input.delaySeconds === "number" ? input.delaySeconds : null
  if (delaySeconds === null || !Number.isFinite(delaySeconds)) return map

  return {
    ...map,
    [sessionID]: {
      sessionID,
      wakeAt: scheduledAt + delaySeconds * 1000,
      reason: typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : undefined,
      scheduledAt,
    },
  }
}

/** The wake to show for a session right now, or null (expired / none). */
export function pendingWakeFor(map: PendingWakeMap, sessionID: string, now: number): PendingWake | null {
  const wake = map[sessionID]
  if (!wake) return null
  if (now > wake.wakeAt + WAKE_GRACE_MS) return null
  return wake
}

/** "wakes in 4m" / "waking now" — the countdown is the datum. */
export function wakeCountdownLabel(wake: PendingWake, now: number): string {
  const ms = wake.wakeAt - now
  if (ms <= 0) return "waking now"
  const mins = Math.ceil(ms / 60_000)
  if (mins < 60) return `wakes in ${mins}m`
  return `wakes in ${Math.floor(mins / 60)}h ${mins % 60}m`
}
