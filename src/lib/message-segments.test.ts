import { test } from "node:test"
import assert from "node:assert/strict"
import { segmentParts } from "./message-segments.ts"

const text = (t: string) => ({ type: "text", text: t })
const tool = (name: string) => ({ type: "tool", tool: name })

test("interleaving is preserved: prose, run, prose", () => {
  const segments = segmentParts([text("looking"), tool("bash"), tool("grep"), text("found it")])
  assert.deepEqual(
    segments.map((s) => s.kind),
    ["text", "tools", "text"],
  )
  assert.equal((segments[1] as { tools: unknown[] }).tools.length, 2)
})

test("consecutive text parts merge into one prose block", () => {
  const segments = segmentParts([text("a"), text("b")])
  assert.equal(segments.length, 1)
  assert.equal((segments[0] as { text: string }).text, "a\nb")
})

test("whitespace-only text disappears instead of splitting a run", () => {
  const segments = segmentParts([tool("bash"), text("  \n"), tool("grep")])
  assert.deepEqual(segments.map((s) => s.kind), ["tools"])
  assert.equal((segments[0] as { tools: unknown[] }).tools.length, 2)
})

test("non text/tool parts are ignored here", () => {
  const segments = segmentParts([{ type: "reasoning", text: "hmm" }, text("hi"), { type: "file" }])
  assert.deepEqual(segments.map((s) => s.kind), ["text"])
})

test("empty input segments to nothing", () => {
  assert.deepEqual(segmentParts([]), [])
  assert.deepEqual(segmentParts(null), [])
})
