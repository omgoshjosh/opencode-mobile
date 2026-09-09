import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isIntentionalSessionError,
  notifySessionError,
  SESSION_ERROR_NOTIFICATION_COOLDOWN_MS,
} from "./session-error-notification.ts"

test("dispatches actionable top-level errors with provider messages", () => {
  const sent: Array<Record<string, unknown>> = []
  const notify = (payload: Record<string, unknown>) => sent.push(payload)

  notifySessionError(notify, "session-a", { name: "ProviderAuthError", data: { message: "Token expired" } }, [])

  assert.deepEqual(sent, [
    {
      category: "errors",
      title: "Session error",
      body: "Token expired",
      sessionId: "session-a",
      dedupeKey: "session-error-session-a",
      dedupeCooldownMs: SESSION_ERROR_NOTIFICATION_COOLDOWN_MS,
    },
  ])
})

test("suppresses intentional abort errors", () => {
  const sent: Array<Record<string, unknown>> = []
  const error = { name: "MessageAbortedError", data: { message: "Stopped" } }

  assert.equal(isIntentionalSessionError(error), true)
  notifySessionError((payload) => sent.push(payload), "session-a", error, [])
  assert.deepEqual(sent, [])
})

test("routes child fan-out through one parent dedupe key", () => {
  const sent: Array<Record<string, unknown>> = []
  const sessions = [
    { id: "parent" },
    { id: "child-a", parentID: "parent" },
    { id: "child-b", parentID: "parent" },
  ]

  notifySessionError((payload) => sent.push(payload), "child-a", { message: "first" }, sessions)
  notifySessionError((payload) => sent.push(payload), "child-b", { message: "second" }, sessions)

  assert.deepEqual(sent.map(({ sessionId, dedupeKey }) => ({ sessionId, dedupeKey })), [
    { sessionId: "parent", dedupeKey: "session-error-parent" },
    { sessionId: "parent", dedupeKey: "session-error-parent" },
  ])
})

test("falls back to the child when its parent is missing", () => {
  const sent: Array<Record<string, unknown>> = []

  notifySessionError(
    (payload) => sent.push(payload),
    "child",
    { name: "UnknownError", data: { message: "Unknown failure" } },
    [{ id: "child", parentID: "missing" }],
  )

  assert.equal(sent[0]?.sessionId, "child")
  assert.equal(sent[0]?.dedupeKey, "session-error-child")
})
