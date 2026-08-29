import { test } from "node:test"
import assert from "node:assert/strict"
import { isToolOutputTruncated, matchingToolPart, stagedToolOutput } from "./tool-output.ts"
import type { Part } from "./sdk.ts"

const part = (id: string, callID?: string): Part => ({
  id,
  messageID: "m1",
  type: "tool",
  callID,
  state: { status: "completed", output: "short" },
})

test("staged output preserves the daemon truncation notice exactly once", () => {
  const output = "short\n[... output truncated ...]"
  assert.equal(stagedToolOutput(output), output)
})

test("tool output hydration matches a stable part id before call id", () => {
  const parts = [part("p1", "same"), part("p2", "same")]
  assert.equal(matchingToolPart(parts, { partID: "p2", callID: "same" })?.id, "p2")
  assert.equal(matchingToolPart(parts, { callID: "same" })?.id, "p1")
})

test("missing full output retains staged fallback and recognizes daemon metadata", () => {
  assert.equal(matchingToolPart([part("p1")], { partID: "missing" }), undefined)
  assert.equal(isToolOutputTruncated({ ...part("p1"), state: { status: "completed", metadata: { outputTruncated: true } } }), true)
})
