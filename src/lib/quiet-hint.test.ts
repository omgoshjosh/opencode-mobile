import { test } from "node:test"
import assert from "node:assert/strict"
import { quietLabel, QUIET_THRESHOLD_MS } from "./quiet-hint.ts"

const T = 10_000_000

test("short silences are just thinking", () => {
  assert.equal(quietLabel({ lastTextAt: T - QUIET_THRESHOLD_MS + 1000, hasRunningTool: false, now: T }), null)
})

test("a long silence names its length", () => {
  assert.equal(quietLabel({ lastTextAt: T - 24 * 60_000, hasRunningTool: false, now: T }), "quiet 24m")
  assert.equal(quietLabel({ lastTextAt: T - 90 * 60_000, hasRunningTool: false, now: T }), "quiet 1h 30m")
})

test("a running tool suppresses the hint — its card already shows liveness", () => {
  assert.equal(quietLabel({ lastTextAt: T - 60 * 60_000, hasRunningTool: true, now: T }), null)
})

test("no activity timestamp, no claim", () => {
  assert.equal(quietLabel({ lastTextAt: null, hasRunningTool: false, now: T }), null)
  assert.equal(quietLabel({ lastTextAt: Number.NaN, hasRunningTool: false, now: T }), null)
})
