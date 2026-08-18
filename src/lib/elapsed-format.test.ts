import { test } from "node:test"
import assert from "node:assert/strict"
import { formatElapsed } from "./elapsed-format.ts"

test("sub-second stays in milliseconds", () => {
  assert.equal(formatElapsed(412), "412ms")
})

test("under a minute reads in decimal seconds", () => {
  assert.equal(formatElapsed(3400), "3.4s")
  assert.equal(formatElapsed(59_900), "59.9s")
})

test("a minute and beyond reads like a wall clock", () => {
  assert.equal(formatElapsed(90_000), "1m 30s")
  assert.equal(formatElapsed(600_000), "10m 0s")
})

test("garbage renders nothing, not NaN", () => {
  assert.equal(formatElapsed(-5), null)
  assert.equal(formatElapsed(Number.NaN), null)
})
