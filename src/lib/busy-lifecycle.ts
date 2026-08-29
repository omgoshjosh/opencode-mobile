import type { SessionStatus } from "./sdk"
export type { SessionStatus } from "./sdk"

/** Retain server evidence; create client evidence only for a new local epoch. */
export function nextSessionStatus(previous: SessionStatus | undefined, next: SessionStatus, now: number): SessionStatus {
  if (next.type !== "busy") return next
  if (next.since !== undefined || next.lastActivityAt !== undefined) return next
  if (previous?.type === "busy") {
    return {
      ...next,
      ...(previous.since !== undefined ? { since: previous.since } : {}),
      ...(previous.lastActivityAt !== undefined ? { lastActivityAt: previous.lastActivityAt } : {}),
    }
  }
  return { ...next, since: now, lastActivityAt: now }
}

/** Text proves the current busy turn is still producing output. */
export function noteTextActivity(status: SessionStatus | undefined, now: number): SessionStatus | undefined {
  if (status?.type !== "busy") return status
  return { ...status, lastActivityAt: now }
}
