import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MISSING_RESPONSE_NOTICE,
  messageErrorText,
  messageNoticeText,
  isHiddenSyntheticUserMessage,
  visibleTranscriptEntry,
  visibleTranscriptParts,
} from "./transcript-visibility.ts"

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

test("only complete documented assistant-audience user envelopes are hidden", () => {
  assert.equal(isHiddenSyntheticUserMessage({ role: "user" }, [{ type: "text", text: '<task id="x">report</task>' }]), true)
  assert.equal(isHiddenSyntheticUserMessage({ role: "user" }, [{ type: "text", text: "<swarm-briefing>rules</swarm-briefing>" }]), true)
  assert.equal(isHiddenSyntheticUserMessage({ role: "user" }, [{ type: "text", text: "<system-reminder>rules</system-reminder>" }]), true)
  assert.equal(isHiddenSyntheticUserMessage({ role: "user" }, [{ type: "text", text: "Please mention <task> in the docs" }]), false)
  assert.equal(isHiddenSyntheticUserMessage({ role: "user" }, [{ type: "text", text: "Please mention <system-reminder> in the docs" }]), false)
  assert.equal(isHiddenSyntheticUserMessage({ role: "assistant" }, [{ type: "text", text: "<task>report</task>" }]), false)
})

test("compaction continuation hides only without explicit genuine provenance", () => {
  assert.equal(isHiddenSyntheticUserMessage({ role: "user" }, [{ type: "text", metadata: { compaction_continue: true } }]), true)
  assert.equal(isHiddenSyntheticUserMessage({ role: "user" }, [{ type: "text", synthetic: false, metadata: { compaction_continue: true } }]), false)
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

// --- the four contract states ---

const finalized = { role: "assistant", time: { completed: 5 } }
const inflight = { role: "assistant", time: {} }
const textPart = { type: "text", text: "hello" }

test("state 1: in-flight with nothing visible renders nothing — and no notice", () => {
  assert.equal(visibleTranscriptEntry(inflight, []), undefined)
  assert.equal(messageNoticeText(inflight, []), undefined)
})

test("state 2: finalized with content renders normally, no notice", () => {
  const entry = visibleTranscriptEntry(finalized, [textPart])
  assert.ok(entry)
  assert.equal(messageNoticeText(finalized, [textPart]), undefined)
})

test("state 3: finalized with a non-abort error renders the error notice", () => {
  const errored = { role: "assistant", time: {}, error: { name: "APIError", message: "boom" } }
  assert.equal(messageNoticeText(errored, []), "Provider request failed: boom")
  assert.ok(visibleTranscriptEntry(errored, []))
})

test("state 4: finalized, empty, no error synthesizes the missing-response notice — not a drop", () => {
  assert.equal(messageNoticeText(finalized, []), MISSING_RESPONSE_NOTICE)
  // Scaffolding-only parts (step markers, empty text) count as empty too.
  const scaffolding = [{ type: "step-start" }, { type: "text", text: "" }, { type: "step-finish" }]
  assert.equal(messageNoticeText(finalized, scaffolding), MISSING_RESPONSE_NOTICE)
  assert.ok(visibleTranscriptEntry(finalized, []), "entry must be kept so the notice can render")
})

test("structural messages (synthetic/ignored text only) create no card and no notice", () => {
  const briefing = [{ type: "text", text: "<swarm-briefing>...</swarm-briefing>", synthetic: true }]
  assert.equal(messageNoticeText(finalized, briefing), undefined)
  assert.equal(visibleTranscriptEntry(finalized, briefing), undefined)
})

test("late-arriving content evaporates the notice", () => {
  assert.equal(messageNoticeText(finalized, []), MISSING_RESPONSE_NOTICE)
  assert.equal(messageNoticeText(finalized, [textPart]), undefined)
})

test("aborted messages never synthesize a notice", () => {
  const aborted = { role: "assistant", time: { completed: 5 }, error: { name: "MessageAbortedError" } }
  assert.equal(messageNoticeText(aborted, []), undefined)
})
