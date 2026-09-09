import { sanitizeBody } from "./notify-format.ts"
import type { Session } from "./sdk.ts"

export const SESSION_ERROR_NOTIFICATION_COOLDOWN_MS = 60_000

type Notify = (payload: {
  category: "errors"
  title: string
  body: string
  sessionId: string
  dedupeKey: string
  dedupeCooldownMs: number
}) => unknown

export type SessionError = {
  name?: unknown
  message?: unknown
  data?: unknown
} | null | undefined

export function isIntentionalSessionError(error: SessionError): boolean {
  return error?.name === "MessageAbortedError"
}

function messageFrom(error: SessionError): string | undefined {
  if (typeof error?.message === "string") return error.message
  if (!error?.data || typeof error.data !== "object" || !("message" in error.data)) return
  const message = error.data.message
  return typeof message === "string" ? message : undefined
}

function notificationOwnerID(sessionID: string, sessions: Pick<Session, "id" | "parentID">[]): string {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const session = byID.get(sessionID)
  if (!session?.parentID) return sessionID
  let ownerID = sessionID
  let parentID: string | undefined = session.parentID
  const seen = new Set([sessionID])
  while (parentID && !seen.has(parentID)) {
    const parent = byID.get(parentID)
    if (!parent) break
    ownerID = parent.id
    seen.add(ownerID)
    parentID = parent.parentID
  }
  return ownerID
}

export function notifySessionError(
  notify: Notify,
  sessionID: string,
  error: SessionError,
  sessions: Pick<Session, "id" | "parentID">[],
) {
  if (isIntentionalSessionError(error)) return
  const notificationSessionID = notificationOwnerID(sessionID, sessions)
  return notify({
    category: "errors",
    title: "Session error",
    body: sanitizeBody(messageFrom(error), "Something went wrong"),
    sessionId: notificationSessionID,
    dedupeKey: `session-error-${notificationSessionID}`,
    dedupeCooldownMs: SESSION_ERROR_NOTIFICATION_COOLDOWN_MS,
  })
}
