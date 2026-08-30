import { sanitizeBody } from "./notify-format.ts"

export const SESSION_ERROR_NOTIFICATION_COOLDOWN_MS = 60_000

type Notify = (payload: {
  category: "errors"
  title: string
  body: string
  sessionId: string
  dedupeKey: string
  dedupeCooldownMs: number
}) => unknown

export function notifySessionError(notify: Notify, sessionID: string, message?: string) {
  notify({
    category: "errors",
    title: "Session error",
    body: sanitizeBody(message, "Something went wrong"),
    sessionId: sessionID,
    dedupeKey: `session-error-${sessionID}`,
    dedupeCooldownMs: SESSION_ERROR_NOTIFICATION_COOLDOWN_MS,
  })
}
