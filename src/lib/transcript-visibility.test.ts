import { test } from "node:test"
import assert from "node:assert/strict"
import { messageErrorText, visibleTranscriptEntry, visibleTranscriptParts } from "./transcript-visibility.ts"

const assistant = { role: "assistant" }

test("structural-only assistant envelopes stay out of the transcript", () => {
  assert.equal(
    visibleTranscriptEntry(assistant, [
      { type: "step-start" },
      { type: "step-finish" },
      { type: "snapshot" },
    ]),
    undefined,
  )
})

test("zero-token assistant envelopes do not create chrome-only cards", () => {
  assert.equal(visibleTranscriptEntry({ ...assistant, tokens: { input: 0, output: 0 } }, []), undefined)
})

test("synthetic ignored and compaction-only content is filtered", () => {
  assert.deepEqual(
    visibleTranscriptParts([
      { type: "text", text: "internal", synthetic: true },
      { type: "text", text: "discarded", ignored: true },
      { type: "compaction" },
    ]),
    [],
  )
})

test("an assistant message remains hidden until a visible part arrives", () => {
  assert.equal(visibleTranscriptEntry(assistant, []), undefined)
  assert.deepEqual(visibleTranscriptEntry(assistant, [{ type: "text", text: "Answer" }])?.parts, [
    { type: "text", text: "Answer" },
  ])
})

test("blank text and non-rendered files do not count as visible", () => {
  assert.deepEqual(
    visibleTranscriptParts([
      { type: "text", text: "  \n" },
      { type: "file", mime: "application/pdf" },
      { type: "file", mime: "image/png" },
    ]),
    [{ type: "file", mime: "image/png" }],
  )
})

test("error-only assistant messages remain visible with useful text", () => {
  const message = {
    ...assistant,
    error: { name: "APIError", data: { message: "Upstream returned no response" } },
  }
  assert.deepEqual(visibleTranscriptEntry(message, []), { message, parts: [] })
  assert.equal(messageErrorText(message), "Provider request failed: Upstream returned no response")
})

test("aborted assistant messages without content remain hidden", () => {
  const message = { ...assistant, error: { name: "MessageAbortedError", data: { message: "aborted" } } }
  assert.equal(visibleTranscriptEntry(message, []), undefined)
  assert.equal(messageErrorText(message), undefined)
})
