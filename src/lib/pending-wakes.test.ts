import { test } from "node:test"
import assert from "node:assert/strict"
import {
  trackWakePart,
  pendingWakeFor,
  wakeCountdownLabel,
  WAKE_GRACE_MS,
  type PendingWakeMap,
} from "./pending-wakes.ts"

const T = 1_000_000_000
const wakePart = (end: number, input: Record<string, unknown>, status = "completed") => ({
  sessionID: "s1",
  tool: "schedulewakeup",
  state: { status, input, time: { end } },
})

test("a completed schedulewakeup registers wakeAt = completion + delaySeconds", () => {
  const map = trackWakePart({}, wakePart(T, { delaySeconds: 300, reason: "watching CI" }), T)
  const wake = pendingWakeFor(map, "s1", T + 1000)
  assert.equal(wake?.wakeAt, T + 300_000)
  assert.equal(wake?.reason, "watching CI")
})

test("the latest schedule wins; an older part cannot override a newer one", () => {
  let map: PendingWakeMap = {}
  map = trackWakePart(map, wakePart(T + 10_000, { delaySeconds: 600 }), T)
  map = trackWakePart(map, wakePart(T, { delaySeconds: 60 }), T)
  assert.equal(pendingWakeFor(map, "s1", T + 11_000)?.wakeAt, T + 10_000 + 600_000)
})

test("stop:true cancels the pending wake", () => {
  let map = trackWakePart({}, wakePart(T, { delaySeconds: 300 }), T)
  map = trackWakePart(map, wakePart(T + 1000, { stop: true }), T)
  assert.equal(pendingWakeFor(map, "s1", T + 2000), null)
})

test("expired wakes disappear after the grace window", () => {
  const map = trackWakePart({}, wakePart(T, { delaySeconds: 60 }), T)
  assert.ok(pendingWakeFor(map, "s1", T + 60_000 + WAKE_GRACE_MS - 1))
  assert.equal(pendingWakeFor(map, "s1", T + 60_000 + WAKE_GRACE_MS + 1), null)
})

test("running/foreign/malformed parts are ignored", () => {
  assert.deepEqual(trackWakePart({}, wakePart(T, { delaySeconds: 60 }, "running"), T), {})
  assert.deepEqual(trackWakePart({}, { ...wakePart(T, { delaySeconds: 60 }), tool: "bash" }, T), {})
  assert.deepEqual(trackWakePart({}, wakePart(T, { reason: "no delay" }), T), {})
})

test("countdown label", () => {
  const wake = { sessionID: "s1", wakeAt: T + 240_000, scheduledAt: T }
  assert.equal(wakeCountdownLabel(wake, T), "wakes in 4m")
  assert.equal(wakeCountdownLabel(wake, T + 300_000), "waking now")
  assert.equal(wakeCountdownLabel({ ...wake, wakeAt: T + 3_900_000 }, T), "wakes in 1h 5m")
})
