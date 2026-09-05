import { test } from "node:test"
import assert from "node:assert/strict"
import { DOT_BUSY, DOT_COMPLETE, rowSubtitle, triageDot } from "./session-triage.ts"

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

// --- #34: dot semantics ---

test("every dot is named for a screen reader, including the wordless ones", () => {
  assert.equal(triageDot("needs-attention").a11yLabel, "Needs you")
  assert.equal(triageDot("retry").a11yLabel, "Retrying")
  assert.equal(triageDot("busy").a11yLabel, "Working")
  assert.equal(triageDot("complete").a11yLabel, "Finished, unread")
  assert.equal(triageDot("idle").a11yLabel, "Idle")
})

test("unread-finished is blue, not the brand purple that read as decoration", () => {
  assert.equal(triageDot("complete").color, DOT_COMPLETE)
  assert.equal(DOT_COMPLETE, "#60a5fa")
  assert.equal(triageDot("busy").color, "#16a34a")
  assert.equal(triageDot("idle").color, "#9a9a9a")
  assert.equal(triageDot("needs-attention").color, "#dc2626")
  assert.equal(triageDot("retry").color, "#b45309")
})

test("a parent with running workers is working, not complete or idle", () => {
  for (const state of ["complete", "idle"] as const) {
    const dot = triageDot(state, 2)
    assert.equal(dot.color, DOT_BUSY)
    assert.equal(dot.a11yLabel, "Working")
    assert.equal(dot.hollow, false)
  }
  // Zero workers leaves the session's own state alone.
  assert.equal(triageDot("complete", 0).color, DOT_COMPLETE)
})

test("running workers never bury a state that demands the user", () => {
  assert.equal(triageDot("needs-attention", 3).a11yLabel, "Needs you")
  assert.equal(triageDot("needs-attention", 3).label, "Needs you")
  assert.equal(triageDot("retry", 3).a11yLabel, "Retrying")
})
