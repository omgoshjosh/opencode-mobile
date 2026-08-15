import { test } from "node:test"
import assert from "node:assert/strict"
import { deliveryState, isOptimisticID, mergePendingMessages } from "./message-delivery.ts"

test("a server-assigned id is delivered", () => {
  assert.equal(deliveryState({ messageID: "msg_00abc" }), "sent")
})

test("an optimistic id is still queued", () => {
  assert.equal(deliveryState({ messageID: "temp-1234" }), "queued")
})

test("a marked message is failed regardless of id shape", () => {
  assert.equal(deliveryState({ messageID: "temp-1", failedIDs: { "temp-1": true } }), "failed")
  assert.equal(deliveryState({ messageID: "msg_1", failedIDs: { msg_1: true } }), "failed")
})

test("failed takes precedence over queued", () => {
  const state = deliveryState({ messageID: "temp-9", failedIDs: { "temp-9": true } })
  assert.equal(state, "failed")
})

test("isOptimisticID distinguishes client ids", () => {
  assert.equal(isOptimisticID("temp-1"), true)
  assert.equal(isOptimisticID("msg_1"), false)
})

// The bug this exists for: a failed send used to disappear entirely because
// refreshMessages replaced the list from the server.
test("merging keeps a pending message the server does not know about", () => {
  const server = [{ id: "msg_1" }, { id: "msg_2" }]
  const previous = [{ id: "msg_1" }, { id: "temp-99" }]
  assert.deepEqual(mergePendingMessages(server, previous), [{ id: "msg_1" }, { id: "msg_2" }, { id: "temp-99" }])
})

test("merging drops an optimistic message the server has now echoed", () => {
  const server = [{ id: "msg_1" }, { id: "temp-99" }]
  const previous = [{ id: "temp-99" }]
  assert.deepEqual(mergePendingMessages(server, previous), [{ id: "msg_1" }, { id: "temp-99" }])
})

test("merging never duplicates and preserves pending order", () => {
  const server = [{ id: "msg_1" }]
  const previous = [{ id: "temp-1" }, { id: "temp-2" }]
  assert.deepEqual(mergePendingMessages(server, previous), [{ id: "msg_1" }, { id: "temp-1" }, { id: "temp-2" }])
})

test("no pending messages returns the server list untouched", () => {
  const server = [{ id: "msg_1" }]
  assert.equal(mergePendingMessages(server, [{ id: "msg_0" }]), server)
})
