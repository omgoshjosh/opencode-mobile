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
  return {
    id,
    slug: id,
    projectID: "project",
    directory: "/project",
    title: id,
    version: "1",
    time: { created: 1, updated: 1 },
  }
}

function message(id: string, sessionID = "s1"): Message {
  return { id, sessionID, role: "assistant", time: { created: 1 } }
}

function page(...ids: string[]): MessageWithParts[] {
  return ids.map((id) => ({
    info: message(id),
    parts: [{ id: `part-${id}`, messageID: id, type: "text", text: id }],
  }))
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function liveStream(...events: object[]) {
  return async function* (signal: AbortSignal) {
    for (const event of events) yield event
    await new Promise<void>((resolve) => signal.addEventListener("abort", resolve, { once: true }))
  }
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
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

afterEach(() => {
  useEvents.getState().disconnect()
})

test("reconnect reconciles the active transcript once with a bounded page and preserves local state", async () => {
  const requests: Array<{ sessionID: string; options: { limit: number } }> = []
  const client = {
    global: {
      events: liveStream({ payload: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } } }),
    },
    session: {
      status: async () => ({}),
      messages: async (sessionID: string, options: { limit: number }) => {
        requests.push({ sessionID, options })
        return page("new")
      },
    },
  }
  const optimistic = { ...message("temp-local"), role: "user" as const }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({
    currentSession: session("s1"),
    activeTranscriptSessionID: "s1",
    messages: [message("old"), optimistic],
    parts: { old: [], "temp-local": [] },
    nextCursor: "older",
    hasMore: true,
  })
  useEvents.setState({ reconnectAttempts: 1 })

  useEvents.getState().connect()
  await settle()

  assert.deepEqual(requests, [{ sessionID: "s1", options: { limit: 2 } }])
  const state = useSessions.getState()
  assert.deepEqual(state.messages.map((item) => item.id), ["old", "new", "temp-local"])
  assert.equal(state.nextCursor, "older")
  assert.equal(state.hasMore, true)
})

test("a late reconnect page cannot overwrite a newer active transcript", async () => {
  const response = deferred<MessageWithParts[]>()
  const client = {
    global: { events: liveStream({ payload: { type: "connected", properties: {} } }) },
    session: { status: async () => ({}), messages: async () => response.promise },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1", messages: [message("one")] })
  useEvents.setState({ reconnectAttempts: 1 })

  useEvents.getState().connect()
  await settle()
  useSessions.setState({ currentSession: session("s2"), activeTranscriptSessionID: "s2", messages: [message("two", "s2")] })
  response.resolve(page("late"))
  await settle()

  assert.deepEqual(useSessions.getState().messages.map((item) => item.id), ["two"])
})

test("busy recovery and its idle event do not duplicate the open transcript request", async () => {
  const requests: Array<{ limit: number }> = []
  const client = {
    global: {
      events: liveStream(
        { payload: { type: "connected", properties: {} } },
        { payload: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } } },
      ),
    },
    session: {
      status: async () => ({}),
      messages: async (_sessionID: string, options: { limit: number }) => {
        requests.push(options)
        if (options.limit === 1) return [{ info: { ...message("done"), time: { created: 1, completed: 2 } }, parts: [] }]
        return page("offline")
      },
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({ currentSession: session("s1"), activeTranscriptSessionID: "s1" })
  useEvents.setState({ reconnectAttempts: 1, sessionStatus: { s1: { type: "busy" } } })

  useEvents.getState().connect()
  await settle()

  assert.equal(requests.filter((request) => request.limit === 2).length, 1)
  assert.equal(requests.filter((request) => request.limit === 1).length, 1)
  assert.equal(useEvents.getState().sessionStatus.s1?.type, "idle")
})

test("older pagination remains cursor-bounded after reconnect setup", async () => {
  const requests: Array<{ sessionID: string; options: { limit: number; before?: string } }> = []
  const client = {
    session: {
      messagesPage: async (sessionID: string, options: { limit: number; before?: string }) => {
        requests.push({ sessionID, options })
        return { items: page("older"), nextCursor: "oldest" }
      },
    },
  }
  useConnections.setState({ client: client as never, clientForDirectory: () => client as never })
  useSessions.setState({
    currentSession: session("s1"),
    activeTranscriptSessionID: "s1",
    messages: [message("new"), { ...message("temp-local"), role: "user" as const }],
    nextCursor: "older",
    hasMore: true,
  })

  await useSessions.getState().loadOlderMessages()

  assert.deepEqual(requests, [{ sessionID: "s1", options: { limit: 2, before: "older" } }])
  const state = useSessions.getState()
  assert.deepEqual(state.messages.map((item) => item.id), ["older", "new", "temp-local"])
  assert.equal(state.nextCursor, "oldest")
  assert.equal(state.hasMore, true)
})
