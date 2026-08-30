import { test } from "node:test"
import assert from "node:assert/strict"
import { mergeQueuedText, queuedUserMessages, shouldApplyQueuedEdit } from "./queued-message-edit.ts"

const message = (id: string, createdAt: number, role = "user", sessionID = "s1") => ({ id, createdAt, role, sessionID })

test("selects all acknowledged queued user messages chronologically", () => {
  const messages = [message("active", 10), message("queued-late", 30), message("queued-first", 20), message("answer", 40, "assistant")]
  assert.deepEqual(
    queuedUserMessages({ messages, sessionID: "s1", busy: true, inFlightUserCreatedAt: 10, failedIDs: {} }).map((item) => item.id),
    ["queued-first", "queued-late"],
  )
})

test("excludes active, answered, failed, temporary, and other-session messages", () => {
  const messages = [message("answered", 5), message("active", 10), message("failed", 20), message("temp-1", 30), message("other", 40, "user", "s2")]
  assert.deepEqual(
    queuedUserMessages({ messages, sessionID: "s1", busy: true, inFlightUserCreatedAt: 10, failedIDs: { failed: true } }),
    [],
  )
  assert.deepEqual(queuedUserMessages({ messages, sessionID: "s1", busy: false, inFlightUserCreatedAt: 10, failedIDs: {} }), [])
})

test("merges every queued text before the existing draft without empty gaps", () => {
  assert.equal(mergeQueuedText([" first ", "", "second"], " draft "), "first\n\nsecond\n\ndraft")
  assert.equal(mergeQueuedText([""], ""), "")
})

test("only the focused originating session may receive the result", () => {
  assert.equal(shouldApplyQueuedEdit(true, "s1", "s1", "s1"), true)
  assert.equal(shouldApplyQueuedEdit(false, "s1", "s1", "s1"), false)
  assert.equal(shouldApplyQueuedEdit(true, "s2", "s1", "s1"), false)
  assert.equal(shouldApplyQueuedEdit(true, "s1", "s1", "s2"), false)
})
