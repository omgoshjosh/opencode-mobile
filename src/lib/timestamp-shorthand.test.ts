import { test } from "node:test"
import assert from "node:assert/strict"
import { shorthandTimestamp } from "./timestamp-shorthand.ts"

// Fixed reference: 2026-08-17 14:30 local.
const now = new Date(2026, 7, 17, 14, 30).getTime()

test("today is just a clock", () => {
  assert.equal(shorthandTimestamp(new Date(2026, 7, 17, 9, 5).getTime(), now), "09:05")
})

test("this year adds month and day", () => {
  assert.equal(shorthandTimestamp(new Date(2026, 2, 3, 23, 41).getTime(), now), "Mar 3, 23:41")
})

test("other years are spelled fully", () => {
  assert.equal(shorthandTimestamp(new Date(2025, 11, 31, 8, 0).getTime(), now), "2025 Dec 31, 08:00")
})

// Yesterday same clock-time must NOT collapse to a bare clock.
test("yesterday is dated even when the clock matches", () => {
  assert.equal(shorthandTimestamp(new Date(2026, 7, 16, 14, 30).getTime(), now), "Aug 16, 14:30")
})

test("garbage renders nothing, not NaN", () => {
  assert.equal(shorthandTimestamp(undefined, now), null)
  assert.equal(shorthandTimestamp(0, now), null)
  assert.equal(shorthandTimestamp(Number.NaN, now), null)
})
