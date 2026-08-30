import { test } from "node:test"
import assert from "node:assert/strict"
import { cancelledQueuedMessages, mergeQueuedText, queuedUserMessages, recoverQueuedMessages, shouldApplyQueuedEdit } from "./queued-message-edit.ts"

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

test("recovers queued text and attachments in chronological message order", () => {
  const result = recoverQueuedMessages({
    messages: [message("first", 20), message("second", 30)],
    parts: {
      first: [{ type: "file", url: "first.png", mime: "image/png" }],
      second: [{ type: "file", url: "second.jpg", mime: "image/jpeg" }],
    },
    draft: "draft",
    extractText: (parts) => parts[0]?.url === "first.png" ? "one" : "",
  })
  assert.deepEqual(result, {
    ok: true,
    text: "one\n\ndraft",
    files: [{ uri: "first.png", mime: "image/png" }, { uri: "second.jpg", mime: "image/jpeg" }],
  })
})

test("refuses missing, unrecoverable, and malformed queued parts before reverting", () => {
  for (const parts of [{}, { one: [] }, { one: [{ type: "file", url: "file" }] }, { one: [{ type: "file", url: " ", mime: "image/png" }] }, { one: [{ type: "file", url: "file", mime: {} }] }]) {
    assert.deepEqual(recoverQueuedMessages({ messages: [message("one", 20)], parts, draft: "", extractText: () => "" }), { ok: false })
  }
})

test("restores only cancelled messages in original chronological order", () => {
  const messages = [message("first", 20), message("second", 30), message("third", 40)]
  assert.deepEqual(
    cancelledQueuedMessages(messages, { first: "cancelled", second: "running", third: "cancelled" }).map((item) => item.id),
    ["first", "third"],
  )
})

test("only the focused originating session may receive the result", () => {
  assert.equal(shouldApplyQueuedEdit(true, "s1", "s1", "s1"), true)
  assert.equal(shouldApplyQueuedEdit(false, "s1", "s1", "s1"), false)
  assert.equal(shouldApplyQueuedEdit(true, "s2", "s1", "s1"), false)
  assert.equal(shouldApplyQueuedEdit(true, "s1", "s1", "s2"), false)
})
