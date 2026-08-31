import { test } from "node:test"
import assert from "node:assert/strict"
import { notifySessionError, SESSION_ERROR_NOTIFICATION_COOLDOWN_MS } from "./session-error-notification.ts"

test("dispatches deduped session-error notifications independently per session", () => {
  const sent: Array<Record<string, unknown>> = []
  const notify = (payload: Record<string, unknown>) => sent.push(payload)

  notifySessionError(notify, "session-a", "first failure")
  notifySessionError(notify, "session-a", "repeated failure")
  notifySessionError(notify, "session-b", "other failure")

  assert.deepEqual(sent, [
    {
      category: "errors",
      title: "Session error",
      body: "first failure",
      sessionId: "session-a",
      dedupeKey: "session-error-session-a",
      dedupeCooldownMs: SESSION_ERROR_NOTIFICATION_COOLDOWN_MS,
    },
    {
      category: "errors",
      title: "Session error",
      body: "repeated failure",
      sessionId: "session-a",
      dedupeKey: "session-error-session-a",
      dedupeCooldownMs: SESSION_ERROR_NOTIFICATION_COOLDOWN_MS,
    },
    {
      category: "errors",
      title: "Session error",
      body: "other failure",
      sessionId: "session-b",
      dedupeKey: "session-error-session-b",
      dedupeCooldownMs: SESSION_ERROR_NOTIFICATION_COOLDOWN_MS,
    },
  ])
})
