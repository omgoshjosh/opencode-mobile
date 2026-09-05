import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { before, beforeEach, test } from "node:test"
import { clearNativeMockStorage } from "../../tests/store-native-mocks.mjs"

let useConnections: typeof import("./connections").useConnections
let useSessions: typeof import("./sessions").useSessions

const session = (id: string, parentID?: string) => ({ id, parentID, title: id, time: { created: 0, updated: 0 } })

before(async () => {
  ;({ useConnections } = await import("./connections"))
  ;({ useSessions } = await import("./sessions"))
})

beforeEach(() => {
  clearNativeMockStorage()
  useConnections.setState(useConnections.getInitialState(), true)
  useSessions.setState(useSessions.getInitialState(), true)
})

test("M-8 uses the live tree roots and falls back when it is unavailable", async () => {
  const root = session("root")
  const client = {
    session: {
      tree: async () => null,
      list: async () => [root],
      children: async () => [],
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })

  await useSessions.getState().loadSessions()

  assert.deepEqual(useSessions.getState().sessions.map((item) => item.id), ["root"])
})

test("M-8 keeps only children whose parentID matches a visible root", async () => {
  const root = session("root")
  const client = {
    session: {
      tree: async () => [root],
      list: async () => [root],
      children: async () => [session("worker", "root"), session("wrong-parent", "other")],
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })

  await useSessions.getState().loadSessions()
  await useSessions.getState().loadSessionChildren("root")

  assert.deepEqual(useSessions.getState().sessions.map((item) => item.id), ["root", "worker"])
  assert.equal(useSessions.getState().sessions.filter((item) => !item.parentID).length, 1)
})
