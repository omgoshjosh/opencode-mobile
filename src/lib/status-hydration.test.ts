import assert from "node:assert/strict"
import test from "node:test"
import { canApplyStatusHydration } from "./status-hydration.ts"

test("late status hydration is rejected after disconnect invalidates its lifecycle", () => {
  const controller = new AbortController()

  assert.equal(canApplyStatusHydration(1, 1, controller.signal), true)
  assert.equal(canApplyStatusHydration(1, 2, controller.signal), false)

  controller.abort()
  assert.equal(canApplyStatusHydration(1, 1, controller.signal), false)
})
