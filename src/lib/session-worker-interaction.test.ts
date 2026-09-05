import assert from "node:assert/strict"
import { test } from "node:test"
import { expandWorkers } from "./session-worker-interaction.ts"

test("worker expansion loads children without invoking root navigation", () => {
  let loads = 0
  const expanded = expandWorkers(false, () => loads++)
  assert.equal(expanded, true)
  assert.equal(loads, 1)
})

test("collapsing does not fetch children again", () => {
  let loads = 0
  assert.equal(expandWorkers(true, () => loads++), false)
  assert.equal(loads, 0)
})
