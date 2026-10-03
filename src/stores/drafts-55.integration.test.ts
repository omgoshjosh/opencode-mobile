// #55: draft persistence across cold start, delete pruning, and what counts as an accepted send.
import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { before, beforeEach, test } from "node:test"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { clearNativeMockStorage } from "../../tests/store-native-mocks.mjs"

let useDrafts: typeof import("./drafts").useDrafts
let useSessions: typeof import("./sessions").useSessions
let useConnections: typeof import("./connections").useConnections

/** A cold start: in-memory state gone, AsyncStorage kept. */
function coldStart() {
  useDrafts.setState(useDrafts.getInitialState(), true)
}

const session = (id: string) => ({ id, title: id, directory: "/p", time: { created: 0, updated: 0 } })

before(async () => {
  ;({ useDrafts } = await import("./drafts"))
  ;({ useSessions } = await import("./sessions"))
  ;({ useConnections } = await import("./connections"))
})

beforeEach(() => {
  clearNativeMockStorage()
  coldStart()
  useSessions.setState(useSessions.getInitialState(), true)
  useConnections.setState(useConnections.getInitialState(), true)
})

test("#55 a draft survives a cold start and a reopen", async () => {
  await useDrafts.getState().load()
  useDrafts.getState().save("A", "unsent work")
  await new Promise((resolve) => setImmediate(resolve))
  coldStart()
  await useDrafts.getState().load()
  assert.equal(useDrafts.getState().drafts.A?.text, "unsent work")
})

test("#55 hydration never overwrites fresher typing, and never resurrects a clear that raced it", async () => {
  await AsyncStorage.setItem(
    "opencode_drafts",
    JSON.stringify({ A: { text: "old", at: 1 }, B: { text: "sent already", at: 1 }, C: { text: "another session's draft", at: 1 } }),
  )
  coldStart()
  useDrafts.getState().save("A", "fresh typing")
  useDrafts.getState().clear("B")
  await useDrafts.getState().load()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(useDrafts.getState().drafts.A?.text, "fresh typing")
  assert.equal(useDrafts.getState().drafts.B, undefined, "a clear before hydration stays cleared")
  const persisted = JSON.parse((await AsyncStorage.getItem("opencode_drafts")) ?? "{}")
  assert.equal(persisted.B, undefined, "and is not written back")
  assert.equal(persisted.A?.text, "fresh typing")
  // A save that lands before hydration must not wipe every other session's stored draft.
  assert.equal(useDrafts.getState().drafts.C?.text, "another session's draft")
  assert.equal(persisted.C?.text, "another session's draft")
})

test("#55 deleting a session prunes its draft", async () => {
  await useDrafts.getState().load()
  useDrafts.getState().save("gone", "draft for a deleted session")
  useDrafts.getState().save("kept", "still here")
  useSessions.setState({ sessions: [session("gone"), session("kept")] as never })
  useSessions.getState().removeSession("gone")
  assert.equal(useDrafts.getState().drafts.gone, undefined)
  assert.equal(useDrafts.getState().drafts.kept?.text, "still here")
})

test("#55 sendMessage reports server acceptance: true on 2xx, false when nothing was sent, throws on failure", async () => {
  let fail = false
  const client = {
    session: {
      prompt: async () => { if (fail) throw new Error("Failed to send message: 500 - boom") },
      messagesPage: async () => ({ messages: [] }),
      messages: async () => [],
    },
  }
  const send = () => useSessions.getState().sendMessage("hi", undefined, undefined, [], undefined) as Promise<unknown>

  assert.equal(await send(), false, "no client/session: nothing was accepted")

  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ currentSession: session("A") as never })
  assert.equal(await send(), true, "2xx from prompt_async is acceptance")

  fail = true
  await assert.rejects(send(), /500/)
})
