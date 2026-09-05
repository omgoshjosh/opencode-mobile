import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { afterEach, before, beforeEach, test } from "node:test"
import { clearNativeMockStorage, nativeMockAlerts } from "../../tests/store-native-mocks.mjs"

let useConnections: typeof import("./connections").useConnections
let useEvents: typeof import("./events").useEvents
let useSessions: typeof import("./sessions").useSessions
let resetReadStateHydration: typeof import("./sessions").resetReadStateHydration

const session = (id: string, updated = 0) => ({ id, title: id, directory: "/w", time: { created: 0, updated } })

before(async () => {
  ;({ useConnections } = await import("./connections"))
  ;({ useEvents } = await import("./events"))
  ;({ useSessions, resetReadStateHydration } = await import("./sessions"))
})

beforeEach(() => {
  useEvents.getState().disconnect()
  clearNativeMockStorage()
  resetReadStateHydration()
  useConnections.setState(useConnections.getInitialState(), true)
  useSessions.setState(useSessions.getInitialState(), true)
})

afterEach(() => useEvents.getState().disconnect())

function waitForReadState(check: () => boolean): Promise<void> {
  if (check()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = useSessions.subscribe(() => {
      if (!check()) return
      unsubscribe()
      resolve()
    })
  })
}

function liveStream(...events: object[]) {
  return async function* (signal: AbortSignal) {
    for (const event of events) yield event
    await new Promise<void>((resolve) => signal.addEventListener("abort", resolve, { once: true }))
  }
}

/** A client with just the surface the read-state paths touch. */
function connect(sessionState: Record<string, unknown>, sessions = [session("s1")]) {
  const client = {
    session: { tree: async () => sessions, list: async () => sessions, children: async () => [] },
    sessionState,
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  return client
}

const marked = (id: string) => useSessions.getState().readState[id]?.markedUnreadAt !== undefined

test("marking unread shows immediately and settles on the server's revision", async () => {
  const patches: unknown[] = []
  connect({
    update: async (id: string, body: unknown) => {
      patches.push(body)
      return { sessionID: id, reviewedFiles: [], markedUnreadAt: 900, timeUpdated: 900 }
    },
    hydrate: async () => ({ sessionUiState: {} }),
  })
  useSessions.setState({ sessions: [session("s1")] })

  await useSessions.getState().markUnread("s1")

  assert.equal(marked("s1"), true)
  assert.deepEqual(useSessions.getState().readState.s1, { revision: 900, markedUnreadAt: 900 })
  assert.deepEqual(patches, [{ markedUnread: true, expectedRevision: 0 }])
})

// The event for our own write can beat the write's response back. Neither
// order may flicker the row.
test("the SSE replay of our own write is idempotent", async () => {
  connect({
    update: async (id: string) => ({ sessionID: id, reviewedFiles: [], markedUnreadAt: 900, timeUpdated: 900 }),
    hydrate: async () => ({ sessionUiState: {} }),
  })
  useSessions.setState({ sessions: [session("s1")] })

  await useSessions.getState().markUnread("s1")
  const settled = useSessions.getState().readState
  useSessions.getState().applyServerReadState({ sessionID: "s1", markedUnreadAt: 900, timeUpdated: 900 })

  assert.equal(useSessions.getState().readState, settled)
})

test("an event from another device marks a session this one never touched", () => {
  useSessions.getState().applyServerReadState({ sessionID: "s1", markedUnreadAt: 700, timeUpdated: 700 })
  assert.equal(marked("s1"), true)

  useSessions.getState().applyServerReadState({ sessionID: "s1", timeUpdated: 800 })
  assert.equal(marked("s1"), false)
})

test("the next write echoes the revision the server last gave us", async () => {
  const patches: Array<Record<string, unknown>> = []
  connect({
    update: async (id: string, body: Record<string, unknown>) => {
      patches.push(body)
      return { sessionID: id, reviewedFiles: [], markedUnreadAt: 1200, timeUpdated: 1200 }
    },
    hydrate: async () => ({ sessionUiState: {} }),
  })
  useSessions.setState({ sessions: [session("s1")] })
  useSessions.getState().applyServerReadState({ sessionID: "s1", timeUpdated: 1100 })

  await useSessions.getState().markUnread("s1")

  assert.equal(patches[0].expectedRevision, 1100)
})

test("a failed write reverts the optimistic mark", async () => {
  connect({
    update: async () => {
      throw new Error("network down")
    },
    hydrate: async () => ({ sessionUiState: {} }),
  })
  useSessions.setState({ sessions: [session("s1")] })

  await useSessions.getState().markUnread("s1")

  assert.equal(marked("s1"), false)
  assert.equal(useSessions.getState().readStateSupported, true, "a network blip is not a missing route")
  assert.equal(nativeMockAlerts().length, 1, "the user is told, not silently reverted")
})

// A 404 is an old daemon, not a failure: the action is withdrawn rather than
// left on screen to fail again.
test("a 404 disables the feature for the connection without crashing", async () => {
  connect({ update: async () => null, hydrate: async () => null })
  useSessions.setState({ sessions: [session("s1")] })

  await useSessions.getState().markUnread("s1")

  assert.equal(useSessions.getState().readStateSupported, false)
  assert.equal(marked("s1"), false)
})

test("an old daemon that 404s hydration disables the feature and keeps the list", async () => {
  connect({ update: async () => null, hydrate: async () => null })

  await useSessions.getState().loadSessions()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(useSessions.getState().readStateSupported, false)
  assert.deepEqual(useSessions.getState().sessions.map((s) => s.id), ["s1"])
})

test("hydration folds the card route's `revision` in as the state revision", async () => {
  connect({
    update: async () => null,
    hydrate: async () => ({
      sessionUiState: {
        s1: { sessionID: "s1", markedUnreadAt: 600, revision: 600, reviewedFiles: [], displayStatus: "idle", updated: true },
      },
    }),
  })

  await useSessions.getState().loadSessions()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(useSessions.getState().readState.s1, { revision: 600, markedUnreadAt: 600 })
})

test("hydration asks each distinct directory exactly once per connection", async () => {
  const asked: string[] = []
  const sessions = [
    { ...session("s1"), directory: "/a" },
    { ...session("s2"), directory: "/a" },
    { ...session("s3"), directory: "/b" },
  ]
  connect(
    {
      update: async () => null,
      hydrate: async (directory: string) => {
        asked.push(directory)
        return { sessionUiState: {} }
      },
    },
    sessions,
  )

  await useSessions.getState().loadSessions()
  await new Promise((resolve) => setImmediate(resolve))
  await useSessions.getState().loadSessions()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(asked, ["/a", "/b"])
})

test("marking read clears the mark and stamps seenAt past the session's activity", async () => {
  const patches: Array<Record<string, unknown>> = []
  connect({
    update: async (id: string, body: Record<string, unknown>) => {
      patches.push(body)
      return { sessionID: id, reviewedFiles: [], seenAt: 5000, timeUpdated: 5000 }
    },
    hydrate: async () => ({ sessionUiState: {} }),
  })
  useSessions.setState({ sessions: [session("s1", 4000)] })
  useSessions.getState().applyServerReadState({ sessionID: "s1", markedUnreadAt: 900, timeUpdated: 900 })

  useSessions.getState().markRead("s1")
  assert.equal(marked("s1"), false, "clears optimistically")
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(patches[0].expectedRevision, 900)
  assert.ok((patches[0].seenAt as number) >= 4000)
  assert.deepEqual(useSessions.getState().readState.s1, { revision: 5000 })
})

test("marking read never throws, even when the write fails", async () => {
  connect({
    update: async () => {
      throw new Error("network down")
    },
    hydrate: async () => ({ sessionUiState: {} }),
  })
  useSessions.setState({ sessions: [session("s1")] })

  assert.doesNotThrow(() => useSessions.getState().markRead("s1"))
  await new Promise((resolve) => setImmediate(resolve))
})

// markRead runs inside selectSession's try block. A throw here -- a client
// built before this route existed has no `sessionState` at all -- would be
// caught there and reported as "Failed to load session" for a session that
// loaded fine.
test("marking read on a client without the namespace cannot fail the open", () => {
  const client = { session: { tree: async () => [], list: async () => [], children: async () => [] } }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ sessions: [session("s1")] })

  assert.doesNotThrow(() => useSessions.getState().markRead("s1"))
})

test("an unsupported connection does not keep re-probing on every open", async () => {
  let calls = 0
  connect({
    update: async () => {
      calls += 1
      return null
    },
    hydrate: async () => null,
  })
  useSessions.setState({ sessions: [session("s1")], readStateSupported: false })

  useSessions.getState().markRead("s1")
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls, 0)
})

// The mark is shared across every client the user has open, so it has to
// arrive over SSE and not only as the reply to this device's own write.
test("a session_state event off the wire applies to the store", async () => {
  const client = {
    global: {
      events: liveStream({
        payload: {
          type: "opencodex.session_state.updated",
          properties: { sessionID: "s1", state: { sessionID: "s1", markedUnreadAt: 700, reviewedFiles: [], timeUpdated: 700 } },
        },
      }),
    },
    session: { status: async () => ({}) },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })

  useEvents.getState().connect()
  await waitForReadState(() => marked("s1"))

  assert.deepEqual(useSessions.getState().readState.s1, { revision: 700, markedUnreadAt: 700 })
})

test("a session_state event with no revision is ignored rather than trusted", async () => {
  useSessions.getState().applyServerReadState({ sessionID: "s1", markedUnreadAt: 700, timeUpdated: 700 })
  const client = {
    global: {
      events: liveStream({
        payload: { type: "opencodex.session_state.updated", properties: { sessionID: "s1", state: { sessionID: "s1" } } },
      }),
    },
    session: { status: async () => ({}) },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })

  useEvents.getState().connect()
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(marked("s1"), true)
})

test("deleting a session forgets its mark", async () => {
  connect({ update: async () => null, hydrate: async () => null })
  useSessions.setState({ sessions: [session("s1")] })
  useSessions.getState().applyServerReadState({ sessionID: "s1", markedUnreadAt: 900, timeUpdated: 900 })

  useSessions.getState().removeSession("s1")

  assert.equal("s1" in useSessions.getState().readState, false)
})
