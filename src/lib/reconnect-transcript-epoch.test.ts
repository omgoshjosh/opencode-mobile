import { test } from "node:test"
import assert from "node:assert/strict"
import { createReconnectTranscriptEpoch } from "./reconnect-transcript-epoch.ts"

test("a reconnect reconciles an idle open session exactly once despite its idle event", () => {
  const epoch = createReconnectTranscriptEpoch(true)
  assert.equal(epoch.reconcileOpen("s1"), "s1")
  assert.equal(epoch.reconcileOpen("s1"), null)
  assert.equal(epoch.shouldRefreshAfterIdle("s1"), false)
})

test("busy status reconciliation stays separate while the open transcript remains once-only", () => {
  const epoch = createReconnectTranscriptEpoch(true)
  assert.equal(epoch.reconcileOpen("s1"), "s1")
  assert.equal(epoch.shouldRefreshAfterIdle("s1"), false)
})

test("a normal live idle event still refreshes after a non-reconnect connection", () => {
  const epoch = createReconnectTranscriptEpoch(false)
  assert.equal(epoch.reconcileOpen("s1"), null)
  assert.equal(epoch.shouldRefreshAfterIdle("s1"), true)
})
