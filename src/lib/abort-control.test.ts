import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ABORT_CONFIRM_WINDOW_MS,
  DISARMED,
  abortLabel,
  isAbortable,
  isArmed,
  pressAbort,
} from "./abort-control.ts"

const NOW = 1_000_000

// --- when a stop is offered ---

// The bug: a run started from the TUI/CLI/another device left this client with
// no way to stop it, because `sending` is only set by a local send.
test("a server-reported busy session is stoppable even without a local send", () => {
  assert.equal(isAbortable({ status: "busy", sending: false }), true)
})

test("a retrying session is stoppable", () => {
  assert.equal(isAbortable({ status: "retry" }), true)
})

// Covers the gap between tapping send and the first status event arriving.
test("an optimistic local send is stoppable before any status arrives", () => {
  assert.equal(isAbortable({ status: undefined, sending: true }), true)
})

test("an idle session is not stoppable", () => {
  assert.equal(isAbortable({ status: "idle", sending: false }), false)
  assert.equal(isAbortable({}), false)
})

// --- arming ---

test("the first tap arms rather than stopping", () => {
  const action = pressAbort(DISARMED, NOW)
  assert.equal(action.type, "arm")
  assert.equal(action.state.armed, true)
})

test("a second tap inside the window stops", () => {
  const armed = pressAbort(DISARMED, NOW).state
  const action = pressAbort(armed, NOW + 500)
  assert.equal(action.type, "abort")
})

test("stopping leaves the control disarmed", () => {
  const armed = pressAbort(DISARMED, NOW).state
  assert.equal(pressAbort(armed, NOW + 500).state.armed, false)
})

// A tap minutes later, long after the user forgot they armed it, must not
// stop the run outright.
test("a tap after the window lapses re-arms instead of stopping", () => {
  const armed = pressAbort(DISARMED, NOW).state
  const action = pressAbort(armed, NOW + ABORT_CONFIRM_WINDOW_MS + 1)
  assert.equal(action.type, "arm")
})

test("the arm expires exactly at the window edge", () => {
  const armed = { armed: true, at: NOW }
  assert.equal(isArmed(armed, NOW + ABORT_CONFIRM_WINDOW_MS - 1), true)
  assert.equal(isArmed(armed, NOW + ABORT_CONFIRM_WINDOW_MS), false)
})

test("missing state is treated as disarmed", () => {
  assert.equal(isArmed(null, NOW), false)
  assert.equal(isArmed(undefined, NOW), false)
  assert.equal(pressAbort(null, NOW).type, "arm")
})

// --- label ---

test("the armed label states the consequence, not just the verb", () => {
  assert.notEqual(abortLabel(true), abortLabel(false))
  assert.match(abortLabel(true), /again/i)
  assert.equal(abortLabel(false), "Stop")
})
