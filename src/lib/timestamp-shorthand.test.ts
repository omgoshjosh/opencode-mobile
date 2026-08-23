import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveClockMode, shorthandTimestamp, isSpecificZone, isValidZone } from "./timestamp-shorthand.ts"

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

// --- UTC mode ---

test("utc mode renders UTC fields and says so", () => {
  // 2026-08-17T14:30Z; "today" in UTC is decided by UTC fields.
  const utcNow = Date.UTC(2026, 7, 17, 14, 30)
  assert.equal(shorthandTimestamp(Date.UTC(2026, 7, 17, 9, 5), utcNow, "utc"), "09:05 UTC")
  assert.equal(shorthandTimestamp(Date.UTC(2026, 2, 3, 23, 41), utcNow, "utc"), "Mar 3, 23:41 UTC")
  assert.equal(shorthandTimestamp(Date.UTC(2025, 11, 31, 8, 0), utcNow, "utc"), "2025 Dec 31, 08:00 UTC")
})

test("local stays suffix-free", () => {
  const now = new Date(2026, 7, 17, 14, 30).getTime()
  assert.equal(shorthandTimestamp(new Date(2026, 7, 17, 9, 5).getTime(), now, "local"), "09:05")
})

// --- 12-hour clock ---

test("12-hour mode reads like a wall clock: no leading zero, AM/PM", () => {
  const now = new Date(2026, 7, 17, 14, 30).getTime()
  assert.equal(shorthandTimestamp(new Date(2026, 7, 17, 8, 5).getTime(), now, "local", "12h"), "8:05 AM")
  assert.equal(shorthandTimestamp(new Date(2026, 7, 17, 20, 5).getTime(), now, "local", "12h"), "8:05 PM")
  assert.equal(shorthandTimestamp(new Date(2026, 2, 3, 23, 41).getTime(), now, "local", "12h"), "Mar 3, 11:41 PM")
})

test("noon and midnight are 12 PM and 12 AM, never 0", () => {
  const now = new Date(2026, 7, 17, 14, 30).getTime()
  assert.equal(shorthandTimestamp(new Date(2026, 7, 17, 0, 0).getTime(), now, "local", "12h"), "12:00 AM")
  assert.equal(shorthandTimestamp(new Date(2026, 7, 17, 12, 0).getTime(), now, "local", "12h"), "12:00 PM")
})

test("12-hour composes with UTC's suffix", () => {
  const utcNow = Date.UTC(2026, 7, 17, 14, 30)
  assert.equal(shorthandTimestamp(Date.UTC(2026, 7, 17, 20, 5), utcNow, "utc", "12h"), "8:05 PM UTC")
})

test("clock preference resolution: system follows the device, unknown keeps 24h", () => {
  assert.equal(resolveClockMode("12h", true), "12h")
  assert.equal(resolveClockMode("24h", false), "24h")
  assert.equal(resolveClockMode("system", false), "12h")
  assert.equal(resolveClockMode("system", true), "24h")
  assert.equal(resolveClockMode("system", null), "24h")
})

// --- specific IANA zones ---

test("a specific zone renders in that zone with its own label", () => {
  // 2026-01-15T20:00:00Z -> 12:00 PST (UTC-8, winter).
  const ts = Date.UTC(2026, 0, 15, 20, 0)
  const now = Date.UTC(2026, 0, 15, 22, 0)
  assert.equal(shorthandTimestamp(ts, now, "America/Los_Angeles", "24h"), "12:00 PST")
})

test("specific-zone 'today' collapses by that zone's calendar, not the device's", () => {
  // 2026-06-10T02:00:00Z is still June 9 in Los Angeles (PDT, UTC-7).
  const ts = Date.UTC(2026, 5, 10, 2, 0)
  const now = Date.UTC(2026, 5, 10, 3, 0) // also June 9 in LA -> same day
  assert.equal(shorthandTimestamp(ts, now, "America/Los_Angeles", "24h"), "19:00 PDT")
  // From a `now` that is June 10 in LA, the date appears.
  const later = Date.UTC(2026, 5, 10, 20, 0)
  assert.equal(shorthandTimestamp(ts, later, "America/Los_Angeles", "24h"), "Jun 9, 19:00 PDT")
})

test("an unresolvable zone falls back to UTC and says UTC — never a mislabeled clock", () => {
  const ts = Date.UTC(2026, 0, 15, 20, 0)
  const now = Date.UTC(2026, 0, 15, 22, 0)
  assert.equal(shorthandTimestamp(ts, now, "Not/A_Zone", "24h"), "20:00 UTC")
})

test("isSpecificZone and isValidZone classify correctly", () => {
  assert.equal(isSpecificZone("local"), false)
  assert.equal(isSpecificZone("utc"), false)
  assert.equal(isSpecificZone("Asia/Tokyo"), true)
  assert.equal(isValidZone("Asia/Tokyo"), true)
  assert.equal(isValidZone("Not/A_Zone"), false)
})
