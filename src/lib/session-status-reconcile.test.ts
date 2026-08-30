import { test } from "node:test"
import assert from "node:assert/strict"
import { fetchReconnectMessages, inferBusyFromMessages, isSessionActuallyIdle } from "./session-status-reconcile.ts"
import type { Message, MessageWithParts } from "./sdk.ts"

const userMsg = (id: string, overrides: Partial<Message> = {}): Message => ({
  id,
  sessionID: "s1",
  role: "user",
  time: { created: 1 },
  ...overrides,
})

const assistantMsg = (id: string, overrides: Partial<Message> = {}): Message => ({
  id,
  sessionID: "s1",
  role: "assistant",
  time: { created: 1 },
  ...overrides,
})

test("reconnect reconciliation requests only the newest message", async () => {
  let received: { sessionID?: string; params?: { limit?: number } } = {}
  const client = {
    session: {
      messages: async (sessionID: string, params?: { limit?: number }): Promise<MessageWithParts[]> => {
        received = { sessionID, params }
        return []
      },
    },
  }

  await fetchReconnectMessages(client, "s1")

  assert.deepEqual(received, { sessionID: "s1", params: { limit: 1 } })
})

test("no messages -> still busy (nothing to reconcile from)", () => {
  assert.equal(isSessionActuallyIdle(undefined), false)
  assert.equal(isSessionActuallyIdle(null), false)
  assert.equal(isSessionActuallyIdle([]), false)
})

test("last message is a completed assistant reply -> idle (the missed-event case)", () => {
  const messages = [userMsg("u1"), assistantMsg("a1", { time: { created: 1, completed: 5 } })]
  assert.equal(isSessionActuallyIdle(messages), true)
})

test("last message is an assistant reply that errored out -> idle", () => {
  const messages = [userMsg("u1"), assistantMsg("a1", { error: { message: "boom" } })]
  assert.equal(isSessionActuallyIdle(messages), true)
})

test("last message is a user prompt awaiting a reply -> still busy", () => {
  const messages = [assistantMsg("a1", { time: { created: 1, completed: 5 } }), userMsg("u2")]
  assert.equal(isSessionActuallyIdle(messages), false)
})

test("last message is an assistant reply still streaming (no completed, no error) -> still busy", () => {
  const messages = [userMsg("u1"), assistantMsg("a1")]
  assert.equal(isSessionActuallyIdle(messages), false)
})

test("a follow-up user prompt after a completed assistant reply -> still busy again", () => {
  // Server queued a second turn: the previous reply completed, but a new user
  // message was appended after it, so the run may be in progress again.
  const messages = [
    userMsg("u1"),
    assistantMsg("a1", { time: { created: 1, completed: 5 } }),
    userMsg("u2"),
  ]
  assert.equal(isSessionActuallyIdle(messages), false)
})

// --- inferBusyFromMessages (the missing stop button) ---

test("a hung tool run infers busy: assistant message never terminated", () => {
  assert.equal(
    inferBusyFromMessages([{ role: "assistant", time: { created: 1 } } as never]),
    true,
  )
})

test("a trailing user prompt with no reply infers busy", () => {
  assert.equal(inferBusyFromMessages([{ role: "user" } as never]), true)
})

test("a completed or errored assistant tail infers not busy", () => {
  assert.equal(
    inferBusyFromMessages([{ role: "assistant", time: { created: 1, completed: 2 } } as never]),
    false,
  )
  assert.equal(
    inferBusyFromMessages([{ role: "assistant", error: { name: "x" } } as never]),
    false,
  )
})

test("an empty transcript never invents a run", () => {
  assert.equal(inferBusyFromMessages([]), false)
  assert.equal(inferBusyFromMessages(null), false)
  assert.equal(inferBusyFromMessages(undefined), false)
})
