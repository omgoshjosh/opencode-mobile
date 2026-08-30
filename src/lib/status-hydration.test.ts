import assert from "node:assert/strict"
import test from "node:test"
import { mergeStatusSnapshot } from "./background-activity.ts"
import { canApplyFocusedStatusHydration, canApplyResyncIdle, canApplyStatusHydration, clearIdleSessionState, settledIdleSessionIDs } from "./status-hydration.ts"

test("late status hydration is rejected after disconnect invalidates its lifecycle", () => {
  const controller = new AbortController()

  assert.equal(canApplyStatusHydration(1, 1, controller.signal), true)
  assert.equal(canApplyStatusHydration(1, 2, controller.signal), false)

  controller.abort()
  assert.equal(canApplyStatusHydration(1, 1, controller.signal), false)
})

test("cached busy hydrated idle clears every stop input", () => {
  const statuses = mergeStatusSnapshot({ session: { type: "busy" } }, { session: { type: "idle" } }, new Set(), 1)
  assert.equal(statuses.session.type, "idle")
  assert.deepEqual(
    clearIdleSessionState({
      sessionID: "session",
      statusText: { session: "Running tool" },
      sending: { session: true },
      runningTools: { session: [{ partID: "tool", messageID: "message", sessionID: "session", title: "Tool", tool: "bash", startedAt: 1 }] },
    }),
    { statusText: { session: "" }, sending: { session: false }, runningTools: {} },
  )
})

test("focused hydration loses to a newer SSE status event", () => {
  assert.equal(
    canApplyFocusedStatusHydration({
      lifecycle: 1,
      currentLifecycle: 1,
      signal: new AbortController().signal,
      currentSessionID: "session",
      sessionID: "session",
      revision: 3,
      currentRevision: 4,
      sendingRevision: 1,
      currentSendingRevision: 1,
    }),
    false,
  )
})

test("optimistic send started during hydration keeps an old idle snapshot from settling", () => {
  assert.equal(
    canApplyFocusedStatusHydration({
      lifecycle: 1,
      currentLifecycle: 1,
      signal: new AbortController().signal,
      currentSessionID: "session",
      sessionID: "session",
      revision: 1,
      currentRevision: 1,
      sendingRevision: 0,
      currentSendingRevision: 1,
    }),
    false,
  )
  assert.deepEqual(settledIdleSessionIDs({ session: { type: "idle" } }, new Set(["session"])), [])
})

test("send started during resync cannot write idle or clear sending", () => {
  assert.equal(canApplyResyncIdle(0, 1), false)
})

test("aborted or navigated focused hydration cannot apply", () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal(
    canApplyFocusedStatusHydration({
      lifecycle: 1,
      currentLifecycle: 1,
      signal: controller.signal,
      currentSessionID: "session",
      sessionID: "session",
      revision: 1,
      currentRevision: 1,
      sendingRevision: 1,
      currentSendingRevision: 1,
    }),
    false,
  )
  assert.equal(
    canApplyFocusedStatusHydration({
      lifecycle: 1,
      currentLifecycle: 1,
      signal: new AbortController().signal,
      currentSessionID: "other",
      sessionID: "session",
      revision: 1,
      currentRevision: 1,
      sendingRevision: 1,
      currentSendingRevision: 1,
    }),
    false,
  )
})
