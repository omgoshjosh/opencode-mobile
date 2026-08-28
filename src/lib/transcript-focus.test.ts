import assert from "node:assert/strict"
import test from "node:test"
import { isTranscriptActive, nextActiveTranscript, shouldApplyTranscriptSnapshot } from "./transcript-focus.ts"

test("focus makes that session the active transcript", () => {
  assert.equal(nextActiveTranscript(null, "session-a", true), "session-a")
  assert.equal(nextActiveTranscript("session-b", "session-a", true), "session-a")
})

test("blur clears only the session that still owns focus", () => {
  assert.equal(nextActiveTranscript("session-a", "session-a", false), null)
  assert.equal(nextActiveTranscript("session-b", "session-a", false), "session-b")
})

test("transcript work requires the focused and selected session to match", () => {
  assert.equal(isTranscriptActive("session-a", "session-a"), true)
  assert.equal(isTranscriptActive(null, "session-a"), false)
  assert.equal(isTranscriptActive("session-a", "session-b"), false)
})

test("an HTTP snapshot cannot overwrite SSE received while it was in flight", () => {
  assert.equal(shouldApplyTranscriptSnapshot(4, 4), true)
  assert.equal(shouldApplyTranscriptSnapshot(4, 5), false)
})
