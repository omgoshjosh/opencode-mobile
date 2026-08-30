import { test } from "node:test"
import assert from "node:assert/strict"
import { messageCancelOutcome } from "./message-cancel.ts"

test("parses only documented message cancellation outcomes", () => {
  for (const outcome of ["cancelled", "running", "settled", "missing"]) {
    assert.equal(messageCancelOutcome({ outcome }), outcome)
  }
  assert.throws(() => messageCancelOutcome({ outcome: "unknown" }))
})
