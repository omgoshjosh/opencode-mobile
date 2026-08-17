import { test } from "node:test"
import assert from "node:assert/strict"
import { rowSubtitle, triageDot } from "./session-triage.ts"

// The one rule that must never regress: "needs you" carries a text label,
// so it cannot depend on color alone.
test("states that demand the user get labels; the rest are dot-only", () => {
  assert.equal(triageDot("needs-attention").label, "Needs you")
  assert.equal(triageDot("retry").label, "Retrying")
  assert.equal(triageDot("busy").label, undefined)
  assert.equal(triageDot("complete").label, undefined)
  assert.equal(triageDot("idle").label, undefined)
})

test("motion means still moving", () => {
  assert.equal(triageDot("busy").pulse, true)
  assert.equal(triageDot("retry").pulse, true)
  assert.equal(triageDot("needs-attention").pulse, false)
  assert.equal(triageDot("idle").pulse, false)
})

test("idle is the only hollow state", () => {
  assert.equal(triageDot("idle").hollow, true)
  for (const state of ["needs-attention", "busy", "retry", "complete"] as const) {
    assert.equal(triageDot(state).hollow, false)
  }
})

test("subtitle joins swarm and preview, collapses to null when empty", () => {
  assert.equal(rowSubtitle("Reliability Team", "running tests"), "Reliability Team · running tests")
  assert.equal(rowSubtitle("Reliability Team", null), "Reliability Team")
  assert.equal(rowSubtitle(null, "running tests"), "running tests")
  assert.equal(rowSubtitle(null, undefined), null)
  assert.equal(rowSubtitle("  ", ""), null)
})
