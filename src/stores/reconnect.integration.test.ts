import "../../tests/store-native-mocks.mjs"
import assert from "node:assert/strict"
import { afterEach, before, beforeEach, test } from "node:test"
import { clearNativeMockStorage } from "../../tests/store-native-mocks.mjs"
import type { Message, MessageWithParts, Session } from "../lib/sdk"

let useConnections: typeof import("./connections").useConnections
let useEvents: typeof import("./events").useEvents
let useSessions: typeof import("./sessions").useSessions
let useSettings: typeof import("./settings").useSettings

function session(id: string): Session {
  return { id, slug: id, projectID: "project", directory: "/project", title: id, version: "1", time: { created: 1, updated: 1 } }
}

function message(id: string, sessionID = "s1"): Message {
  return { id, sessionID, role: "assistant", time: { created: 1 } }
}

function page(...ids: string[]): MessageWithParts[] {
  return ids.map((id) => ({ info: message(id), parts: [{ id: `part-${id}`, messageID: id, type: "text", text: id }] }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function waitForStore(check: () => boolean): Promise<void> {
  if (check()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = useSessions.subscribe(() => {
      if (!check()) return
      unsubscribe()
      resolve()
    })
  })
}

function waitForEvents(check: () => boolean): Promise<void> {
  if (check()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = useEvents.subscribe(() => {
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

before(async () => {
  ;({ useConnections } = await import("./connections"))
  ;({ useEvents } = await import("./events"))
  ;({ useSessions } = await import("./sessions"))
  ;({ useSettings } = await import("./settings"))
})

beforeEach(() => {
  useEvents.getState().disconnect()
  clearNativeMockStorage()
  useConnections.setState(useConnections.getInitialState(), true)
  useSessions.setState(useSessions.getInitialState(), true)
  useSettings.setState(useSettings.getInitialState(), true)
  useSettings.setState({ pageSize: 2 })
})

afterEach(() => useEvents.getState().disconnect())

test("missed idle-session messages and parts are recovered after disconnect", async () => {
  const request = deferred<{ items: MessageWithParts[]; nextCursor?: string }>()
  const started = deferred<void>()
  const client = {
    global: { events: liveStream({ payload: { type: "connected", properties: {} } }) },
    session: { status: async () => ({}), messagesPage: async () => { started.resolve(); return request.promise } },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1", messages: [message("old")], parts: { old: [] } })
  useEvents.setState({ reconnectAttempts: 1 })

  useEvents.getState().connect()
  await started.promise
  request.resolve({ items: page("old", "missed"), nextCursor: "older" })
  await waitForStore(() => useSessions.getState().messages.some((item) => item.id === "missed"))

  const state = useSessions.getState()
  assert.deepEqual(state.messages.map((item) => item.id), ["old", "missed"])
  assert.equal(state.parts.missed[0].id, "part-missed")
})

test("successful reconnect reconciles exactly one bounded idle transcript page", async () => {
  const started = deferred<void>()
  const requests: Array<{ sessionID: string; options: object }> = []
  const client = {
    global: { events: liveStream({ payload: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } } }) },
    session: {
      status: async () => ({}),
      messagesPage: async (sessionID: string, options: object) => {
        requests.push({ sessionID, options })
        started.resolve()
        return { items: page("missed"), nextCursor: undefined }
      },
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1" })
  useEvents.setState({ reconnectAttempts: 1 })

  useEvents.getState().connect()
  await started.promise
  await waitForStore(() => useSessions.getState().messages.some((item) => item.id === "missed"))

  assert.deepEqual(requests, [{ sessionID: "s1", options: { limit: 2, before: undefined, renderBudget: 40000, partBudget: 4000 } }])
})

test("foreground reconciles a live stream without opening another stream", async () => {
  const started = deferred<void>()
  let streams = 0
  const client = {
    global: { events: async function* (signal: AbortSignal) { streams += 1; yield { payload: { type: "connected", properties: {} } }; await new Promise<void>((resolve) => signal.addEventListener("abort", resolve, { once: true })) } },
    session: { status: async () => ({}), messagesPage: async () => { started.resolve(); return { items: page("foreground"), nextCursor: undefined } } },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1" })

  useEvents.getState().connect()
  await waitForEvents(() => useEvents.getState().transport === "live")
  useEvents.getState().resume()
  await started.promise
  await waitForStore(() => useSessions.getState().messages.some((item) => item.id === "foreground"))

  assert.equal(streams, 1)
})

test("a live SSE update wins while lifecycle reconciliation is in flight", async () => {
  const response = deferred<{ items: MessageWithParts[]; nextCursor?: string }>()
  const client = { session: { messagesPage: async () => response.promise } }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1" })

  const reconciliation = useSessions.getState().reconcileOpenMessages()
  useSessions.getState().handleEvent({ type: "message.updated", properties: { info: message("live") } } as never)
  assert.deepEqual(useSessions.getState().messages.map((item) => item.id), ["live"])
  response.resolve({ items: page("stale"), nextCursor: undefined })
  await reconciliation

  assert.deepEqual(useSessions.getState().messages.map((item) => item.id), ["live"])
})

test("overlapping lifecycle reconciliations are idempotent and preserve pagination", async () => {
  const response = deferred<{ items: MessageWithParts[]; nextCursor?: string }>()
  let requests = 0
  const client = { session: { messagesPage: async () => { requests += 1; return response.promise } } }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1", messages: [message("old")], parts: { old: [] }, nextCursor: "older", hasMore: true })

  const first = useSessions.getState().reconcileOpenMessages()
  const second = useSessions.getState().reconcileOpenMessages()
  assert.equal(first, second)
  response.resolve({ items: [...page("old", "new"), ...page("new")], nextCursor: undefined })
  await Promise.all([first, second])

  const state = useSessions.getState()
  assert.equal(requests, 1)
  assert.deepEqual(state.messages.map((item) => item.id), ["old", "new"])
  assert.deepEqual(state.parts.new.map((part) => part.id), ["part-new"])
  assert.equal(state.nextCursor, "older")
  assert.equal(state.hasMore, true)
})

test("a complete reconnect snapshot removes sessions deleted while SSE was down", async () => {
  const client = {
    global: { events: liveStream({ payload: { type: "connected", properties: {} } }) },
    session: { status: async () => ({}), listSnapshot: async () => ({ sessions: [session("kept")], complete: true }) },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ sessions: [session("ghost"), session("kept")] })

  useEvents.getState().connect()
  await waitForStore(() => useSessions.getState().sessions.length === 1)
  assert.deepEqual(useSessions.getState().sessions.map((item) => item.id), ["kept"])
})

test("incomplete reconnect snapshots fail closed", async () => {
  for (const complete of [false, false]) {
    useSessions.setState({ sessions: [session("ghost")] })
    const client = {
      global: { events: liveStream({ payload: { type: "connected", properties: {} } }) },
      session: { status: async () => ({}), listSnapshot: async () => ({ sessions: [], complete }) },
    }
    useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
    useEvents.getState().connect()
    await waitForEvents(() => useEvents.getState().transport === "live")
    assert.deepEqual(useSessions.getState().sessions.map((item) => item.id), ["ghost"])
    useEvents.getState().disconnect()
  }
})

test("post-fetch creation and an older lifecycle cannot be pruned", async () => {
  const first = deferred<{ sessions: Session[]; complete: boolean }>()
  let calls = 0
  const client = {
    session: {
      listSnapshot: async () => {
        calls += 1
        return calls === 1 ? first.promise : { sessions: [session("created")], complete: true }
      },
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ sessions: [session("created")] })

  const old = useSessions.getState().reconcileSessions(10)
  useSessions.getState().handleEvent({ type: "session.created", properties: { info: session("new") } } as never)
  await useSessions.getState().reconcileSessions(11)
  first.resolve({ sessions: [], complete: true })
  await old

  assert.deepEqual(useSessions.getState().sessions.map((item) => item.id).sort(), ["created", "new"])
})

test("direct session.deleted clears the session and blocks late selection", async () => {
  const request = deferred<Session>()
  const client = {
    session: {
      get: async () => request.promise,
      messagesPage: async () => ({ items: [], nextCursor: undefined }),
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ sessions: [session("gone")], currentSession: session("gone"), activeTranscriptSessionID: "gone" })
  const select = useSessions.getState().selectSession("gone")
  useSessions.getState().handleEvent({ type: "session.deleted", properties: { sessionID: "gone" } } as never)
  request.resolve(session("gone"))
  await select

  const state = useSessions.getState()
  assert.equal(state.currentSession, null)
  assert.deepEqual(state.sessions, [])
})
